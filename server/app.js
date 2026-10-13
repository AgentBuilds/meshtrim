import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { AssetStore } from './store.js';
import { handleApi } from './api.js';
import { ApiError } from './errors.js';
import { MAX_GLB_BYTES } from './glb.js';

export const distDirectory = fileURLToPath(new URL('../dist/', import.meta.url));
const contentTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
const staticRoutes = {
  '/': 'index.html',
  '/index.html': 'index.html',
  '/src/styles.css': 'src/styles.css',
  '/src/app.js': 'src/app.js',
  '/favicon.svg': 'favicon.svg',
};

function json(request, response, status, body, extraHeaders = {}) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders });
  response.end(request.method === 'HEAD' ? undefined : JSON.stringify(body));
}

export function createApp({ staticDirectory = distDirectory, development = false, databasePath, maxUploadBytes = MAX_GLB_BYTES } = {}) {
  if (!Number.isInteger(maxUploadBytes) || maxUploadBytes < 20 || maxUploadBytes > MAX_GLB_BYTES) throw new Error('Invalid upload byte limit');
  const store = new AssetStore(databasePath);
  const server = createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const sendJson = (status, body, headers) => json(request, response, status, body, headers);
    let url;
    try {
      url = new URL(request.url, 'http://localhost');
      decodeURI(url.pathname);
    } catch {
      return sendJson(400, { error: 'Invalid request URL' });
    }
    const pathname = url.pathname;
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      try {
        if (!['GET', 'HEAD'].includes(request.method)) {
          const origin = request.headers?.origin;
          let sameOrigin = !origin;
          if (origin) {
            try {
              const parsed = new URL(origin);
              sameOrigin = ['http:', 'https:'].includes(parsed.protocol) && parsed.host === request.headers.host;
            } catch { sameOrigin = false; }
          }
          if (!sameOrigin || request.headers?.['sec-fetch-site'] === 'cross-site') {
            throw new ApiError(403, 'CROSS_ORIGIN_REQUEST', 'Cross-origin writes are not allowed');
          }
        }
        return await handleApi(request, response, url, store, sendJson, maxUploadBytes);
      } catch (error) {
        if (response.destroyed || response.writableEnded) return;
        if (response.headersSent) return response.destroy();
        const headers = request.complete === false ? { Connection: 'close' } : {};
        if (error instanceof ApiError) return sendJson(error.status, { error: error.message, code: error.code }, { ...headers, ...error.headers });
        console.error('API request failed:', error.code || error.name);
        return sendJson(500, { error: 'Internal server error', code: 'INTERNAL_ERROR' }, headers);
      }
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return sendJson(405, { error: 'Method not allowed' }, { Allow: 'GET, HEAD' });
    }
    // An explicit allowlist prevents serving source/configuration files by URL.
    const relativePath = staticRoutes[pathname];
    if (!relativePath || !Object.hasOwn(staticRoutes, pathname) || !staticDirectory) {
      return sendJson(404, { error: 'Resource not found' });
    }
    const filePath = development && pathname === '/favicon.svg'
      ? path.join(staticDirectory, 'public', relativePath)
      : path.join(staticDirectory, relativePath);
    try {
      const body = await readFile(filePath);
      response.writeHead(200, {
        'Content-Type': contentTypes[path.extname(filePath)],
        'Cache-Control': 'no-cache',
        'Content-Length': body.byteLength,
      });
      response.end(request.method === 'HEAD' ? undefined : body);
    } catch (error) {
      if (error.code === 'ENOENT') return sendJson(404, { error: 'Resource not found. Run npm run build before npm start.' });
      console.error(`Static resource error: ${error.code || 'unknown'}`);
      sendJson(500, { error: 'Unable to serve resource' });
    }
  });
  server.store = store;
  server.on('close', () => store.close());
  server.requestTimeout = 35_000;
  server.headersTimeout = 30_000;
  return server;
}
