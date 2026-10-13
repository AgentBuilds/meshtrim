import { mkdir, copyFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
for (const file of ['src/app.js', 'server/app.js', 'server/index.js', 'server/api.js', 'server/store.js', 'server/glb.js', 'server/presets.js', 'server/errors.js', 'scripts/build.js']) {
  const result = spawnSync(process.execPath, ['--check', fileURLToPath(new URL(file, root))], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
await mkdir(new URL('dist/src/', root), { recursive: true });
for (const [source, target] of [
  ['index.html', 'index.html'],
  ['src/styles.css', 'src/styles.css'],
  ['src/app.js', 'src/app.js'],
  ['public/favicon.svg', 'favicon.svg'],
]) {
  await copyFile(new URL(source, root), new URL(`dist/${target}`, root));
}
console.log('MeshTrim build complete: dist/ (HTML, CSS, JavaScript, favicon).');
