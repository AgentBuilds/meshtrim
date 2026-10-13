# MeshTrim

> A web asset optimizer for developers shipping 3D scenes: upload a GLB, inspect its meshes and textures, and preview an optimized version beside the original. The backend deduplicates geometry, resizes textures, compresses assets, and stores downloadable versions with size reports. Limit the approximately 10-task MVP to GLB input, three optimization presets, and synchronized before-and-after viewers.

_Bu loyiha AI Farm tomonidan avtonom tarzda qurilmoqda..._

## Run locally

Requires Node.js 22.12+ and npm. This scaffold uses Node's built-in HTTP server
and native browser modules, with no third-party runtime or build dependencies.
The npm registry was blocked in the factory sandbox and the shared cache lacked
the proposed framework packages, so this foundation builds fully offline.

```sh
npm install --no-audit --no-fund --prefer-offline
npm run dev
```

Open http://127.0.0.1:3001. The development server serves frontend source files;
Node's watch mode restarts it when server modules change. Refresh the browser after
frontend edits. On Windows PowerShell, use `npm.cmd` if execution policy blocks `npm.ps1`.

```sh
npm run build
npm start
```

The build checks JavaScript syntax and creates the static frontend in `dist/`.
The production server serves that directory and the API at http://127.0.0.1:3001.
Build before starting. `PORT` and `HOST` configure the listener, with loopback as
the default host. Use `HOST=0.0.0.0` for a container.

## Scaffold scope

- Native HTML/CSS/JavaScript frontend and Node.js HTTP API.
- `GET /api/health` returns `{ "status": "ok", "service": "meshtrim", "version": "0.1.0" }`.
- Responsive workbench with API connectivity feedback and three selectable presets.
- Honest empty preview/report states. Upload, GLB inspection, optimization,
  synchronized 3D cameras, storage and downloads are future tasks.
- Static files are served through an explicit allowlist; other resources return JSON 404s.

## Structure and verification

- `index.html`, `src/`: frontend entry, API check and design tokens.
- `server/`: HTTP app factory and server entry.
- `scripts/build.js`: deterministic static build and syntax checks.
- `public/`: static assets; `dist/`: generated production build (ignored).
- `tests/`: in-process HTTP routing/static-serving and frontend connectivity checks;
  run `npm run build` before `npm test` to generate the production assets.
- `DESIGN_SYSTEM.md`: palette, typography, interaction and accessibility decisions.
