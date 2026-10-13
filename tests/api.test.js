import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createApp } from '../server/app.js';
import { glbFixture, encodeGlb } from './fixtures.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const missingId = '00000000-0000-0000-0000-000000000000';
async function listen(options = {}) {
  const server = createApp({ databasePath: ':memory:', ...options });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  return { server, base, call: (route, options) => fetch(base + route, { signal: AbortSignal.timeout(5000), ...options }) };
}
async function stop(server) {
  await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
}
async function temporaryDatabase(t, shutdown) {
  const base = path.join(root, 'tests', '.tmp');
  await mkdir(base, { recursive: true });
  const directory = await mkdtemp(path.join(base, 'api-'));
  // Windows cannot unlink an open SQLite file. Close the server before removing
  // its database in the same hook, including when an assertion fails.
  t.after(async () => {
    await shutdown();
    await rm(directory, { recursive: true, force: true });
  });
  return path.join(directory, 'meshtrim.sqlite');
}
async function upload(call, bytes = glbFixture(), filename = 'triangle.glb') {
  const response = await call(`/api/assets?filename=${encodeURIComponent(filename)}`, {
    method: 'POST', headers: { 'Content-Type': 'model/gltf-binary' }, body: bytes,
  });
  assert.equal(response.status, 201, await response.clone().text());
  const asset = await response.json();
  assert.equal(response.headers.get('location'), `/api/assets/${asset.id}`);
  return asset;
}
const enqueue = (call, id, preset = 'balanced') => call(`/api/assets/${id}/optimizations`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ preset }),
});

test('upload, inspection, listing, reports and byte-exact original downloads over HTTP', async t => {
  const { server, call } = await listen();
  t.after(() => stop(server));
  const presets = await (await call('/api/presets')).json();
  assert.deepEqual(presets.presets.map(item => item.id), ['quality', 'balanced', 'compact']);
  assert.equal(presets.optimizationAvailable, false);
  assert.equal((await (await call('/api/assets')).json()).total, 0);
  const bytes = glbFixture();
  const asset = await upload(call, bytes, 'sahna ü.glb');
  assert.equal(asset.originalSizeBytes, bytes.length);
  assert.equal(asset.inspection.meshCount, 1);
  assert.equal(asset.inspection.vertexCount, 3);
  assert.equal(asset.inspection.triangleCount, 1);
  assert.equal(asset.inspection.textures[0].mimeType, 'image/png');
  const version = asset.versions[0];
  const list = await (await call('/api/assets?limit=1&offset=0')).json();
  assert.equal(list.total, 1);
  assert.equal(list.assets[0].id, asset.id);
  assert.equal((await (await call('/api/assets?offset=1')).json()).assets.length, 0);
  assert.deepEqual(await (await call(`/api/assets/${asset.id}`)).json(), asset);
  const download = await call(version.downloadUrl);
  assert.equal(download.status, 200);
  assert.equal(download.headers.get('content-type'), 'model/gltf-binary');
  assert.match(download.headers.get('content-disposition'), /attachment;.*filename\*=UTF-8''sahna%20%C3%BC.glb/);
  assert.equal(Number(download.headers.get('content-length')), bytes.length);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
  const preview = await call(version.fileUrl);
  assert.match(preview.headers.get('content-disposition'), /^inline;/);
  assert.deepEqual(Buffer.from(await preview.arrayBuffer()), bytes);
  const report = await (await call(`/api/assets/${asset.id}/report`)).json();
  assert.equal(report.versions[0].savingsPercent, 0);
  assert.deepEqual(report.jobs, []);
  for (const route of ['/api/presets', '/api/assets', `/api/assets/${asset.id}`, `/api/assets/${asset.id}/report`, version.fileUrl, version.downloadUrl]) {
    const response = await call(route, { method: 'HEAD' });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), '');
  }
});

