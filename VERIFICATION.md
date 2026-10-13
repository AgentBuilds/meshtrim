# Task 1 verification

Verified on Node.js 24.15.0 and npm 11.12.1 in the factory sandbox.

- `npm install --no-audit --no-fund --prefer-offline`: passed.
- `npm run build`: passed; JavaScript syntax checked and frontend copied to `dist/`.
- `npm test`: six checks passed, covering health responses, unknown routes,
  allowed HTTP methods, development/production asset serving, source-file exclusion,
  frontend loading/error states, retry recovery and unexpected API payloads.
- `npm start`: server reached its listening state at `http://127.0.0.1:3001`.
- `npm run dev`: source-serving watcher reached its listening state.
- Design token contrast calculations: every text/accent/error pair on the three
  background surfaces exceeds 4.5:1 (lowest checked ratio: 6.76:1).
- `git diff --check`: passed.

## Environment limits

The sandbox denied registry access and the shared cache did not contain the proposed
framework dependencies. The final scaffold deliberately has no third-party dependencies.

The sandbox denied HTTP requests to loopback from terminal tests. Routing checks
therefore invoke the real HTTP server request listener in-process without sockets.
Server startup was verified separately; live HTTP behavior is not claimed as verified.

The in-app browser was unavailable. Chrome automation failed to load its request-header
policy on the initial inventory and retry. Browser rendering, responsive geometry,
keyboard interaction and console errors could not be inspected. The frontend error
and recovery flows were exercised in a JavaScript VM with a minimal DOM adapter;
this is not a substitute for a browser check.

## Manual browser check when the connector is available

1. Run `npm run build` and `npm start`; open `http://127.0.0.1:3001`.
2. Confirm “API connected”; click “Check again” and check the browser console.
3. Select each preset by mouse and keyboard; confirm visible focus.
4. Check 320px, 375px and desktop viewport widths for overflow and readable previews.
5. Confirm upload and download remain disabled and explain the future scope.
