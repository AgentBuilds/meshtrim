import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { ApiError, requireFound } from './errors.js';
import { inspectGlb } from './glb.js';
import { PRESETS } from './presets.js';

export const defaultDatabasePath = fileURLToPath(new URL('../data/meshtrim.sqlite', import.meta.url));
const now = () => new Date().toISOString();
const assetColumns = 'id, filename, original_size AS originalSizeBytes, created_at AS createdAt';
const versionColumns = 'id, asset_id AS assetId, kind, preset, size_bytes AS sizeBytes, sha256, created_at AS createdAt';
const jobColumns = 'id, asset_id AS assetId, preset, settings, status, version_id AS versionId, error, created_at AS createdAt, updated_at AS updatedAt';

export class AssetStore {
  constructor(databasePath = defaultDatabasePath) {
    if (databasePath !== ':memory:') mkdirSync(path.dirname(path.resolve(databasePath)), { recursive: true });
    this.db = new DatabaseSync(databasePath);
    this.closed = false;
    try {
      this.db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;');
      const schema = this.db.prepare('PRAGMA user_version').get().user_version;
      if (schema > 1) throw new Error('Database schema is newer than this server supports');
      if (schema === 0) this.db.exec(`
        BEGIN IMMEDIATE;
        CREATE TABLE IF NOT EXISTS assets (
          id TEXT PRIMARY KEY, filename TEXT NOT NULL, original_size INTEGER NOT NULL CHECK(original_size > 0),
          inspection TEXT NOT NULL, created_at TEXT NOT NULL
        ) STRICT;
        CREATE TABLE IF NOT EXISTS versions (
          id TEXT PRIMARY KEY, asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
          kind TEXT NOT NULL CHECK(kind IN ('original', 'optimized')), preset TEXT,
          size_bytes INTEGER NOT NULL CHECK(size_bytes > 0), sha256 TEXT NOT NULL,
          inspection TEXT NOT NULL, content BLOB NOT NULL, created_at TEXT NOT NULL
        ) STRICT;
        CREATE UNIQUE INDEX IF NOT EXISTS original_per_asset ON versions(asset_id) WHERE kind = 'original';
        CREATE INDEX IF NOT EXISTS versions_asset ON versions(asset_id, created_at);
        CREATE TABLE IF NOT EXISTS jobs (
          id TEXT PRIMARY KEY, asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
          preset TEXT NOT NULL CHECK(preset IN ('quality', 'balanced', 'compact')), settings TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
          version_id TEXT REFERENCES versions(id), error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        ) STRICT;
        CREATE UNIQUE INDEX IF NOT EXISTS active_job ON jobs(asset_id, preset) WHERE status IN ('queued', 'running');
        CREATE INDEX IF NOT EXISTS jobs_asset ON jobs(asset_id, created_at);
        PRAGMA user_version = 1;
        COMMIT;
      `);
    } catch (error) { this.db.close(); throw error; }
  }

  close() { if (!this.closed) { this.db.close(); this.closed = true; } }

