import { ApiError } from './errors.js';
import { MAX_GLB_BYTES } from './glb.js';
import { PRESETS } from './presets.js';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

function methods(request, allowed) {
  if (!allowed.includes(request.method)) {
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed', { Allow: allowed.join(', ') });
  }
}

function id(value) {
  if (!uuid.test(value)) throw new ApiError(400, 'INVALID_ID', 'Expected a lowercase UUID');
  return value;
}

function queryInteger(query, key, fallback, max) {
  const values = query.getAll(key);
  if (!values.length) return fallback;
  if (values.length !== 1 || !/^(0|[1-9]\d*)$/.test(values[0])) throw new ApiError(400, 'INVALID_QUERY', `${key} must be an integer`);
  const value = Number(values[0]);
  if (!Number.isSafeInteger(value) || value > max || (key === 'limit' && value === 0)) {
    throw new ApiError(400, 'INVALID_QUERY', `${key} is outside its allowed range`);
  }
  return value;
}

function filename(query) {
  const values = query.getAll('filename');
  const name = values[0];
  if (values.length !== 1 || !name || name.length > 180 || name.trim() !== name
    || /[\x00-\x1f\x7f/\\]/.test(name) || !/\.glb$/i.test(name)) {
    throw new ApiError(400, 'INVALID_FILENAME', 'Supply one filename ending in .glb, at most 180 characters, without path separators');
  }
  return name;
}

function contentType(request, allowed) {
  const type = request.headers['content-type']?.split(';')[0].trim().toLowerCase();
  if (!allowed.includes(type)) throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', `Content-Type must be ${allowed.join(' or ')}`);
  if (request.headers['content-encoding'] && request.headers['content-encoding'] !== 'identity') {
    throw new ApiError(415, 'UNSUPPORTED_ENCODING', 'Compressed request bodies are not supported');
  }
}

function readBody(request, limit) {
  const length = Number(request.headers['content-length']);
  if (Number.isFinite(length) && length > limit) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', `Request body exceeds ${limit} bytes`);
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const cleanup = () => {
      clearTimeout(timer);
      request.off('data', data);
      request.off('end', end);
      request.off('aborted', aborted);
      request.off('error', failed);
    };
    const fail = error => { cleanup(); request.pause(); reject(error); };
    const data = chunk => {
      size += chunk.length;
      if (size > limit) return fail(new ApiError(413, 'PAYLOAD_TOO_LARGE', `Request body exceeds ${limit} bytes`));
      chunks.push(chunk);
    };
    const end = () => { cleanup(); resolve(Buffer.concat(chunks, size)); };
    const aborted = () => fail(new ApiError(400, 'INCOMPLETE_BODY', 'Request body was interrupted'));
    const failed = () => fail(new ApiError(400, 'INCOMPLETE_BODY', 'Unable to read request body'));
    const timer = setTimeout(() => fail(new ApiError(408, 'REQUEST_TIMEOUT', 'Request body timed out')), 30_000);
    timer.unref();
    request.on('data', data);
    request.once('end', end);
    request.once('aborted', aborted);
    request.once('error', failed);
  });
}

async function jsonBody(request) {
  contentType(request, ['application/json']);
  const bytes = await readBody(request, 16 * 1024);
  try {
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new ApiError(400, 'INVALID_JSON', 'Expected a JSON object'); }
}

export async function handleApi(request, response, url, store, json, maxUploadBytes = MAX_GLB_BYTES) {
  const route = url.pathname;
  if (route === '/api/health') {
    methods(request, ['GET', 'HEAD']);
    return json(200, { status: 'ok', service: 'meshtrim', version: '0.1.0' });
  }
  if (route === '/api/presets') {
    methods(request, ['GET', 'HEAD']);
    return json(200, { presets: PRESETS, defaultPreset: 'balanced', optimizationAvailable: false, maxUploadBytes });
  }
  if (route === '/api/assets') {
    methods(request, ['GET', 'HEAD', 'POST']);
    if (request.method !== 'POST') return json(200, store.listAssets(
      queryInteger(url.searchParams, 'limit', 20, 100), queryInteger(url.searchParams, 'offset', 0, Number.MAX_SAFE_INTEGER)));
    const name = filename(url.searchParams);
    contentType(request, ['model/gltf-binary', 'application/octet-stream']);
    const bytes = await readBody(request, maxUploadBytes);
    const asset = store.createAsset(name, bytes);
    return json(201, asset, { Location: `/api/assets/${asset.id}` });
  }
  let match = route.match(/^\/api\/assets\/([^/]+)(?:\/(versions|report|jobs|optimizations))?$/);
  if (match) {
    const assetId = id(match[1]);
    const action = match[2];
    if (action === 'optimizations') {
      methods(request, ['POST']);
      const body = await jsonBody(request);
      if (Object.keys(body).length !== 1 || typeof body.preset !== 'string') {
        throw new ApiError(400, 'INVALID_INPUT', 'JSON must contain only the preset string');
      }
      const result = store.enqueueJob(assetId, body.preset);
      return json(202, { ...result, message: 'Job queued. The optimization worker is not implemented yet.' }, { Location: `/api/jobs/${result.job.id}` });
    }
    methods(request, action ? ['GET', 'HEAD'] : ['GET', 'HEAD', 'DELETE']);
    if (request.method === 'DELETE') {
      store.deleteAsset(assetId);
      response.writeHead(204, { 'Cache-Control': 'no-store' });
      return response.end();
    }
    const asset = store.getAsset(assetId);
    if (action === 'versions') return json(200, { versions: asset.versions });
    if (action === 'jobs') return json(200, { jobs: store.listJobs(assetId) });
    if (action === 'report') return json(200, store.report(assetId));
    return json(200, asset);
  }
  match = route.match(/^\/api\/jobs\/([^/]+)$/);
  if (match) {
    methods(request, ['GET', 'HEAD', 'DELETE']);
    return json(200, request.method === 'DELETE' ? store.cancelJob(id(match[1])) : store.getJob(id(match[1])));
  }
  match = route.match(/^\/api\/versions\/([^/]+)(?:\/(file|download))?$/);
  if (match) {
    methods(request, ['GET', 'HEAD']);
    const versionId = id(match[1]);
    if (!match[2]) return json(200, store.getVersion(versionId));
    // HEAD fetches metadata only, avoiding allocation of a large BLOB.
    const version = store.getVersion(versionId);
    const asset = store.getAsset(version.assetId);
    const name = version.kind === 'original' ? asset.filename : `${asset.filename.slice(0, -4)}-${version.preset}.glb`;
    const fallback = name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const encoded = encodeURIComponent(name).replace(/['()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
    response.writeHead(200, {
      'Content-Type': 'model/gltf-binary', 'Content-Length': version.sizeBytes, 'Cache-Control': 'no-store',
      'Content-Disposition': `${match[2] === 'download' ? 'attachment' : 'inline'}; filename="${fallback}"; filename*=UTF-8''${encoded}`,
      ETag: `"${version.sha256}"`,
    });
    return response.end(request.method === 'HEAD' ? undefined : store.getFile(versionId).bytes);
  }
  return json(404, { error: 'API endpoint not found' });
}
