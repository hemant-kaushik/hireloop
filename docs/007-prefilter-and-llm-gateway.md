# 007 — Phase 2 (part 1 of 3): Pre-filter + LLM gateway

## Goal
The free, deterministic first stage (drop what's obviously not for you, without spending LLM quota), and one reliable way to call an LLM that survives free-tier limits.

## Scope
**In**
- `server/src/lib/match.ts`: whole-word, case-insensitive matching **the same way as the friend's repo** (`\b…\b` with the `i` flag), plus:
  - aliases: node ↔ node.js ↔ nodejs, react ↔ reactjs ↔ react.js, next.js ↔ nextjs, full stack ↔ fullstack ↔ full-stack, mern ↔ mern stack, postgresql ↔ postgres, mongodb ↔ mongo, javascript ↔ js, typescript ↔ ts, bangalore ↔ bengaluru, gurgaon ↔ gurugram, delhi ↔ new delhi ↔ ncr, remote ↔ wfh ↔ work from home
  - terms with symbols (`c++`, `.net`, `node.js`), where `\b` fails, use "not a letter/digit" boundaries instead.
- `server/src/pipeline/prefilter.ts`, in order:
  1. `block_authors`: a whole-word phrase match on the author name ("Ocean IT" blocks "Ocean IT Tech", not "Ocean Tech Service") → `blocked`.
  2. Hiring signal required (hiring, opening, vacancy, position, JD, "send your CV", "apply", "join our team", "looking for a … developer", an email address…) → otherwise `rejected_prefilter` "no hiring signal".
  3. The friend's rules, **ported with attribution** from `linkedin-jobs-outreach/src/services/location-filter.js` (MIT), with their exceptions:
     | Rule id | Rejects | Exception |
     |---|---|---|
     | `f2f` | walk-in / face-to-face / F2F interviews | — |
     | `non_india` | US/Pakistan/Middle East/SE Asia/Europe/other countries, visa/W2/C2C terms, foreign email domains | "remote India" / "PAN India"; a single foreign hit in a remote post; "US" with an Indian city |
     | `local_only` | "local candidates only", "must be based in …" | when the context says India |
     | `internship` | intern/internship/trainee/apprentice (stipend/unpaid always) | post also says full-time/permanent |
     | `job_seeker` | #OpenToWork, "actively looking", "looking for a job" | post also has a hiring signal |
     | `low_salary` | 1–5 LPA | — |
     | `staffing` | empanelment, "recruitment agency", "staffing company/agency/partner" | — |
  - `preferences.yaml` gets two optional keys: `block_authors: []` and `disable_rules: []` (any rule id above).
- `server/src/llm/`: gateway `generateJSON({ task, system, prompt, schema })`:
  - Providers: **Gemini** (REST `generateContent`, JSON mode), **Groq** (OpenAI-compatible chat, `json_object`), **Ollama** (optional, only when `OLLAMA_MODEL` is set). Order from `LLM_ORDER` (default `gemini,groq,ollama`); a provider is skipped when it has no key.
  - Token-bucket rate limiter per provider (`GEMINI_RPM`, `GROQ_RPM`). Waits for a token rather than failing.
  - Errors: 429 / 5xx / network → that provider cools down (Retry-After or 60 s), go to the next one. Invalid JSON or schema failure → one retry on the same provider with the error fed back, then the next provider. All failed → `LlmUnavailableError`.
  - Daily budget `LLM_DAILY_BUDGET` (default 300 calls), counted from the DB.
  - Every call is logged to a new `llm_calls` table (provider, model, task, ok, latency, error, post id). Prompts and responses are not stored.
- `zod` dependency. `server/.env.example` documents all LLM settings. `GET /api/health` gets an `llm` section (configured providers, models, today's usage/budget).
- `npm run llm:check -w server`: lists each configured provider's available models and confirms the configured model exists (free calls, no prompt sent).

**Out:** the extraction prompt, rules and scoring (008); UI (009).

## Design notes
- The gate runs before the LLM, so most non-matching posts cost nothing (the same reason the friend's repo pre-filters).
- **Privacy:** the gateway is generic; masking of emails and phone numbers happens in 008's prompt builder.
- Default models (overridable in `.env`): `GEMINI_MODEL=gemini-2.5-flash-lite`, `GROQ_MODEL=llama-3.3-70b-versatile`. **Verified with `llm:check` once the owner's keys are saved**, then updated if needed.

## How to test
`npm test` (dummy data only): match.ts (aliases, symbols, whole-word), each pre-filter rule and its exception, `block_authors`, `disable_rules`; gateway with a fake `fetch`: fallback on 429, retry on bad JSON, schema failure, budget exhausted, all providers down.

## Status
**Done. Waiting for owner review.** Live LLM calls are not verified yet: the owner's keys aren't saved in `server/.env` (see below).

### What was built
As scoped, plus these changes found while testing:
- **Wait out short cooldowns:** if every provider is cooling down for ≤ 2 minutes (e.g. one Gemini 429 with no Groq key), the gateway waits instead of failing every remaining post in the run. Found by the pipeline test.
- A provider's `Retry-After` / `retryDelay` sets the cooldown for rate limits.
- `PROFILE_DIR` env var, so tests use a dummy profile and never read the real one.

Deviations from the friend's rules (all three found on the owner's real posts or in tests):
1. Internship rule: plurals ("interns", "internships", "trainees"); the original `intern\b` missed "Hiring interns".
2. Curly apostrophes normalized before matching (LinkedIn writes "We’re hiring"; the regexes expect `'`).
3. The job-seeker exception also accepts recruiter/job-list wording ("HIRING ALERT", "Job Openings", "Open Positions", "Apply:"). Before this, 3 of the owner's 21 real posts were wrongly dropped as "job seeker": recruiter posts opening with "Looking for a new opportunity?", two of them listing React/MERN openings in Noida/NCR. The LLM's `is_job_seeker` remains the second check.

### Test results (2026-11-08)
- `npm test`: **58/58** pass (all dummy data). This change adds `match-prefilter.test.ts` (13), `gateway.test.ts` (9): fallback on 429, retry with error feedback, invalid twice → next provider, all down, none configured, logging, budget, cooldown wait.
- **Pre-filter on a copy of the owner's 21 real non-duplicate posts** (no LLM): 8 dropped for free (5 internship, 1 no hiring signal, 1 foreign "global hiring" post, 1 internship-heavy job list); 13 continue to the LLM. Every LLM-bound post failed cleanly with "no provider configured (set GEMINI_API_KEY / GROQ_API_KEY…)".
- Typecheck and build pass.

### Open
- **Keys:** `server/.env` lines 8–9 are still `# GEMINI_API_KEY=` / `# GROQ_API_KEY=`. After saving them: `npm run llm:check -w server`, and update `GEMINI_MODEL` / `GROQ_MODEL` if it reports the defaults aren't available.
- Known limitation from the friend's internship rule: a job-list post with one "(Intern)" line among many roles is dropped (seen once, on a CareerBee list). Switch it off with `disable_rules: [internship]` if this bites; your `avoid: [internship]` would still drop pure internship posts after the LLM step.
