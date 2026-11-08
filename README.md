# HireLoop

Scroll LinkedIn as usual. HireLoop captures the posts on your screen, finds hiring posts that fit you, drafts an email for each, and sends the ones you approve from your Gmail. Runs locally and is free.

See [PLAN.md](PLAN.md) for the architecture and phases, and [docs/](docs/) for the log of every change.

## Requirements
- Node.js **22.13 or newer** (uses the built-in `node:sqlite`)
- Google Chrome (for the extension, added in a later change)

## Run
```bash
npm install
cp server/.env.example server/.env   # optional; defaults work
npm run dev
```
- API: http://localhost:3001/api/health
- UI: http://localhost:5173

## Set up your profile
```bash
cp profile/profile.example.md profile/profile.md            # then replace every <…> placeholder
cp profile/preferences.example.yaml profile/preferences.yaml  # then edit filters and limits
cp ~/path/to/your-resume.pdf profile/resume.pdf
```
The UI's **Profile setup** card shows what's missing and how to fix it. See [profile/README.md](profile/README.md). These files are gitignored.

## Scripts
| Command | What it does |
|---|---|
| `npm run dev` | Starts the API (auto-reloads) and the UI together |
| `npm run typecheck` | Type-checks server and client |
| `npm run build` | Builds server (`server/dist`) and client (`client/dist`) |

## Layout
```
server/   Express + TypeScript API, SQLite (data/hireloop.db)
client/   React + TypeScript UI (Vite)
profile/  your profile, preferences and resume (templates committed, real files ignored)
docs/     one file per change: NNN-short-description.md
```
