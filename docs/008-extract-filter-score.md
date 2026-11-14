# 008 — Phase 2 (part 2 of 3): Extract + filter + score

## Goal
Turn each captured post into a structured job, apply your `preferences.yaml`, and give every post a final status with a reason. Processing runs **only when you ask** (owner decision B).

## Scope
**In**
- Migration v3: `jobs` table (one row per post) and the `llm_calls` table (from 007).
- `server/src/pipeline/extract.ts`: one classify + extract prompt per post.
  - **Sent to the LLM:** post text only, with emails → `[EMAIL]` and phone numbers → `[PHONE]`. No author name, no profile.
  - Zod schema: `is_job_post`, `is_job_seeker`, `title` (most relevant role for a web/software developer), `other_titles[]` (multi-role posts, an idea from the friend's prompt), `company`, `exp_min`, `exp_max`, `location`, `work_mode` (onsite / hybrid / remote / null), `tech_stack[]`, `employment_type`, `apply_url`, `summary`.
  - The `apply_url` is kept only if it appears in the post text (same rule as emails). Emails always come from the server's regex.
- `server/src/pipeline/rules.ts` (pure functions, no DB), applied after extraction:
  | Check | Drops when | Not stated |
  |---|---|---|
  | avoid | any `avoid` word in text/title (whole word) | — |
  | role | none of `roles` in title / other titles / text | — |
  | experience | post range doesn't overlap `accept_exp_range` ("3+" = 3..∞) | keep, half credit, reason "experience not stated" |
  | location | stated location matches none of `locations` and the post isn't remote (or "remote" isn't in your list) | keep, half credit, reason "location not stated" |
  | must-have | none of `must_have_any` in stack/text (skipped if the list is empty) | — |
- **Score 0–100** = stack 50 + role 20 + experience 20 + location 10:
  - Stack = the share of the post's `tech_stack` that matches your skills. Your skills = `must_have_any` + the words in the `## Skills` section of `profile.md` (read locally, never sent). Half credit if no stack is stated.
  - Role: 20 if it matches the title, 10 if only the text matches.
  - Experience: 20 if your years fall inside the range, 15 if only the ranges overlap, 10 if not stated.
  - Location: 10 if it matches, 5 if not stated.
  - Weights in one exported object.
- Final status: `matched` (has an email) / `no_email` (Apply manually; job card link shown) / `filtered_out` / `not_job` / `rejected_prefilter` / `blocked` / `error` (LLM unavailable; retried on the next Process).
- `server/src/pipeline/process.ts`: one background run at a time, posts processed one by one (the rate limiter paces them). Every decision logged to `events` (`prefilter_reject`, `blocked`, `llm_extract`, `not_job`, `filtered_out`, `matched`, `no_email`, `llm_error`).
- API:
  - `POST /api/process` (`{ limit? }`): processes `new` + `error` posts in the background; returns immediately.
  - `POST /api/process/reapply`: re-runs the pre-filter and rules on processed posts **without calling the LLM** (after editing `preferences.yaml`). Posts that newly pass the gate but were never extracted go back to `new`.
  - `GET /api/process/status`: running, done/total, counts, last error.
  - `GET /api/posts` and `/api/posts/:id` include the `jobs` row.
- Minimal UI so it's usable before 009: a **Process** button with progress and a **Re-apply rules** button on the Posts page, plus the score and status reason on each card. Full job cards, tabs and the replay suite are in 009.

**Out:** richer job cards and tabs, and the dummy replay suite (009). Drafting (Phase 3).

## How to test
`npm test`: rules and score on dummy extractions; the whole pipeline on a temp DB with a fake LLM provider (job → matched; no email → no_email; seeker → not_job; foreign → rejected_prefilter; blocked author; LLM down → error, then retried). After the owner saves keys: `llm:check`, then Process on the real DB.

## Status
**Done (pending a live LLM run). Waiting for owner review.**

### What was built
As scoped. Details worth knowing:
- Every rule is checked and **all** problems are listed (e.g. "Needs 8–12 yrs…; Location "Chennai" not in your locations"), not just the first.
- Location: "PAN India" / "multiple locations" count as *not stated* (half credit), not a mismatch.
- Phone masking: 10–15 digits with single separators. A first version swallowed text after a number ("6789. 2-4 yrs"), which a test caught. Salary figures and year ranges are not masked.
- The UI shows the extracted role, company, experience, location, score (green ≥ 70, amber ≥ 45), stack chips and reasons. New tabs: Matched, Apply manually, plus Filtered out / Not a job / Pre-filtered / Blocked / Errors as they appear.

### Test results (2026-11-08)
- `npm test` 58/58: `rules-extract.test.ts` (13), covering scoring maths, each rule, not-stated handling, multi-role titles, whole-word avoid ("sales" doesn't drop "Salesforce"), lenient schema, masking, apply-URL check; and `pipeline.test.ts` (6): 8 dummy posts through Process with a fake LLM → matched / no_email / not_job / rejected_prefilter ×2 / blocked / filtered_out / error, with a reason on every dropped post. Only 5 of 8 reached the LLM, with no raw emails and no author names in prompts. Retry of `error` posts; Re-apply after editing preferences (no LLM calls, unblocked posts go back to `new`); Process refuses an invalid profile.
- Real data (copy of the owner's DB, no keys): see 007.
- UI screenshot checked (Process bar, tabs, reasons).

### Not verified
- **A real LLM extraction** (needs the keys). The first real run is the actual accuracy check; 009 adds the replay report to measure it.
