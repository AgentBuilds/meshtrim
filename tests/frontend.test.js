import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));

function boot(fetch) {
  const elements = Object.fromEntries(['#api-status', '#api-status-text', '#check-api'].map(id => [id, {
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(_event, handler) { this.click = handler; },
  }]));
  vm.runInNewContext(source, { document: { querySelector: selector => elements[selector] }, fetch, AbortSignal });
  return { status: elements['#api-status'], text: elements['#api-status-text'], button: elements['#check-api'] };
}

test('health check is disabled while loading and enables retry after a failure', async () => {
  let reject;
  const ui = boot(() => new Promise((_resolve, rejectRequest) => { reject = rejectRequest; }));
  assert.equal(ui.button.disabled, true);
  assert.equal(ui.button.attributes['aria-busy'], 'true');
  reject(new Error('Network unavailable'));
  await settle();
  assert.equal(ui.button.disabled, false);
  assert.equal(ui.button.textContent, 'Retry');
  assert.match(ui.text.textContent, /API unavailable/);
});

test('a failed API check recovers when the user retries', async () => {
  let attempts = 0;
  const ui = boot(async () => {
    if (++attempts === 1) return { ok: false };
    return { ok: true, json: async () => ({ status: 'ok', service: 'meshtrim' }) };
  });
  await settle();
  assert.equal(ui.button.textContent, 'Retry');
  ui.button.click();
  await settle();
  assert.equal(ui.text.textContent, 'API connected');
  assert.equal(ui.button.textContent, 'Check again');
  assert.equal(ui.button.attributes['aria-busy'], 'false');
});

test('an unexpected response is reported as an API error', async () => {
  const ui = boot(async () => ({ ok: true, json: async () => ({ status: 'ok', service: 'another-app' }) }));
  await settle();
  assert.match(ui.status.className, /error/);
  assert.equal(ui.button.textContent, 'Retry');
});
