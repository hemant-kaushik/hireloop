# 009 — OpenAI provider, verified models, live smoke test

## Goal
Use the owner's three keys (Gemini, Groq, OpenAI) and confirm with real calls that each one can do the extraction task, before the first real Process run.

## Findings that triggered this change (`npm run llm:check -w server`, 2026-11-09)
- Gemini key ✓; `gemini-2.5-flash-lite` available, and newer `gemini-3.x` flash-lite models too.
- Groq key ✓, but the default `llama-3.3-70b-versatile` is **not offered to this key anymore**. Available: `openai/gpt-oss-120b`, `openai/gpt-oss-20b`, `qwen/qwen3.8-27b`…
- The owner added `OPENAI_API_KEY`, but there was no OpenAI provider.

## Scope
**In**
- `server/src/llm/providers.ts`: an `openai` provider (Chat Completions, `response_format: json_object`, no `temperature` because some newer OpenAI models only accept the default). Config: `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_RPM`.
- Default order `LLM_ORDER=gemini,groq,openai,ollama`. **OpenAI is last because it is paid**, unlike the free tiers of Gemini and Groq; it's only used when both fail. The daily budget still caps all calls.
- Defaults updated to models this key can actually use (`GROQ_MODEL=openai/gpt-oss-120b`, and the Gemini/OpenAI defaults chosen by the smoke test).
- `npm run llm:check -w server -- --call`: in addition to listing models, makes **one** real extraction call per configured provider on a built-in **dummy** post, and reports whether the reply passed the Zod schema, the extracted title/experience/location, and the latency. Without `--call` it stays free (listing only).
- `.env.example`, README, PLAN (phase list: 009 = this, 010 = UI + replay).

**Out:** UI and replay (010).

## How to test
`npm test` (the OpenAI provider is covered by the gateway's provider-agnostic tests); `npm run llm:check -w server -- --call` with the owner's keys.

## Status
**Done. Waiting for owner review.**

### Results of `npm run llm:check -w server -- --call` (2026-11-09, dummy post)
| Provider | Model | Result |
|---|---|---|
| Gemini | `gemini-3.5-flash-lite` (new default) | ✓ 1.7 s; all fields correct: "Full Stack Developer (MERN)", also QA Engineer, 2–4 yrs, Noida, hybrid, 7 skills, apply link |
| Groq | `openai/gpt-oss-120b` (new default) | ✓ 1.8 s; same fields |
| OpenAI | `gpt-4.1-mini` | ✗ key valid (96 models listed), but **the account has no credits**: `insufficient_quota` / "You have no credits remaining" |
| Ollama | — | not configured |

Also found:
- `gemini-2.5-flash-lite` is still **listed** for this key, but calls fail with 404 "no longer available to new users". Listing a model doesn't prove it's usable, which is why `--call` exists.
- OpenAI's "no credits" comes back as HTTP 429, like a rate limit. It's now its own error kind (`no_credits`): a clear message and a 1-hour pause for that provider instead of retrying every minute. Test added (`npm test` 59/59).

### Owner's preferences
`block_authors: ["Ocean IT"]` matches 4 of the 5 repost pages in the DB. "Ocean Tech Service" (4 unprocessed posts) has no "IT", so it was added: `["Ocean IT", "Ocean Tech Service"]`.

### Open
- OpenAI stays in the order but is skipped automatically while out of credits. To use it: add credits, or set `LLM_ORDER=gemini,groq` to drop it.
- 2026-11-09: the owner's `server/.env` (gitignored) now lists every setting explicitly, with comments: routing (`LLM_ORDER`, models), limits (`*_RPM`, `LLM_DAILY_BUDGET`, `LLM_TIMEOUT_MS`), Ollama (off), and Gmail placeholders for Phase 3. The existing keys were preserved (verified by hash) and the file is `chmod 600`. Live check after the rewrite: Gemini ✓ (9.5 s this time vs 1.7 s earlier; latency varies, within the 30 s timeout), Groq ✓, OpenAI still out of credits.
