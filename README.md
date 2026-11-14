# HireLoop

Scroll LinkedIn as usual. HireLoop captures the posts on your screen, finds hiring posts that fit you, drafts an email for each, and sends the ones you approve from your Gmail. Runs locally and is free.

See [PLAN.md](PLAN.md) for the architecture and phases, and [docs/](docs/) for the log of every change.

**Status:** Phase 1 (setup, profile, capture) is done. Phase 2: pre-filter, LLM gateway, extract + filter + score are built (docs 007–008); UI polish + replay is next (009).

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

## LLM keys (Phase 2)
Add free keys to `server/.env` (no quotes, no leading `#`), then check them:
```
GEMINI_API_KEY=...   # https://aistudio.google.com/apikey (free tier)
GROQ_API_KEY=...     # https://console.groq.com/keys (free tier, fallback)
OPENAI_API_KEY=...   # optional, PAID, used last
```
```bash
npm run llm:check -w server             # lists the models your keys can use; sends no prompts
npm run llm:check -w server -- --call   # + one real test call per provider on a dummy post
```
Order and models: `LLM_ORDER`, `GEMINI_MODEL`, `GROQ_MODEL`, `OPENAI_MODEL` in `server/.env` (see `.env.example`).
Processing is manual: click **Process** on the Posts page. Only post text is sent to the LLM, with emails and phone numbers masked.

## Load the Chrome extension
1. `chrome://extensions` → turn on **Developer mode** → **Load unpacked** → pick the `extension/` folder.
2. Reload any open LinkedIn tab, then scroll your feed or a search for posts.
3. Captured posts appear in the UI's **Posts** view within a few seconds. The extension popup shows counts and a pause switch.

Details and troubleshooting: [extension/README.md](extension/README.md).

## Scripts
| Command | What it does |
|---|---|
| `npm run dev` | Starts the API (auto-reloads) and the UI together |
| `npm test` | Server tests on a throwaway DB and dummy data (ingest, matching, pre-filter, rules/score, LLM gateway, full pipeline with a fake LLM) |
| `npm run llm:check -w server` | Checks your LLM keys and configured models |
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
| `GET /api/posts/:id` | One post with its extracted job and event log |
| `POST /api/process` | Process `new` + `error` posts in the background (pre-filter → LLM → rules) |
| `POST /api/process/reapply` | Re-run pre-filter + rules on processed posts, no LLM calls |
| `GET /api/process/status` | Progress of the current/last run |

The API listens on 127.0.0.1 only and rejects browser requests from origins other than the extension and localhost.

## Layout
```
server/     Express + TypeScript API, SQLite (data/hireloop.db)
client/     React + TypeScript UI (Vite)
extension/  Chrome MV3 extension (load unpacked)
profile/    your profile, preferences and resume (templates committed, real files ignored)
docs/       one file per change: NNN-short-description.md
```
