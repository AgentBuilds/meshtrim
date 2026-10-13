import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const distDirectory = fileURLToPath(new URL('../dist/', import.meta.url));
const contentTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
const staticRoutes = {
  '/': 'index.html',
  '/index.html': 'index.html',
  '/src/styles.css': 'src/styles.css',
  '/src/app.js': 'src/app.js',
  '/favicon.svg': 'favicon.svg',
};

function json(response, status, body, extraHeaders = {}) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders });
  response.end(JSON.stringify(body));
}

export function createApp({ staticDirectory = distDirectory, development = false } = {}) {
  return createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    let pathname;
    try {
      pathname = new URL(request.url, 'http://localhost').pathname;
    } catch {
      return json(response, 400, { error: 'Invalid request URL' });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return json(response, 405, { error: 'Method not allowed' }, { Allow: 'GET, HEAD' });
    }
    if (pathname === '/api/health') {
      return json(response, 200, { status: 'ok', service: 'meshtrim', version: '0.1.0' });
    }
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      return json(response, 404, { error: 'API endpoint not found' });
    }
    // An explicit allowlist prevents serving source/configuration files by URL.
    const relativePath = staticRoutes[pathname];
    if (!relativePath || !Object.hasOwn(staticRoutes, pathname) || !staticDirectory) {
      return json(response, 404, { error: 'Resource not found' });
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
      if (error.code === 'ENOENT') return json(response, 404, { error: 'Resource not found. Run npm run build before npm start.' });
      console.error(`Static resource error: ${error.code || 'unknown'}`);
      json(response, 500, { error: 'Unable to serve resource' });
    }
  });
}
