# HireLoop — Project Rules

Read `PLAN.md` first. It has the architecture, data model and phases.

## Mandatory workflow for every change / PR
1. **Before writing code**, create `docs/NNN-short-change-description.md`:
   - `NNN` = next zero-padded index after the highest existing file in `docs/` (001, 002, …).
   - Short kebab-case description, e.g. `003-llm-gateway.md`.
   - Contents: Goal, Scope (what's in / out), Design, Files touched, How to test, Status.
2. Then implement the change.
3. When done, update that doc's **Status** section with what was actually built, test results, and open questions.
4. If the change alters the architecture or phases, update `PLAN.md` in the same change.

## Stack
- `server/`: Node.js + Express + TypeScript (run with `tsx`), SQLite via built-in `node:sqlite` (Node ≥ 22.13).
- `client/`: React + TypeScript + Vite; proxies `/api` to the server.
- `extension/`: Chrome MV3, plain JS, no build step.
- Ports: API 3001, UI 5173.

## Conventions
- Secrets only in `server/.env`; the client never sees a key.
- All LinkedIn DOM selectors live in `extension/selectors.js`.
- Never add automation that clicks, scrolls, connects or messages on LinkedIn.
- Real profile files (`profile/profile.md`, `profile/preferences.yaml`, `profile/resume.pdf`) are gitignored; `*.example.*` templates are committed.
- Every pipeline decision is logged to the `events` table.
