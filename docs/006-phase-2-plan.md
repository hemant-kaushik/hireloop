# 006 — Phase 2 plan and decisions

## Goal
Record the owner's answers to the Phase 2 questions and update `PLAN.md` before any Phase 2 code. Plan only, no code.

## Decisions
| # | Question | Decision |
|---|---|---|
| 1 | LLM providers | Gemini (primary) and Groq (fallback), keys in `server/.env`. Ollama optional, off by default (about 5 GB free RAM on this laptop). |
| 2 | Live LinkedIn DOM | Fixed in 005. |
| 3 | When processing runs | **Open:** waiting for the owner (see below). |
| 4 | Experience or location not stated | Keep, with a lower score and a reason. |
| 5 | Experience rule | Keep if the post's range overlaps `accept_exp_range`. |
| 6 | Word matching | Whole words, case-insensitive, the same idea as the friend's repo (`\b…\b` regexes), plus aliases and special-character terms (below). |
| 7 | Agency spam | Optional `block_authors: []` in `preferences.yaml`. |
| 8 | Job-card posts with no email | Apply manually list, with the job link. |
| 9 | Score weights | Stack overlap 50, role 20, experience 20, location 10; half credit when not stated. |
| 10 | Test data | Dummy (synthetic) posts only. |
| 11 | What goes to the LLM | Post text only, with emails and phone numbers masked. No author name, no profile in Phase 2. |
| 12 | Doc numbering | 006 this plan → 007 gate + gateway → 008 extract + filter + score → 009 UI + replay. |

### Word matching: what the friend's repo does, and what we keep
`linkedin-jobs-outreach/src/services/location-filter.js` uses hand-written regexes with `\b` word boundaries and the `i` flag, e.g. `/\b(intern\b|internship|trainee|apprentice|stipend|unpaid)\b/i`, plus context exceptions:
- "internship" doesn't reject a post that also says "full-time".
- A non-India city doesn't reject a post that says "remote India" / "PAN India".
- Job-seeker wording doesn't reject a post that also has a hiring signal.

HireLoop does the same: whole words, case-insensitive, built from your `preferences.yaml` lists instead of hard-coded. Additions:
- **Aliases**, so one word in your list covers its spellings: node ↔ node.js ↔ nodejs, react ↔ react.js ↔ reactjs, next.js ↔ nextjs, postgresql ↔ postgres, bangalore ↔ bengaluru, gurgaon ↔ gurugram, delhi ↔ new delhi ↔ ncr.
- **Special characters:** `\b` fails on `c++`, `.net` and `next.js`, so the boundary is "not a letter or digit" on each side instead.
- **Ideas reused from that repo** in the keyword gate: job-seeker detection ("#OpenToWork", "looking for a job" with no hiring signal → `rejected_prefilter`). Its other rules (non-India locations, walk-in, low salary, staffing) are covered by your `locations` and `avoid` lists. Add `walk-in` to `avoid` if you don't want those.

### Open: when does processing run (question 3)
After the extension delivers a post, *something* has to start the gate → LLM → filter steps. Two options:
- **A. Automatic (recommended):** the server processes new posts in the background a few seconds after they arrive. As you scroll, posts turn into Matched / Filtered out in the UI on their own. Uses LLM quota without asking, but the daily budget cap (`LLM_DAILY_BUDGET` in `.env`) and the free-tier limits keep it safe. The 35 existing posts are processed once at startup.
- **B. Manual:** posts wait as `new` until you click **Process** in the UI. You decide exactly when quota is spent, but you must remember to click.

Either way there is a **Reprocess** button (e.g. after you edit `preferences.yaml`), and rule-only reprocessing doesn't call the LLM again.

## Files touched
`PLAN.md` (Phase 2 section, data model `jobs`, status lifecycle, `preferences.yaml` shape, risks), `docs/006-phase-2-plan.md`.

## Status
**Done. Plan updated.** Waiting on the owner for:
1. Question 3 (A or B).
2. The API keys saved in `server/.env`. As of this doc, lines `# GEMINI_API_KEY=` and `# GROQ_API_KEY=` are still commented out and empty.
