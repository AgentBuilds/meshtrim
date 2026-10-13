const $ = selector => document.querySelector(selector);
const status = $('#api-status');
const statusText = $('#api-status-text');
const healthButton = $('#check-api');
const state = {
  settings: null, settingsLoading: false, preset: null, file: null, uploading: false,
  assets: [], total: 0, offset: 0, limit: 8, listing: false, listRequest: 0,
  asset: null, selectedId: null, report: null, versionId: null,
  detailRequest: 0, versionRequest: 0, loading: false, mutating: false, timer: null,
};

async function checkHealth() {
  healthButton.disabled = true;
  healthButton.setAttribute('aria-busy', 'true');
  healthButton.textContent = 'Checking…';
  status.className = 'connection-state loading';
  statusText.textContent = 'Checking API…';
  try {
    const response = await fetch('/api/health', { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error('API unavailable');
    const data = await response.json();
    if (data.status !== 'ok' || data.service !== 'meshtrim') throw new Error('Invalid API response');
    status.className = 'connection-state connected';
    statusText.textContent = 'API connected';
    healthButton.textContent = 'Check again';
    if ($('#upload-form') && !state.settings && !state.settingsLoading) void loadSettings();
  } catch {
    status.className = 'connection-state error';
    statusText.textContent = 'API unavailable. Retry the check.';
    healthButton.textContent = 'Retry';
  } finally {
    healthButton.disabled = false;
    healthButton.setAttribute('aria-busy', 'false');
  }
}

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = String(text);
  if (className) element.className = className;
  return element;
}
function message(selector, text = '', error = false) {
  const element = $(selector);
  element.textContent = text;
  element.classList.toggle('error', error);
}
function busy(selector, value, text) {
  const element = $(selector);
  element.disabled = value;
  element.setAttribute('aria-busy', String(value));
  if (text) element.textContent = text;
}
function bytes(value) {
  if (value === null || value === undefined) return 'Not reported';
  if (value < 1024) return `${value} B`;
  const units = ['KiB', 'MiB', 'GiB'];
  let size = value / 1024, index = 0;
  while (size >= 1024 && index < units.length - 1) { size /= 1024; index++; }
  return `${size.toFixed(size >= 10 ? 1 : 2)} ${units[index]}`;
}
const number = value => Number(value ?? 0).toLocaleString();
const date = value => new Date(value).toLocaleString();
const presetName = id => state.settings?.presets.find(item => item.id === id)?.name ?? id;

async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(path, { ...options, signal: AbortSignal.timeout(options.method ? 35000 : 10000) });
  } catch {
    throw new Error(options.method
      ? 'Connection interrupted. Refresh to check whether the action was saved before retrying.'
      : 'Unable to reach the API. Check your connection and retry.');
  }
  if (response.status === 204) return null;
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error ?? `Request failed (${response.status}). Please retry.`);
  if (!data) throw new Error('The API returned an unreadable response. Please retry.');
  return data;
}

function updateControls() {
  const blocked = state.mutating || state.uploading;
  $('#glb-file').disabled = !state.settings || blocked;
  $('#upload-button').disabled = !state.settings || !state.file || blocked;
  $('#preset-group').disabled = !state.settings || blocked;
  $('#optimize-button').disabled = !state.asset || state.loading || !state.settings || blocked;
  $('#refresh-asset').disabled = !state.selectedId || state.loading || blocked;
  $('#delete-asset').disabled = !state.asset || blocked || state.report?.jobs.some(job => job.status === 'running');
  $('#version-select').disabled = state.loading || blocked || !state.report?.versions.some(version => version.kind === 'optimized');
  $('#refresh-library').disabled = state.listing || blocked;
  $('#previous-page').disabled = state.listing || blocked || state.offset === 0;
  $('#next-page').disabled = state.listing || blocked || state.offset + state.limit >= state.total;
  for (const item of $('#asset-list').querySelectorAll('button')) item.disabled = blocked;
  for (const item of $('#jobs').querySelectorAll('button')) item.disabled = blocked;
  $('#confirm-delete').disabled = blocked;
  $('#cancel-delete').disabled = blocked;
}