test('job lifecycle publishes a validated version and reports measured savings', async t => {
  const { server, call } = await listen();
  t.after(() => stop(server));
  const original = glbFixture('preserved source metadata '.repeat(30));
  const asset = await upload(call, original);
  const response = await enqueue(call, asset.id);
  assert.equal(response.status, 202);
  const first = await response.json();
  assert.equal(first.job.status, 'queued');
  assert.equal(first.job.versionId, null);
  const duplicate = await (await enqueue(call, asset.id)).json();
  assert.equal(duplicate.reused, true);
  assert.equal(duplicate.job.id, first.job.id);
  assert.equal((await (await call(`/api/assets/${asset.id}/jobs`)).json()).jobs.length, 1);
  assert.equal(server.store.claimJob().id, first.job.id);
  assert.equal(server.store.claimJob(), null);
  assert.equal((await call(`/api/assets/${asset.id}`, { method: 'DELETE' })).status, 409);
  assert.equal((await call(`/api/jobs/${first.job.id}`, { method: 'DELETE' })).status, 409);
  assert.throws(() => server.store.completeJob(first.job.id, Buffer.from('broken')), { code: 'INVALID_GLB' });
  assert.equal(server.store.getJob(first.job.id).status, 'running');
  const optimized = glbFixture(); // Worker boundary fixture; no optimizer is simulated by the server.
  const job = server.store.completeJob(first.job.id, optimized);
  assert.equal(job.status, 'completed');
  assert.throws(() => server.store.completeJob(job.id, optimized), { code: 'INVALID_JOB_STATE' });
  const completed = await (await call(`/api/jobs/${job.id}`)).json();
  assert.equal(completed.versionId, job.versionId);
  const version = await (await call(`/api/versions/${job.versionId}`)).json();
  assert.equal(version.kind, 'optimized');
  assert.deepEqual(Buffer.from(await (await call(version.downloadUrl)).arrayBuffer()), optimized);
  const report = await (await call(`/api/assets/${asset.id}/report`)).json();
  const result = report.versions.find(item => item.id === job.versionId);
  assert.equal(result.savedBytes, original.length - optimized.length);
  assert.equal(result.savingsPercent, Math.round((1 - optimized.length / original.length) * 10000) / 100);
  const cancelled = (await (await enqueue(call, asset.id, 'compact')).json()).job;
  assert.equal((await (await call(`/api/jobs/${cancelled.id}`, { method: 'DELETE' })).json()).status, 'cancelled');
  assert.equal((await call(`/api/jobs/${cancelled.id}`, { method: 'DELETE' })).status, 200);
  const failed = (await (await enqueue(call, asset.id, 'quality')).json()).job;
  server.store.claimJob();
  server.store.failJob(failed.id, 'Unsupported compression extension');
  assert.equal((await (await call(`/api/jobs/${failed.id}`)).json()).status, 'failed');
  const retry = (await (await enqueue(call, asset.id, 'quality')).json()).job;
  assert.notEqual(retry.id, failed.id);
  assert.equal((await call(`/api/assets/${asset.id}`, { method: 'DELETE' })).status, 204);
  for (const route of [`/api/assets/${asset.id}`, `/api/versions/${job.versionId}`, `/api/jobs/${retry.id}`, asset.versions[0].fileUrl]) {
    assert.equal((await call(route)).status, 404);
  }
  assert.equal((await (await call('/api/assets')).json()).total, 0);
});

