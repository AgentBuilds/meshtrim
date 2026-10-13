# MeshTrim

> A web asset optimizer for developers shipping 3D scenes: upload a GLB, inspect its meshes and textures, and preview an optimized version beside the original. The backend deduplicates geometry, resizes textures, compresses assets, and stores downloadable versions with size reports. Limit the approximately 10-task MVP to GLB input, three optimization presets, and synchronized before-and-after viewers.

_Bu loyiha AI Farm tomonidan avtonom tarzda qurilmoqda..._

## Run locally

Requires Node.js 22.13+ and npm. This project uses Node's built-in HTTP server and SQLite
and native browser modules, with no third-party runtime or build dependencies.
Node provides everything needed for this foundation, so installation and builds
work without downloading framework packages.

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

## Current scope

- Native HTML/CSS/JavaScript frontend and Node.js HTTP API.
- `GET /api/health` returns `{ "status": "ok", "service": "meshtrim", "version": "0.1.0" }`.
- Responsive workbench with API connectivity feedback and three selectable presets.
- SQLite-backed GLB upload, mesh/texture inspection, stored versions, downloads,
  size reports and persistent optimization jobs are available through the API.
- API-connected uploads and asset library with pagination, mesh/texture inspection,
  three presets, queue/cancel controls, saved-version comparisons and downloads.
- Responsive loading, empty and error states, deep links, keyboard controls and
  measured size reports. The optimization worker and synchronized 3D cameras are
  future tasks; comparison panels currently show file inspection details.
- Static files are served through an explicit allowlist; other resources return JSON 404s.

## Backend API

All paths are same-origin. JSON failures contain `error` and, for known API
validation/resource errors, a machine-readable `code`. Upload GLB v2 files as
raw bytes with `Content-Type: model/gltf-binary` or `application/octet-stream`;
multipart uploads are not supported. Maximum size is 50 MiB. Files must contain
embedded resources; external buffer/image URLs are rejected. Validation checks
container structure and inspection references, rather than the complete glTF spec.

| Method | Path | Result |
| --- | --- | --- |
| GET / HEAD | `/api/health` | Service health |
| GET / HEAD | `/api/presets` | Quality, Balanced, Compact settings and upload limit |
| POST | `/api/assets?filename=scene.glb` | Store original bytes and inspection; 201 + Location |
| GET / HEAD | `/api/assets?limit=20&offset=0` | Paginated asset list and total; limit 1–100 |
| GET / HEAD | `/api/assets/:id` | Asset, inspection and versions |
| DELETE | `/api/assets/:id` | Delete asset, versions and jobs; 204 |
| GET / HEAD | `/api/assets/:id/versions` | Version list |
| GET / HEAD | `/api/assets/:id/report` | Original/output byte sizes and measured savings |
| GET / HEAD | `/api/assets/:id/jobs` | Optimization job history |
| POST | `/api/assets/:id/optimizations` | Queue `{ "preset": "balanced" }`; 202 + Location |
| GET / HEAD | `/api/jobs/:id` | Persisted job status and output version ID |
| DELETE | `/api/jobs/:id` | Cancel queued job; repeat cancellation is safe |
| GET / HEAD | `/api/versions/:id` | Version metadata and inspection |
| GET / HEAD | `/api/versions/:id/file` | Inline GLB for a viewer |
| GET / HEAD | `/api/versions/:id/download` | GLB attachment with UTF-8 filename |

IDs are lowercase UUIDs. Invalid input returns 400, missing resources 404,
unsupported methods 405 with Allow, job state conflicts 409, oversized bodies
413, unsupported media types/encoding 415 and malformed GLBs 422. Cross-origin
writes return 403; this local MVP has no account authentication.

Example upload and job request (replace the returned asset ID):

```sh
curl -X POST -H "Content-Type: model/gltf-binary" --data-binary @scene.glb "http://127.0.0.1:3001/api/assets?filename=scene.glb"
curl -X POST -H "Content-Type: application/json" -d '{"preset":"balanced"}' http://127.0.0.1:3001/api/assets/ASSET_ID/optimizations
```

On PowerShell use `curl.exe`. SQLite defaults to `data/meshtrim.sqlite`; set
`DATABASE_PATH` to another file if needed. Original GLB bytes, inspection,
versions and jobs persist in that database. WAL mode and foreign keys are enabled,
and asset/version and job transitions use transactions. Runtime databases and
test databases are excluded from Git.

An active job for the same asset/preset is reused. The API reports
`optimizationAvailable: false`: queued jobs wait for the future worker and do
not imply an optimized download exists. The store provides internal claim,
complete and fail methods for that worker, and startup marks interrupted running
jobs failed while preserving queued jobs. Assets with running jobs cannot be
deleted. Size reports use actual stored bytes and can show negative savings if
an output is larger. No sample assets are inserted automatically.

## Structure and verification

- `index.html`, `src/`: API-connected asset workbench and design tokens.
- `server/`: HTTP app factory and server entry.
- `scripts/build.js`: deterministic static build and syntax checks.
- `public/`: static assets; `dist/`: generated production build (ignored).
- `tests/`: HTTP routing/static-serving, live loopback HTTP and frontend connectivity
  checks. Run `npm test`; its pretest script builds fresh production assets first.
- `DESIGN_SYSTEM.md`: palette, typography, interaction and accessibility decisions.

Browser acceptance: install optional test tooling with
`npm install --save-dev playwright --no-audit --no-fund --prefer-offline`, then run
`npm run acceptance`. It launches installed Chrome against an isolated in-memory
database, exercises the workbench and writes screenshots to `output/playwright/`.
Set `BROWSER_CHANNEL` for another installed Playwright-compatible browser channel.
The check has a 90-second deadline and closes its browser and server on completion.
Completed output fixtures are seeded at the internal worker boundary to verify
comparison and download UI; they do not represent an implemented optimizer.
