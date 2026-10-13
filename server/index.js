import { createApp } from './app.js';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { distDirectory } from './app.js';

const port = Number(process.env.PORT || 3001);
const host = process.env.HOST || '127.0.0.1';
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535');
}

const development = process.argv.includes('--dev');
if (!development && !existsSync(new URL('../dist/index.html', import.meta.url))) {
  throw new Error('Production build missing. Run npm run build before npm start.');
}
const staticDirectory = development ? fileURLToPath(new URL('../', import.meta.url)) : distDirectory;
const server = createApp({ staticDirectory, development, databasePath: process.env.DATABASE_PATH });
server.store.recoverInterruptedJobs();
server.listen(port, host, () => {
  console.log(`MeshTrim is running at http://${host}:${port}`);
});

server.on('error', (error) => {
  console.error(`MeshTrim could not start: ${error.message}`);
  server.store.close();
  process.exitCode = 1;
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close());
}