test('invalid bodies, types, filenames, IDs, methods, query values and cross-origin writes are rejected', async t => {
  const { server, call } = await listen({ maxUploadBytes: 2048 });
  t.after(() => stop(server));
  const asset = await upload(call);
  const cases = [
    ['/api/assets?filename=../scene.glb', { method: 'POST' }, 400],
    ['/api/assets?filename=scene.gltf', { method: 'POST' }, 400],
    ['/api/assets?filename=a.glb&filename=b.glb', { method: 'POST' }, 400],
    ['/api/assets?filename=a.glb', { method: 'POST', body: 'not glb' }, 415],
    ['/api/assets?filename=a.glb', { method: 'POST', headers: { 'Content-Type': 'model/gltf-binary' }, body: Buffer.from('not a GLB file at all') }, 422],
    ['/api/assets?filename=a.glb', { method: 'POST', headers: { 'Content-Type': 'model/gltf-binary' }, body: Buffer.alloc(2049) }, 413],
    ['/api/assets?limit=0', {}, 400], ['/api/assets?limit=101', {}, 400], ['/api/assets?offset=-1', {}, 400],
    ['/api/assets?limit=1&limit=2', {}, 400], ['/api/assets?offset=999999999999999999999', {}, 400],
    ['/api/assets/not-an-id', {}, 400], [`/api/assets/${missingId}`, {}, 404],
    [`/api/jobs/${missingId}`, {}, 404], [`/api/versions/${missingId}/download`, {}, 404],
    ['/api/assets', { method: 'PATCH' }, 405],
    [`/api/assets/${asset.id}/optimizations`, { method: 'GET' }, 405],
    [`/api/assets/${asset.id}/optimizations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' }, 400],
    [`/api/assets/${asset.id}/optimizations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '[]' }, 400],
    [`/api/assets/${asset.id}/optimizations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"preset":"ultra"}' }, 400],
    [`/api/assets/${asset.id}/optimizations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"preset":"quality","extra":true}' }, 400],
    [`/api/assets/${asset.id}`, { method: 'DELETE', headers: { Origin: 'https://other.example' } }, 403],
    [`/api/assets/${asset.id}`, { method: 'DELETE', headers: { Origin: 'null' } }, 403],
    [`/api/assets/${asset.id}`, { method: 'DELETE', headers: { Origin: 'invalid-origin' } }, 403],
    ['/data/meshtrim.sqlite', {}, 404], ['/server/store.js', {}, 404],
  ];
  for (const [route, options, expected] of cases) {
    const response = await call(route, options);
    assert.equal(response.status, expected, `${options.method ?? 'GET'} ${route}`);
    assert.equal(typeof (await response.json()).error, 'string');
  }
  assert.equal((await (await call('/api/assets')).json()).total, 1);
  const tooLargeChunked = await new Promise((resolve, reject) => {
    const request = http.request(new URL('/api/assets?filename=large.glb', server.address() && `http://127.0.0.1:${server.address().port}`), {
      method: 'POST', headers: { 'Content-Type': 'model/gltf-binary', 'Transfer-Encoding': 'chunked' },
    }, response => { response.resume(); response.on('end', () => resolve(response.statusCode)); });
    request.on('error', reject);
    request.end(Buffer.alloc(2049));
  });
  assert.equal(tooLargeChunked, 413);
  assert.equal((await call('/api/health')).status, 200);
});

test('malformed GLB containers and unsafe resource references never persist', async t => {
  const { server, call } = await listen();
  t.after(() => stop(server));
  const badLength = glbFixture();
  badLength.writeUInt32LE(20, 8);
  const badChunk = glbFixture();
  badChunk.writeUInt32LE(999999, 12);
  const invalidJson = encodeGlb({ asset: { version: '2.0' } });
  invalidJson[20] = 0x7f;
  const cases = [badLength, badChunk, invalidJson,
    encodeGlb({ asset: { version: '1.0' } }),
    encodeGlb({ asset: { version: '2.0' }, buffers: [{ byteLength: 4, uri: 'https://example.com/data.bin' }] }),
    encodeGlb({ asset: { version: '2.0' }, images: [{ uri: 'file:///etc/passwd' }] }),
    encodeGlb({ asset: { version: '2.0' }, buffers: [{ byteLength: 40 }], bufferViews: [{ buffer: 0, byteLength: 100 }] }, Buffer.alloc(40)),
    encodeGlb({ asset: { version: '2.0' }, meshes: [{ primitives: [{ attributes: { POSITION: 999 } }] }] }),
    encodeGlb({ asset: { version: '2.0' }, textures: [null] }),
    encodeGlb({ asset: { version: '2.0' }, buffers: [{ byteLength: 4 }], bufferViews: [{ buffer: 0, byteLength: 4 }],
      accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }] }, Buffer.alloc(4)),
    encodeGlb({ asset: { version: '2.0' }, accessors: [{ componentType: 5126, count: 1, type: 'VEC3', byteOffset: -1 }] }),
  ];
  for (const body of cases) {
    const response = await call('/api/assets?filename=invalid.glb', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body });
    assert.equal(response.status, 422);
    assert.equal((await response.json()).code, 'INVALID_GLB');
  }
  assert.equal((await (await call('/api/assets')).json()).total, 0);
});