async function loadSettings() {
  state.settingsLoading = true;
  message('#upload-note', 'Loading upload settings…');
  try {
    const settings = await request('/api/presets');
    state.settings = settings; state.preset = settings.defaultPreset;
    $('#presets').replaceChildren(...settings.presets.map(preset => {
      const label = node('label', undefined, 'preset');
      const input = node('input');
      input.type = 'radio'; input.name = 'preset'; input.value = preset.id;
      input.checked = preset.id === state.preset;
      const copy = node('span');
      copy.append(node('strong', preset.name), node('small', preset.description));
      label.append(input, copy);
      if (preset.id === settings.defaultPreset) label.append(node('span', 'DEFAULT', 'recommended'));
      input.addEventListener('change', () => { state.preset = preset.id; renderPreset(); });
      return label;
    }));
    renderPreset();
    message('#upload-note', `GLB v2 · embedded resources · up to ${bytes(settings.maxUploadBytes)}`);
    message('#worker-note', settings.optimizationAvailable
      ? 'Queue a preset, then watch its processing status below.'
      : 'Processing is not available yet. You can save a queued job, inspect your source and download it.');
    validateFile();
  } catch (error) {
    message('#upload-note', `${error.message} Use “Check again” below to reload settings.`, true);
    message('#worker-note', 'Preset settings are unavailable.', true);
    $('#presets').replaceChildren(node('p', 'Unable to load presets.', 'caption error'));
  } finally { state.settingsLoading = false; updateControls(); }
}
function renderPreset() {
  const preset = state.settings.presets.find(item => item.id === state.preset);
  message('#preset-detail', `${preset.maxTextureSize}px texture limit · ${Math.round(preset.textureQuality * 100)}% texture quality · geometry deduplication · ${preset.compression} compression`);
}
function validateFile(file = state.file) {
  state.file = file;
  let error = '';
  if (file && (!/\.glb$/i.test(file.name) || file.name.length > 180 || file.name.trim() !== file.name || /[\x00-\x1f\x7f/\\]/.test(file.name))) {
    error = 'Choose a filename ending in .glb, up to 180 characters, without path separators.';
  } else if (file && file.size === 0) error = 'This file is empty. Choose a GLB with scene content.';
  else if (file && state.settings && file.size > state.settings.maxUploadBytes) error = `This file exceeds the ${bytes(state.settings.maxUploadBytes)} upload limit.`;
  message('#file-summary', file ? `${file.name} · ${bytes(file.size)}` : 'No file selected');
  message('#upload-error', error, Boolean(error));
  $('#glb-file').setAttribute('aria-invalid', String(Boolean(error)));
  if (error) state.file = null;
  updateControls();
  return !error && Boolean(file);
}

async function upload(event) {
  event.preventDefault();
  if (state.uploading || state.mutating || !state.settings || !validateFile()) return;
  const file = state.file;
  state.uploading = true;
  busy('#upload-button', true, 'Uploading & inspecting…');
  message('#upload-status', 'Sending your source file…'); updateControls();
  try {
    const asset = await request(`/api/assets?filename=${encodeURIComponent(file.name)}`, {
      method: 'POST', headers: { 'Content-Type': 'model/gltf-binary' }, body: file,
    });
    state.file = null; $('#glb-file').value = '';
    message('#file-summary', 'No file selected');
    message('#upload-status', 'Upload saved. Your original is ready to inspect.');
    state.offset = 0;
    await Promise.all([loadLibrary(), selectAsset(asset.id, true)]);
  } catch (error) {
    message('#upload-error', error.message, true); message('#upload-status', 'Upload could not be confirmed.');
  } finally {
    state.uploading = false; busy('#upload-button', false, 'Upload & inspect ↗'); updateControls();
  }
}

