import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, distDirectory } from '../server/app.js';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';

// Exercise the real HTTP request listener without opening sockets. This also
// keeps routing and file-exposure checks independent of network behavior.
function request(server, url, method = 'GET') {
  return new Promise(resolve => {
    const headers = new Map();
    server.emit('request', { url, method }, {
      setHeader(name, value) { headers.set(name.toLowerCase(), String(value)); },
      writeHead(status, values) {
        this.status = status;
        for (const [name, value] of Object.entries(values)) this.setHeader(name, value);
      },
      end(body) {
        const content = body ? body.toString() : '';
        resolve({ status: this.status, headers, text: () => content, json: () => JSON.parse(content) });
      },
    });
  });
}

test('health API responds and unknown API routes remain JSON 404s', async t => {
  const server = createApp({ staticDirectory: null, databasePath: ':memory:' });
  t.after(() => server.store.close());
  const health = await request(server, '/api/health');
  assert.equal(health.status, 200);
  assert.equal(health.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await health.json(), { status: 'ok', service: 'meshtrim', version: '0.1.0' });
  const missing = await request(server, '/api/missing');
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { error: 'API endpoint not found' });
  const post = await request(server, '/api/health', 'POST');
  assert.equal(post.status, 405);
  assert.equal(post.headers.get('allow'), 'GET, HEAD');
});

test('production server responds over HTTP with health JSON, assets and empty HEAD bodies', async t => {
  const server = createApp({ databasePath: ':memory:' });
  t.after(() => new Promise(resolve => {
    server.close(resolve);
    server.closeAllConnections();
  }));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = (route, method = 'GET') => fetch(`${base}${route}`, {
    method, signal: AbortSignal.timeout(5000),
  });

  const health = await get('/api/health');
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok', service: 'meshtrim', version: '0.1.0' });
  const page = await get('/');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /MeshTrim/);
  for (const route of ['/', '/api/health', '/missing']) {
    const head = await get(route, 'HEAD');
    assert.equal(head.status, route === '/missing' ? 404 : 200);
    assert.equal(await head.text(), '');
  }
});

for (const development of [true, false]) {
  test(`${development ? 'development' : 'production'} server serves frontend assets without exposing project files`, async t => {
    const server = createApp({
      development,
      databasePath: ':memory:',
      staticDirectory: development ? fileURLToPath(new URL('../', import.meta.url)) : distDirectory,
    });
    t.after(() => server.store.close());
    const page = await request(server, '/');
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /text\/html/);
    assert.match(await page.text(), /Your scene, streamlined/);
    for (const [asset, type] of [['/src/app.js', 'javascript'], ['/src/styles.css', 'css'], ['/favicon.svg', 'svg']]) {
      const response = await request(server, asset);
      assert.equal(response.status, 200);
      assert.ok(response.headers.get('content-type').includes(type));
      assert.ok((await response.text()).length > 0);
    }
    const head = await request(server, '/', 'HEAD');
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
    for (const resource of ['/package.json', '/server/app.js', '/.env', '/__proto__', '/api/missing', '/missing.js']) {
      const response = await request(server, resource);
      assert.equal(response.status, 404, resource);
      assert.match(response.headers.get('content-type'), /application\/json/);
    }
  });
}
