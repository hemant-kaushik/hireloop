# HireLoop

Scroll LinkedIn as usual. HireLoop captures the posts on your screen, finds hiring posts that fit you, drafts an email for each, and sends the ones you approve from your Gmail. Runs locally and is free.

See [PLAN.md](PLAN.md) for the architecture and phases, and [docs/](docs/) for the log of every change.

**Status:** Phase 1 (setup, profile, capture) is done. Phase 2 (filter + score) is next.

## Requirements
- Node.js **22.13 or newer** (uses the built-in `node:sqlite`)
- Google Chrome

## Run
```bash
npm install
cp server/.env.example server/.env   # optional; defaults work
npm run dev
```
- UI: http://localhost:5173 (Posts and Setup views)
- API: http://localhost:3001/api/health

## Set up your profile
```bash
cp profile/profile.example.md profile/profile.md            # then replace every <…> placeholder
cp profile/preferences.example.yaml profile/preferences.yaml  # then edit filters and limits
cp ~/path/to/your-resume.pdf profile/resume.pdf
```
The UI's **Setup** view shows what's missing and how to fix it. See [profile/README.md](profile/README.md). These files are gitignored.

## Load the Chrome extension
1. `chrome://extensions` → turn on **Developer mode** → **Load unpacked** → pick the `extension/` folder.
2. Reload any open LinkedIn tab, then scroll your feed or a search for posts.
3. Captured posts appear in the UI's **Posts** view within a few seconds. The extension popup shows counts and a pause switch.

Details and troubleshooting: [extension/README.md](extension/README.md).

## Scripts
| Command | What it does |
|---|---|
| `npm run dev` | Starts the API (auto-reloads) and the UI together |
| `npm test` | Server tests (text utils, ingest/dedupe, posts API, origin guard) on a throwaway DB |
| `npm run typecheck` | Type-checks server (including tests) and client |
| `npm run build` | Builds server (`server/dist`) and client (`client/dist`) |

Extension parser tests: open `extension/test/parse.test.html` in Chrome.

## API (Phase 1)
| Route | Purpose |
|---|---|
| `GET /api/health` | API, DB and profile status |
| `GET /api/profile/status` | Profile files: ok / missing / template / invalid, with fixes |
| `POST /api/ingest` | `{ posts: [...] }` from the extension (max 100). Dedupes by key and text hash |
| `GET /api/posts` | `?status=all\|new\|duplicate&q=&limit=&offset=` with counts per status |
| `GET /api/posts/:id` | One post with its event log |

The API listens on 127.0.0.1 only and rejects browser requests from origins other than the extension and localhost.

## Layout
```
server/     Express + TypeScript API, SQLite (data/hireloop.db)
client/     React + TypeScript UI (Vite)
extension/  Chrome MV3 extension (load unpacked)
profile/    your profile, preferences and resume (templates committed, real files ignored)
docs/       one file per change: NNN-short-description.md
```