function renderLibrary() {
  $('#asset-list').replaceChildren(...state.assets.map(asset => {
    const item = node('li');
    const button = node('button', undefined, 'asset-row');
    button.type = 'button'; button.setAttribute('aria-pressed', String(asset.id === state.selectedId));
    button.append(node('strong', asset.filename), node('span', `${bytes(asset.originalSizeBytes)} · ${date(asset.createdAt)}`, 'caption'));
    button.addEventListener('click', () => { if (!state.mutating && !state.uploading) void selectAsset(asset.id, true); });
    item.append(button); return item;
  }));
  if (!state.assets.length) $('#asset-list').append(node('li', 'Your library is empty. Upload your first GLB above.', 'library-empty caption'));
  message('#page-label', state.total ? `${state.offset + 1}–${Math.min(state.offset + state.limit, state.total)} of ${state.total}` : '0 assets');
  updateControls();
}
async function loadLibrary() {
  const token = ++state.listRequest;
  state.listing = true; busy('#refresh-library', true, 'Loading…');
  message('#library-status', 'Loading saved assets…'); updateControls();
  try {
    const data = await request(`/api/assets?limit=${state.limit}&offset=${state.offset}`);
    if (token !== state.listRequest) return;
    if (!data.assets.length && state.offset > 0) {
      state.offset = Math.max(0, Math.floor((data.total - 1) / state.limit) * state.limit);
      return await loadLibrary();
    }
    state.assets = data.assets; state.total = data.total;
    renderLibrary(); message('#library-status', `${number(data.total)} saved ${data.total === 1 ? 'asset' : 'assets'}`);
  } catch (error) { if (token === state.listRequest) message('#library-status', `${error.message} Use Refresh to try again.`, true); }
  finally { if (token === state.listRequest) { state.listing = false; busy('#refresh-library', false, 'Refresh'); updateControls(); } }
}

function panel(selector, title, description, badge) {
  $(selector).replaceChildren(node('span', badge, 'scene-mark'), node('h3', title), node('p', description));
}
function clearDetail() {
  clearTimeout(state.timer); state.asset = null; state.report = null; state.versionRequest++;
  $('#asset-details').hidden = true; $('#delete-confirmation').hidden = true;
  message('#action-status'); message('#asset-title', 'Your asset workspace');
  message('#original-size', 'No asset'); message('#optimized-size', 'No version');
  message('#original-footer', '—'); message('#optimized-footer', 'GLB · output');
  panel('#original-panel', 'Your source, intact.', 'Upload a GLB or select an asset in your library.', '01');
  panel('#optimized-panel', 'Make room for less.', 'Completed versions will appear here when processing is available.', '02');
  updateControls();
}
async function selectAsset(id, navigate = false, focus = navigate) {
  const token = ++state.detailRequest;
  if (state.selectedId !== id) state.versionId = null;
  state.selectedId = id; clearDetail(); state.loading = true;
  if (navigate && location.hash !== `#asset=${id}`) history.pushState(null, '', `#asset=${id}`);
  renderLibrary(); busy('#refresh-asset', true, 'Loading…');
  message('#detail-status', 'Loading inspection, versions and job history…');
  try {
    const [asset, report] = await Promise.all([request(`/api/assets/${id}`), request(`/api/assets/${id}/report`)]);
    if (token !== state.detailRequest) return;
    state.asset = asset; state.report = report; renderAsset();
    message('#detail-status', `Saved ${date(asset.createdAt)} · original preserved`);
    if (focus) $('#asset-title').focus({ preventScroll: true });
  } catch (error) {
    if (token === state.detailRequest) message('#detail-status', `${error.message} Use Refresh asset to retry or choose another asset.`, true);
  } finally {
    if (token === state.detailRequest) { state.loading = false; busy('#refresh-asset', false, 'Refresh asset'); updateControls(); scheduleRefresh(); }
  }
}

