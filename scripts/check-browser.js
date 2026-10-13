// Real-browser acceptance check against an isolated, disposable database.
// Optional tooling: npm install --save-dev playwright --no-audit --no-fund --prefer-offline
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app.js';
import { glbFixture } from '../tests/fixtures.js';

let chromium;
try { ({ chromium } = await import('playwright')); }
catch { throw new Error('Browser checks require Playwright. Install it with npm install --save-dev playwright --no-audit --no-fund --prefer-offline.'); }

const server = createApp({ databasePath: ':memory:' });
let browser;
// A hard bound prevents a stuck browser or cleanup from repeating the factory timeout.
const deadline = setTimeout(() => { console.error('Browser acceptance exceeded 90 seconds.'); process.exit(1); }, 90_000);
try {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  console.log(`HTTP readiness: ${base} (isolated database)`);
  browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'chrome', headless: true, timeout: 15_000 });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', entry => { if (entry.type() === 'error') errors.push(entry.text()); });
  const visible = selector => page.locator(selector).waitFor({ state: 'visible' });
  const text = (selector, expected) => page.waitForFunction(([s, value]) => document.querySelector(s)?.textContent.includes(value), [selector, expected]);
  const enabled = selector => page.waitForFunction(s => !document.querySelector(s)?.disabled, selector);
  const step = label => console.log(`PASS: ${label}`);
  await page.goto(base);
  await text('#api-status-text', 'API connected');
  await enabled('#glb-file');
  assert.equal(await page.locator('input[name=preset]').count(), 3);
  assert.equal(await page.locator('input[value=balanced]').isChecked(), true);
  await text('#library-status', '0 saved assets');
  assert.equal(await page.locator('#upload-button').isDisabled(), true);
  assert.equal(await page.locator('#asset-details').isVisible(), false);
  step('API readiness, honest empty states and three presets');

  await page.locator('#glb-file').setInputFiles({ name: 'scene.txt', mimeType: 'text/plain', buffer: Buffer.from('bad') });
  await text('#upload-error', 'ending in .glb');
  assert.equal(await page.locator('#upload-button').isDisabled(), true);
  const original = glbFixture('Original metadata retained');
  await page.locator('#glb-file').setInputFiles({ name: 'triangle.glb', mimeType: 'model/gltf-binary', buffer: original });
  await page.locator('#upload-button').click();
  await text('#asset-title', 'triangle.glb');
  await visible('#asset-details');
  await enabled('#optimize-button');
  assert.match(await page.locator('#meshes').innerText(), /Triangle/);
  await page.getByText('Textures (1)', { exact: true }).click();
  assert.match(await page.locator('#textures').innerText(), /Pixel/);
  assert.match(await page.locator('#size-report').innerText(), /Awaiting output/);
  const assetId = new URL(page.url()).hash.slice(7);
  assert.equal(await page.locator('.asset-row[aria-pressed=true]').count(), 1);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download original', exact: true }).click();
  const download = await downloadPromise;
  assert.equal(download.suggestedFilename(), 'triangle.glb');
  const chunks = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk);
  assert.deepEqual(Buffer.concat(chunks), original);
  step('Invalid-file feedback, upload, mesh/texture inspection and byte-exact download');

  await page.locator('input[value=compact]').check();
  await text('#preset-detail', '1024px');
  await page.locator('#optimize-button').click();
  await text('#action-status', 'Compact job queued');
  assert.match(await page.locator('#jobs').innerText(), /queued/i);
  await enabled('#optimize-button');
  await page.locator('#optimize-button').click();
  await text('#action-status', 'already queued');
  assert.equal(await page.locator('.job-row').count(), 1);
  await page.getByRole('button', { name: 'Cancel Compact queued job' }).click();
  await text('#action-status', 'Job cancelled');
  assert.match(await page.locator('#jobs').innerText(), /cancelled/i);
  step('Preset selection, queue reuse, cancellation and no fabricated savings');

  // Seed through the backend's internal worker boundary; no optimizer is implied.
  server.store.enqueueJob(assetId, 'balanced');
  server.store.completeJob(server.store.claimJob().id, glbFixture());
  server.store.enqueueJob(assetId, 'quality');
  server.store.completeJob(server.store.claimJob().id, glbFixture('x'.repeat(200)));
  await page.locator('#refresh-asset').click();
  await enabled('#version-select');
  await text('#optimized-panel', 'triangles');
  assert.equal(await page.locator('#version-select option').count(), 2);
  const versions = server.store.report(assetId).versions;
  const balanced = versions.find(v => v.preset === 'balanced');
  const quality = versions.find(v => v.preset === 'quality');
  await page.locator('#version-select').selectOption(balanced.id);
  await text('#optimized-panel', 'Balanced version');
  await text('#report-note', 'saved');
  await page.locator('#version-select').selectOption(quality.id);
  await text('#optimized-panel', 'Quality version');
  await text('#size-report', 'larger');
  await text('#report-note', 'added');
  await page.reload();
  await text('#asset-title', 'triangle.glb');
  await enabled('#refresh-asset');
  step('Saved version comparison, negative savings and deep-link reload');

  // Verify late HTTP responses cannot replace a more recent asset selection.
  const other = server.store.createAsset('other.glb', glbFixture());
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let routeFinished;
  const routed = new Promise(resolve => { routeFinished = resolve; });
  await page.route(`**/api/assets/${assetId}`, async route => {
    await gate;
    try { await route.continue(); } finally { routeFinished(); }
  });
  await page.locator('#refresh-asset').click();
  await text('#detail-status', 'Loading inspection');
  await page.locator('#refresh-library').click();
  await text('#library-status', '2 saved assets');
  await page.getByRole('button', { name: /^other.glb/ }).click();
  await text('#asset-title', 'other.glb');
  release();
  await routed;
  await page.unroute(`**/api/assets/${assetId}`);
  await page.waitForLoadState('networkidle');
  assert.equal(await page.locator('#asset-title').textContent(), 'other.glb');
  assert.equal(new URL(page.url()).hash, `#asset=${other.id}`);
  step('Selection races keep the current asset and controls consistent');

  const longName = `${'scene-'.repeat(27)}.glb`;
  await page.locator('#glb-file').setInputFiles({ name: longName, mimeType: 'model/gltf-binary', buffer: glbFixture() });
  await page.locator('#upload-button').click();
  await text('#asset-title', longName);
  await enabled('#refresh-asset');
  await page.locator('#refresh-asset').focus();
  assert.ok(await page.locator('.skip-link').evaluate(element => element.getBoundingClientRect().bottom <= 0), 'Unfocused skip link stays outside the viewport');
  await mkdir(new URL('../output/playwright/', import.meta.url), { recursive: true });
  for (const width of [320, 375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    const dimensions = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(dimensions.content <= dimensions.viewport, `Horizontal overflow at ${width}px: ${dimensions.content}`);
  }
  await page.screenshot({ path: fileURLToPath(new URL('../output/playwright/workbench-desktop.png', import.meta.url)), fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({ path: fileURLToPath(new URL('../output/playwright/workbench-mobile.png', import.meta.url)), fullPage: true });
  await page.keyboard.press('Tab');
  await page.locator('#refresh-library').focus();
  assert.equal(await page.locator('#refresh-library').evaluate(element => getComputedStyle(element).outlineStyle), 'solid');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await page.locator('#refresh-library').evaluate(element => getComputedStyle(element).transitionDuration), '0s');
  step('320–1440px layouts, long filenames, visible keyboard focus and reduced motion');

  await page.locator('#delete-asset').click();
  await visible('#delete-confirmation');
  assert.equal(await page.locator('#cancel-delete').evaluate(e => e === document.activeElement), true);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#delete-confirmation').isVisible(), false);
  await page.locator('#delete-asset').click();
  await page.locator('#confirm-delete').click();
  await text('#detail-status', 'deleted');
  assert.equal(await page.locator('#asset-details').isVisible(), false);
  assert.equal(await page.locator('#optimize-button').isDisabled(), true);
  assert.equal(new URL(page.url()).hash, '');
  assert.deepEqual(errors, [], 'The normal user flow must have no console or page errors');
  step('Inline confirmation, Escape cancellation, deletion and zero console errors');

  // Controlled failure responses exercise the UI; browser HTTP-error diagnostics
  // are expected here, but JavaScript exceptions remain failures.
  errors.length = 0;
  await page.route('**/api/assets?*', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Temporary library outage' }) }));
  await page.locator('#refresh-library').click();
  await text('#library-status', 'Temporary library outage');
  await page.unroute('**/api/assets?*');
  await page.locator('#refresh-library').click();
  await text('#library-status', '2 saved assets');
  await page.route('**/api/presets', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Temporary preset outage' }) }));
  await page.reload();
  await text('#upload-note', 'Temporary preset outage');
  assert.equal(await page.locator('#glb-file').isDisabled(), true);
  await page.unroute('**/api/presets');
  await enabled('#check-api');
  await page.locator('#check-api').click();
  await enabled('#glb-file');
  await page.locator('#glb-file').setInputFiles({ name: 'broken.glb', mimeType: 'model/gltf-binary', buffer: Buffer.from('invalid GLB bytes') });
  await page.locator('#upload-button').click();
  await text('#upload-status', 'could not be confirmed');
  assert.ok((await page.locator('#upload-error').textContent()).length > 0);
  assert.deepEqual(errors.filter(e => !e.startsWith('Failed to load resource:')), [], 'Failure recovery must not raise JavaScript errors');
  step('Library and preset outage recovery, server validation and actionable errors');
  for (let index = 0; index < 9; index++) server.store.createAsset(`library-${index}.glb`, glbFixture());
  await page.locator('#refresh-library').click();
  await text('#library-status', '11 saved assets');
  await text('#page-label', '1–8 of 11');
  assert.equal(await page.locator('.asset-row').count(), 8);
  await page.locator('#next-page').click();
  await text('#page-label', '9–11 of 11');
  assert.equal(await page.locator('.asset-row').count(), 3);
  assert.equal(await page.locator('#next-page').isDisabled(), true);
  await page.locator('#previous-page').click();
  await text('#page-label', '1–8 of 11');
  assert.equal(await page.locator('#previous-page').isDisabled(), true);
  step('Library pagination, item counts and first/last-page controls');
  console.log('Browser acceptance passed. Screenshots: output/playwright/');
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  clearTimeout(deadline);
}
