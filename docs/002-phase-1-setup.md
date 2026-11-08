# 002 — Phase 1 (part 1 of 3): Project setup

Phase 1 is split into three reviewable changes:
1. **002 — Setup** ← this doc
2. 003 — Profile (templates, loader, health check of profile files)
3. 004 — Capture (extension, ingest API, posts page)

## Goal
A working skeleton: `npm install && npm run dev` starts an Express + TypeScript API and a React + TypeScript UI. The UI shows that the API and the database are healthy.

## Scope
**In**
- Root `package.json` with npm workspaces (`server`, `client`) and scripts:
  - `npm run dev` runs API and UI together (via `concurrently`)
  - `npm run build` and `npm run typecheck` cover both workspaces
- `.gitignore` (node_modules, build output, `server/.env`, `data/`, real profile files)
- `server/` — Express + TypeScript, run with `tsx watch` in dev
  - `src/config.ts`: loads `server/.env` with Node's built-in `process.loadEnvFile` (no dotenv), exposes port + paths
  - `src/db/index.ts`: opens `data/hireloop.db` with built-in `node:sqlite`, WAL mode, versioned migrations via `PRAGMA user_version`
  - Migration v1: `posts` and `events` tables (the base tables Phase 1 capture needs)
  - `src/routes/health.ts`: `GET /api/health` → app, version, uptime, Node version, DB status + schema version
  - JSON error handler, 404 for unknown `/api/*`, request size limit
  - `.env.example`
- `client/` — React + TypeScript + Vite
  - Vite dev server on 5173, proxies `/api` → `http://localhost:3001`
  - One page: HireLoop header + a status card that polls `/api/health` every 5 s (API up/down, DB OK, schema version)
- `README.md` with requirements and run instructions

**Out**
- Profile files (003), extension and ingest (004), anything LLM or email.

## Design
- **Why `node:sqlite`:** built into Node ≥ 22.13 (this machine has v25.8.1), so there is no native module to compile. Its API is synchronous, like `better-sqlite3`.
- **Why migrations through `user_version`:** a single integer in the DB file says which migrations have run. Adding a table later means appending to the `MIGRATIONS` array. No migration library needed.
- **Why a Vite proxy:** the UI calls `/api/...` on its own origin, so there's no CORS setup in dev, and the client code never hardcodes the API port.
- **Engines:** `node >= 22.13` is declared in the root `package.json`.

## Files
```
package.json  .gitignore  README.md
server/package.json  server/tsconfig.json  server/.env.example
server/src/index.ts  server/src/config.ts  server/src/db/index.ts  server/src/db/migrations.ts  server/src/routes/health.ts
client/package.json  client/tsconfig.json  client/vite.config.ts  client/index.html
client/src/main.tsx  client/src/App.tsx  client/src/styles.css  client/src/lib/api.ts  client/src/components/HealthCard.tsx
```

## How to test
1. `npm install`
2. `cp server/.env.example server/.env` (optional, defaults work)
3. `npm run dev`
4. `curl http://localhost:3001/api/health` → `"ok": true`, `"db": { "ok": true, "schemaVersion": 1 }`
5. Open http://localhost:5173: the status card shows API online, database OK.
6. Offline state: run only the UI (`npm run dev -w client`) and open http://localhost:5173. The card shows "API offline". (With `npm run dev`, stopping one process stops both, by design.)
7. `npm run typecheck` and `npm run build` pass.

## Status
**Done. Waiting for owner review.**

Built as scoped above. Results on 2026-11-08 (Node v25.8.1):
- `npm install`: 171 packages, 0 vulnerabilities.
- `npm run typecheck`: server and client pass.
- `npm run build`: server → `server/dist`, client → `client/dist` (227 kB JS, 71 kB gzipped).
- `GET /api/health` returns `ok: true, db.schemaVersion: 1`, both directly on :3001 and through the Vite proxy on :5173.
- Unknown route `GET /api/nope` returns JSON 404.
- DB file `data/hireloop.db` created; tables `posts`, `events` present; migration log line `[db] migrated to v1`.
- UI screenshots checked: the online state shows green API and DB; the UI-only run shows "API offline" in red, DB "unknown".

Notes:
- Versions installed: Express 5, React 19, Vite 6, TypeScript 5.8, tsx 4.
- `concurrently -k` means Ctrl+C or a crash in either process stops both, so you never end up with a UI talking to a dead API without noticing.
- The API binds to `127.0.0.1` only, so other devices on your Wi-Fi can't reach it.
- `git init` done. Nothing committed yet.

Open questions: none for this part.