  transaction(action) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const value = action(); this.db.exec('COMMIT'); return value; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  insertVersion(assetId, kind, preset, bytes, inspection, createdAt) {
    const id = randomUUID();
    this.db.prepare(`INSERT INTO versions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, assetId, kind, preset, bytes.length, createHash('sha256').update(bytes).digest('hex'), JSON.stringify(inspection), bytes, createdAt);
    return id;
  }

  createAsset(filename, bytes) {
    const inspection = inspectGlb(bytes);
    const id = randomUUID();
    const createdAt = now();
    return this.transaction(() => {
      this.db.prepare('INSERT INTO assets VALUES (?, ?, ?, ?, ?)').run(id, filename, bytes.length, JSON.stringify(inspection), createdAt);
      this.insertVersion(id, 'original', null, bytes, inspection, createdAt);
      return this.getAsset(id);
    });
  }

  listAssets(limit, offset) {
    return { assets: this.db.prepare(`SELECT ${assetColumns} FROM assets ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`).all(limit, offset),
      total: this.db.prepare('SELECT count(*) AS total FROM assets').get().total, limit, offset };
  }

  getAsset(id) {
    const row = requireFound(this.db.prepare(`SELECT ${assetColumns}, inspection FROM assets WHERE id = ?`).get(id), 'Asset');
    return { ...row, inspection: JSON.parse(row.inspection), versions: this.listVersions(id) };
  }

  listVersions(assetId) {
    return this.db.prepare(`SELECT ${versionColumns} FROM versions WHERE asset_id = ? ORDER BY created_at, id`).all(assetId)
      .map(row => this.presentVersion(row));
  }

  presentVersion(row) {
    return { ...row, fileUrl: `/api/versions/${row.id}/file`, downloadUrl: `/api/versions/${row.id}/download` };
  }

  getVersion(id) {
    const row = requireFound(this.db.prepare(`SELECT ${versionColumns}, inspection FROM versions WHERE id = ?`).get(id), 'Version');
    return this.presentVersion({ ...row, inspection: JSON.parse(row.inspection) });
  }

  getFile(id) {
    const version = this.getVersion(id);
    const asset = this.db.prepare('SELECT filename FROM assets WHERE id = ?').get(version.assetId);
    return { version, filename: version.kind === 'original' ? asset.filename : `${asset.filename.slice(0, -4)}-${version.preset}.glb`,
      bytes: Buffer.from(this.db.prepare('SELECT content FROM versions WHERE id = ?').get(id).content) };
  }

  deleteAsset(id) {
    return this.transaction(() => {
      requireFound(this.db.prepare('SELECT id FROM assets WHERE id = ?').get(id), 'Asset');
      if (this.db.prepare("SELECT id FROM jobs WHERE asset_id = ? AND status = 'running'").get(id)) {
        throw new ApiError(409, 'JOB_RUNNING', 'Cannot delete an asset while optimization is running');
      }
      // Remove jobs first because completed jobs reference their output version.
      this.db.prepare('DELETE FROM jobs WHERE asset_id = ?').run(id);
      this.db.prepare('DELETE FROM assets WHERE id = ?').run(id);
    });
  }

  enqueueJob(assetId, presetId) {
    const preset = PRESETS.find(item => item.id === presetId);
    if (!preset) throw new ApiError(400, 'INVALID_PRESET', 'preset must be quality, balanced or compact');
    return this.transaction(() => {
      requireFound(this.db.prepare('SELECT id FROM assets WHERE id = ?').get(assetId), 'Asset');
      const existing = this.db.prepare("SELECT id FROM jobs WHERE asset_id = ? AND preset = ? AND status IN ('queued', 'running')").get(assetId, presetId);
      if (existing) return { job: this.getJob(existing.id), reused: true };
      const id = randomUUID();
      const createdAt = now();
      this.db.prepare('INSERT INTO jobs VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?)').run(id, assetId, presetId, JSON.stringify(preset), 'queued', createdAt, createdAt);
      return { job: this.getJob(id), reused: false };
    });
  }

  getJob(id) {
    const row = requireFound(this.db.prepare(`SELECT ${jobColumns} FROM jobs WHERE id = ?`).get(id), 'Job');
    return { ...row, settings: JSON.parse(row.settings) };
  }

  listJobs(assetId) {
    return this.db.prepare('SELECT id FROM jobs WHERE asset_id = ? ORDER BY created_at, id').all(assetId).map(row => this.getJob(row.id));
  }

  cancelJob(id) {
    return this.transaction(() => {
      const job = this.getJob(id);
      if (job.status === 'cancelled') return job;
      if (job.status !== 'queued') throw new ApiError(409, 'INVALID_JOB_STATE', 'Only queued jobs can be cancelled');
      this.db.prepare("UPDATE jobs SET status = 'cancelled', updated_at = ? WHERE id = ?").run(now(), id);
      return this.getJob(id);
    });
  }

  // Internal worker boundary. Never expose state transitions or output writes to HTTP clients.
  claimJob() {
    return this.transaction(() => {
      const row = this.db.prepare("SELECT id FROM jobs WHERE status = 'queued' ORDER BY created_at, id LIMIT 1").get();
      if (!row) return null;
      this.db.prepare("UPDATE jobs SET status = 'running', updated_at = ? WHERE id = ?").run(now(), row.id);
      return this.getJob(row.id);
    });
  }

  completeJob(id, bytes) {
    const inspection = inspectGlb(bytes);
    return this.transaction(() => {
      const job = this.getJob(id);
      if (job.status !== 'running') throw new ApiError(409, 'INVALID_JOB_STATE', 'Job is not running');
      const updatedAt = now();
      const versionId = this.insertVersion(job.assetId, 'optimized', job.preset, bytes, inspection, updatedAt);
      this.db.prepare("UPDATE jobs SET status = 'completed', version_id = ?, updated_at = ? WHERE id = ?").run(versionId, updatedAt, id);
      return this.getJob(id);
    });
  }

  failJob(id, message = 'Optimization failed') {
    return this.transaction(() => {
      const job = this.getJob(id);
      if (job.status !== 'running') throw new ApiError(409, 'INVALID_JOB_STATE', 'Job is not running');
      this.db.prepare("UPDATE jobs SET status = 'failed', error = ?, updated_at = ? WHERE id = ?").run(String(message).slice(0, 1000), now(), id);
      return this.getJob(id);
    });
  }

  recoverInterruptedJobs() {
    this.db.prepare("UPDATE jobs SET status = 'failed', error = 'Optimization interrupted by server restart', updated_at = ? WHERE status = 'running'").run(now());
  }

  report(assetId) {
    const asset = this.getAsset(assetId);
    return { assetId, originalSizeBytes: asset.originalSizeBytes,
      versions: asset.versions.map(version => ({ ...version, savedBytes: asset.originalSizeBytes - version.sizeBytes,
        savingsPercent: Math.round((1 - version.sizeBytes / asset.originalSizeBytes) * 10000) / 100 })), jobs: this.listJobs(assetId) };
  }
}