function metrics(selector, items) {
  $(selector).replaceChildren(...items.map(([label, value]) => {
    const item = node('div', undefined, 'metric'); item.append(node('span', label, 'caption'), node('strong', value)); return item;
  }));
}
function table(selector, headers, rows, emptyText) {
  if (!rows.length) return $(selector).replaceChildren(node('p', emptyText, 'table-empty caption'));
  const table = node('table'), head = node('thead'), headRow = node('tr'), body = node('tbody');
  for (const header of headers) { const cell = node('th', header); cell.scope = 'col'; headRow.append(cell); }
  head.append(headRow);
  for (const row of rows) {
    const tr = node('tr');
    row.forEach((value, index) => { const cell = node('td', value); cell.setAttribute('data-label', headers[index]); tr.append(cell); });
    body.append(tr);
  }
  table.append(head, body); $(selector).replaceChildren(table);
}
function renderAsset() {
  const { asset, report } = state, inspection = asset.inspection;
  $('#asset-details').hidden = false; message('#asset-title', asset.filename);
  message('#original-size', bytes(asset.originalSizeBytes));
  message('#original-footer', `${number(inspection.meshCount)} meshes · ${number(inspection.textureCount)} textures`);
  panel('#original-panel', asset.filename, `${number(inspection.vertexCount)} vertices · ${number(inspection.triangleCount)} triangles. Source GLB stored without modification.`, 'SOURCE');
  metrics('#inspection-summary', [['Meshes', number(inspection.meshCount)], ['Vertices', number(inspection.vertexCount)], ['Triangles', number(inspection.triangleCount)], ['Textures', number(inspection.textureCount)]]);
  message('#inspection-meta', `${number(inspection.nodeCount)} nodes · ${number(inspection.materialCount)} materials`);
  message('#mesh-count', `(${number(inspection.meshCount)})`); message('#texture-count', `(${number(inspection.textureCount)})`);
  table('#meshes', ['Mesh', 'Primitives', 'Vertices', 'Triangles'], inspection.meshes.map(mesh => [mesh.name, number(mesh.primitiveCount), number(mesh.vertexCount), number(mesh.triangleCount)]), 'This asset contains no meshes.');
  table('#textures', ['Texture', 'Format', 'Embedded size'], inspection.textures.map(texture => [texture.name, texture.mimeType, bytes(texture.sizeBytes)]), 'This asset contains no textures.');
  message('#extensions', inspection.extensionsUsed.length ? `Extensions: ${inspection.extensionsUsed.join(', ')}` : 'No glTF extensions used.');
  const versions = report.versions.filter(version => version.kind === 'optimized');
  if (!versions.some(version => version.id === state.versionId)) state.versionId = versions.at(-1)?.id ?? null;
  const options = versions.map(version => {
    const option = node('option', `${presetName(version.preset)} · ${bytes(version.sizeBytes)} · ${date(version.createdAt)}`);
    option.value = version.id; option.selected = version.id === state.versionId; return option;
  });
  $('#version-select').replaceChildren(...(options.length ? options : [node('option', 'No optimized version')]));
  renderReport(); renderJobs();
}
function downloadLink(version, label) {
  const link = node('a', label, 'download-link');
  link.href = `/api/versions/${encodeURIComponent(version.id)}/download`;
  link.setAttribute('download', ''); return link;
}
function renderReport() {
  const { asset, report } = state;
  const original = report.versions.find(version => version.kind === 'original');
  const version = report.versions.find(item => item.id === state.versionId);
  metrics('#size-report', [['Original', bytes(asset.originalSizeBytes)], ['Optimized', version ? bytes(version.sizeBytes) : 'Awaiting output'], ['Size change', version ? `${Math.abs(version.savingsPercent).toFixed(2)}% ${version.savedBytes < 0 ? 'larger' : 'smaller'}` : 'Not available']]);
  message('#report-note', version
    ? `${bytes(Math.abs(version.savedBytes))} ${version.savedBytes < 0 ? 'added' : 'saved'} compared with the original. Measured from stored files.`
    : 'No completed output yet. A queued job does not have a size report.');
  $('#downloads').replaceChildren();
  if (original) $('#downloads').append(downloadLink(original, 'Download original'));
  if (version) {
    $('#downloads').append(downloadLink(version, `Download ${presetName(version.preset)}`));
    message('#optimized-size', bytes(version.sizeBytes)); message('#optimized-footer', `GLB · ${presetName(version.preset)}`);
    panel('#optimized-panel', `${presetName(version.preset)} version`, 'Loading output inspection…', 'OUTPUT'); void loadVersion(version);
  } else {
    state.versionRequest++; message('#optimized-size', 'No version');
    panel('#optimized-panel', 'Awaiting a completed version', 'Choose a preset to save a job. Compare and download the output here once processing completes.', '02');
  }
  updateControls();
}
async function loadVersion(version) {
  const token = ++state.versionRequest, assetId = state.selectedId;
  try {
    const data = await request(`/api/versions/${version.id}`);
    if (token !== state.versionRequest || assetId !== state.selectedId) return;
    const inspection = data.inspection;
    panel('#optimized-panel', `${presetName(version.preset)} version`, `${number(inspection.meshCount)} meshes · ${number(inspection.textureCount)} textures · ${number(inspection.triangleCount)} triangles`, 'OUTPUT');
  } catch (error) {
    if (token === state.versionRequest && assetId === state.selectedId) panel('#optimized-panel', 'Output inspection unavailable', `${error.message} Refresh asset to retry. The stored file is still available to download.`, 'OUTPUT');
  }
}
function renderJobs() {
  $('#jobs').replaceChildren(...state.report.jobs.slice().reverse().map(job => {
    const item = node('li', undefined, 'job-row'), copy = node('div');
    copy.append(node('strong', presetName(job.preset)), node('p', `${date(job.createdAt)}${job.error ? ` · ${job.error}` : ''}`, `caption${job.status === 'failed' ? ' error' : ''}`));
    item.append(copy, node('span', job.status, `job-status ${job.status}`));
    if (job.status === 'queued') {
      const button = node('button', 'Cancel job', 'status-button');
      button.setAttribute('aria-label', `Cancel ${presetName(job.preset)} queued job`);
      button.addEventListener('click', () => void mutate('Cancelling job…', () => request(`/api/jobs/${job.id}`, { method: 'DELETE' }), 'Job cancelled.'));
      item.append(button);
    }
    return item;
  }));
  if (!state.report.jobs.length) $('#jobs').append(node('li', 'No jobs yet. Select a preset and queue an optimization.', 'caption table-empty'));
}
async function mutate(pending, action, success) {
  if (state.mutating || state.uploading || !state.asset) return;
  state.mutating = true;
  const assetId = state.selectedId;
  clearTimeout(state.timer); message('#action-status', pending);
  $('#action-status').setAttribute('aria-busy', 'true'); updateControls();
  try {
    const result = await action();
    if (assetId !== state.selectedId) return;
    await selectAsset(assetId, false, false);
    message('#action-status', typeof success === 'function' ? success(result) : success);
  } catch (error) { if (assetId === state.selectedId) message('#action-status', error.message, true); }
  finally { state.mutating = false; $('#action-status').setAttribute('aria-busy', 'false'); updateControls(); scheduleRefresh(); }
}
function scheduleRefresh() {
  clearTimeout(state.timer);
  if (state.mutating || !state.asset || !state.settings?.optimizationAvailable || document.hidden
    || !state.report.jobs.some(job => ['queued', 'running'].includes(job.status))) return;
  state.timer = setTimeout(() => void selectAsset(state.selectedId, false, false), 5000);
}
function hashAsset() {
  const match = location.hash.match(/^#asset=([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/);
  if (match) void selectAsset(match[1]);
  else if (!location.hash || location.hash.startsWith('#asset=')) {
    state.detailRequest++; state.selectedId = null; state.loading = false; state.versionId = null;
    clearDetail(); renderLibrary(); message('#detail-status', 'Upload a GLB or choose a saved asset to inspect it.');
  }
}
async function deleteAsset() {
  if (state.mutating || state.uploading || !state.asset) return;
  const id = state.asset.id, filename = state.asset.filename;
  state.mutating = true; updateControls(); busy('#confirm-delete', true, 'Deleting…');
  try {
    await request(`/api/assets/${id}`, { method: 'DELETE' });
    if (state.selectedId === id) {
      state.detailRequest++; state.selectedId = null; state.loading = false; state.versionId = null;
      clearDetail(); history.replaceState(null, '', location.pathname + location.search);
      message('#detail-status', `${filename} deleted. Choose another asset or upload a new GLB.`);
    }
    await loadLibrary(); $('#refresh-library').focus({ preventScroll: true });
  } catch (error) { message('#action-status', error.message, true); }
  finally { state.mutating = false; busy('#confirm-delete', false, 'Delete permanently'); updateControls(); }
}
function bootWorkspace() {
  $('#glb-file').addEventListener('change', event => { message('#upload-status'); validateFile(event.target.files[0] ?? null); });
  $('#upload-form').addEventListener('submit', event => void upload(event));
  const zone = $('#drop-zone');
  zone.addEventListener('dragover', event => { event.preventDefault(); if (!state.uploading && !state.mutating && state.settings) zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', event => { if (!zone.contains(event.relatedTarget)) zone.classList.remove('dragover'); });
  zone.addEventListener('drop', event => {
    event.preventDefault(); zone.classList.remove('dragover');
    if (!state.settings || state.uploading || state.mutating) return;
    $('#glb-file').value = ''; message('#upload-status');
    if (event.dataTransfer.files.length !== 1) { state.file = null; message('#file-summary', 'No file selected'); message('#upload-error', 'Drop one GLB file at a time.', true); updateControls(); return; }
    validateFile(event.dataTransfer.files[0]);
  });
  $('#refresh-library').addEventListener('click', () => void loadLibrary());
  $('#previous-page').addEventListener('click', () => { state.offset = Math.max(0, state.offset - state.limit); void loadLibrary(); });
  $('#next-page').addEventListener('click', () => { state.offset += state.limit; void loadLibrary(); });
  $('#refresh-asset').addEventListener('click', () => void selectAsset(state.selectedId));
  $('#version-select').addEventListener('change', event => { state.versionId = event.target.value; renderReport(); });
  $('#optimize-button').addEventListener('click', () => {
    const preset = state.preset;
    void mutate('Saving optimization job…', () => request(`/api/assets/${state.selectedId}/optimizations`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ preset }),
    }), result => `${presetName(preset)} job ${result.reused ? 'already queued' : 'queued'}.${state.settings.optimizationAvailable ? ' Status will refresh automatically.' : ' Processing is not available yet; no output has been generated.'}`);
  });
  $('#delete-asset').addEventListener('click', () => {
    message('#delete-message', `Permanently delete ${state.asset.filename} and all its versions and jobs? This cannot be undone.`);
    $('#delete-confirmation').hidden = false; $('#cancel-delete').focus();
  });
  $('#cancel-delete').addEventListener('click', () => { $('#delete-confirmation').hidden = true; $('#delete-asset').focus(); });
  $('#confirm-delete').addEventListener('click', () => void deleteAsset());
  $('#delete-confirmation').addEventListener('keydown', event => { if (event.key === 'Escape' && !state.mutating) { $('#delete-confirmation').hidden = true; $('#delete-asset').focus(); } });
  window.addEventListener('hashchange', hashAsset);
  document.addEventListener('visibilitychange', () => { if (document.hidden) clearTimeout(state.timer); else scheduleRefresh(); });
  void loadSettings(); void loadLibrary(); hashAsset();
}
healthButton.addEventListener('click', () => void checkHealth());
if ($('#upload-form')) bootWorkspace();
void checkHealth();