test('SQLite retains assets, binaries, completed reports and queued jobs after server reopen', async t => {
  let active;
  const databasePath = await temporaryDatabase(t, async () => { if (active) await stop(active.server); });
  active = await listen({ databasePath });
  const bytes = glbFixture('original source');
  const asset = await upload(active.call, bytes);
  const done = (await (await enqueue(active.call, asset.id)).json()).job;
  active.server.store.claimJob();
  const completed = active.server.store.completeJob(done.id, glbFixture());
  const interrupted = (await (await enqueue(active.call, asset.id, 'quality')).json()).job;
  active.server.store.claimJob();
  const queued = (await (await enqueue(active.call, asset.id, 'compact')).json()).job;
  await stop(active.server);
  active = await listen({ databasePath });
  active.server.store.recoverInterruptedJobs();
  assert.equal((await (await active.call('/api/assets')).json()).total, 1);
  assert.deepEqual(Buffer.from(await (await active.call(asset.versions[0].downloadUrl)).arrayBuffer()), bytes);
  assert.equal((await (await active.call(`/api/jobs/${queued.id}`)).json()).status, 'queued');
  const recovered = await (await active.call(`/api/jobs/${interrupted.id}`)).json();
  assert.equal(recovered.status, 'failed');
  assert.match(recovered.error, /restart/);
  assert.equal((await (await active.call(`/api/jobs/${completed.id}`)).json()).versionId, completed.versionId);
  assert.equal((await (await active.call(`/api/assets/${asset.id}/report`)).json()).versions.length, 2);
  assert.equal((await active.call(`/api/assets/${asset.id}`, { method: 'DELETE' })).status, 204);
  await stop(active.server);
  active = await listen({ databasePath });
  assert.equal((await (await active.call('/api/assets')).json()).total, 0);
});

test('production entry point persists an upload across separate Node processes', async t => {
  let child;
  const shutdown = async () => {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, 'exit');
    child.kill();
    await exited;
  };
  const databasePath = await temporaryDatabase(t, shutdown);
  async function start() {
    // Reserve a port, then release it immediately before starting the executable.
    const reservation = http.createServer().listen(0, '127.0.0.1');
    await once(reservation, 'listening');
    const port = reservation.address().port;
    await new Promise(resolve => reservation.close(resolve));
    child = spawn(process.execPath, ['server/index.js'], { cwd: root, env: { ...process.env, PORT: String(port), DATABASE_PATH: databasePath, HOST: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    await new Promise((resolve, reject) => {
      let output = '';
      let errors = '';
      const timer = setTimeout(() => reject(new Error(`Server startup timed out: ${errors}`)), 5000);
      const exit = code => { clearTimeout(timer); reject(new Error(`Server exited ${code}: ${errors}`)); };
      child.stderr.on('data', bytes => { errors += bytes; });
      child.once('error', reject);
      child.once('exit', exit);
      child.stdout.on('data', bytes => {
        output += bytes;
        if (output.includes('MeshTrim is running')) { clearTimeout(timer); child.off('exit', exit); resolve(); }
      });
    });
    return (route, options) => fetch(`http://127.0.0.1:${port}${route}`, { signal: AbortSignal.timeout(5000), ...options });
  }
  let call = await start();
  const bytes = glbFixture();
  const asset = await upload(call, bytes);
  await shutdown();
  call = await start();
  assert.equal((await (await call(`/api/assets/${asset.id}`)).json()).id, asset.id);
  assert.deepEqual(Buffer.from(await (await call(asset.versions[0].downloadUrl)).arrayBuffer()), bytes);
});
