# 003 — Phase 1 (part 2 of 3): Profile

## Goal
You fill in your profile once. The server reads and validates it, and both `GET /api/health` and the UI tell you exactly which profile file is missing, still the unedited template, or invalid, and how to fix it.

## Scope
**In**
- Committed templates:
  - `profile/profile.example.md`: who you are, skills, experience, projects, links. Plain Markdown that later phases pass to the LLM.
  - `profile/preferences.example.yaml`: filters and sending limits, in the shape from PLAN.md §6.
  - `profile/README.md`: what each file is for and how to set it up.
- `.gitignore`: also commit `profile/README.md` (real files stay ignored).
- `server/src/lib/profile.ts`:
  - `checkProfile()`: a status for each file (`ok | missing | template | invalid`) plus a reason and a fix hint. Never throws.
  - `loadProfile()`: returns `{ profileMd, preferences, resumePath }` or throws a clear error. Later phases use this.
  - Preferences validation without extra libraries. Defaults are filled in for optional fields (`send.*`), and unknown keys come back as warnings.
- `server/src/routes/profile.ts`: `GET /api/profile/status` returns the same data as the health check's profile section.
- `GET /api/health` gets a `profile` section: `{ ready, files: { profile, preferences, resume } }`. `ok` still reflects the API and DB only, so the API works before profile setup is finished.
- Client: a "Profile setup" card with each file's state, the reason and a copy-paste fix command. It refreshes with the health poll.
- New server dependency: `yaml`.
- `PLAN.md`: fix the database filename (`outreach.db` → `hireloop.db`, matching the code).

**Out**
- Editing the profile in the UI (Phase 4). Using the profile for filtering or drafting (Phases 2–3). Parsing the PDF's contents (the resume is only attached to emails).

## Design
- **Read on every request, no cache.** The files are tiny, so edits show up in the UI within one poll (5 s) without a server restart.
- **Status per file:**
  | File | `missing` | `template` | `invalid` | `ok` |
  |---|---|---|---|---|
  | `profile.md` | not there | identical to the example, or still has `<…>` placeholders | empty or under 200 chars | otherwise |
  | `preferences.yaml` | not there | — | YAML syntax error or wrong field types | parses and validates |
  | `resume.pdf` | not there | — | empty, doesn't start with `%PDF-`, or over 10 MB | otherwise |
- **Placeholder rule:** the example uses `<angle bracket>` placeholders, so any line still containing `<Your …>`-style text means the profile isn't filled in. This stops a half-edited profile from reaching an LLM prompt later.
- **Preferences rules:** `roles`, `locations`, `must_have_any` and `avoid` are lists of strings, lowercased and trimmed. `roles` must be non-empty. `my_experience_years` is a number ≥ 0. `accept_exp_range` is `[min, max]` with min ≤ max. `send.daily_cap` is 1–100 (default 25). `send.gap_seconds` is `[min, max]` with 10 ≤ min ≤ max (default [60, 120]). `send.recontact_after_days` is ≥ 0 (default 30). `send.dry_run` is a boolean (default **true**, so it's safe if left out).
- **`ready`** = all three files are `ok`.

## Files touched
```
docs/003-profile.md  PLAN.md  README.md  .gitignore
profile/profile.example.md  profile/preferences.example.yaml  profile/README.md
server/package.json  server/src/lib/profile.ts  server/src/routes/profile.ts  server/src/routes/health.ts  server/src/index.ts
client/src/lib/api.ts  client/src/App.tsx  client/src/components/ProfileCard.tsx  client/src/styles.css
```

## How to test
1. `npm install && npm run dev`
2. With an empty `profile/`: `curl localhost:3001/api/health` → `ok: true`, `profile.ready: false`, all three `missing`. The UI card shows three red rows with `cp` commands.
3. `cp profile/profile.example.md profile/profile.md` → `profile` becomes `template`.
4. Fill it in → `ok`.
5. `cp profile/preferences.example.yaml profile/preferences.yaml` → `ok`. Change `accept_exp_range` to `[5, 1]` → `invalid` with the reason. Break the YAML syntax → `invalid` with the line number.
6. Copy in any PDF as `profile/resume.pdf` → `ok`. Use a renamed `.txt` file → `invalid (not a PDF)`.
7. When all three are ok, the card says "Profile ready".
8. `npm run typecheck` and `npm run build` pass.

## Status
**Done.**

Built as scoped above, plus one refactor: health polling moved from `HealthCard` into `client/src/lib/useHealth.ts`, so the status card and the profile card share one poll instead of two.

Results on 2026-11-08 (Node v25.8.1), API run on a test port with real files placed in `profile/` and then removed:
| Scenario | Result |
|---|---|
| Empty `profile/` | all three `missing`, `ready: false`, health `ok: true` |
| Templates copied as-is, text file as `resume.pdf` | profile `template` ("Still the unedited template."), preferences `ok`, resume `invalid` ("Not a PDF") |
| One placeholder replaced; `accept_exp_range: [5, 1]`, `daily_cap: 500` | profile `template` ("32 placeholder(s) left: …"); preferences `invalid` with both errors listed |
| Broken YAML | preferences `invalid`, "YAML syntax error (line 2): …" |
| Filled profile with real autolinks (`<https://github.com/…>`), minimal prefs with an unknown key, empty locations, `dry_run: false`, a real `%PDF-` header | `ready: true`; preferences warnings for the unknown key, empty locations and dry_run off; roles normalized to `["backend","node"]`; `send` defaults filled in |
| `loadProfile()` with files missing | throws "Profile not ready: profile/profile.md is missing (File not found.); …" |
- `npm run typecheck` and `npm run build` pass (client JS 229 kB, 71 kB gzipped).
- `git check-ignore`: `profile/profile.md` is ignored; `profile/README.md` and `*.example.*` are tracked.
- `PLAN.md`: database filename corrected to `hireloop.db`.

UI card checked in 004 by screenshot (all three files ready, with your real profile). The card moved to the **Setup** view in 004.

Open questions:
- The 200-character minimum for `profile.md` is a guess. Raise it if drafts come out thin in Phase 3.
- `send.dry_run` defaults to `true` when left out, on purpose. Turning it off shows a warning on the card, as a constant reminder.
