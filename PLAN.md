# HireLoop — Plan & Architecture

## 1. What it does

You scroll LinkedIn as usual. A Chrome extension reads the posts on your screen and sends them to a server running on your laptop. The server finds the hiring posts that fit you, writes a summary and an email draft for each, and sends only the emails you approve, from your own Gmail. Everything is local and costs ₹0.

```
Scroll feed → Extension captures → Server filters → Summary + draft → You approve → Gmail sends
```

### The user flow

1. **One time:** fill in `profile/profile.md` (who you are), `profile/preferences.yaml` (filters + sending limits), and drop in `profile/resume.pdf`.
2. Run `npm run dev` (starts the Express API and the React UI).
3. Open LinkedIn. The extension captures every post that appears on screen and sends it to the server.
4. The server keeps only hiring posts, then only the ones that match your filters.
5. For each match it extracts a summary (title, experience, tech stack, HR email, location…) and writes an email draft.
6. You review the summary and draft in the React app, then edit, approve or reject.
7. Approved emails are sent to the email address found in the post, with your resume attached.

---

## 2. Architecture

```
┌──────────── YOUR CHROME ────────────┐   ┌──────────── LOCAL (your laptop) ─────────────────────────────┐   ┌──── FREE EXTERNAL ────┐
│                                     │   │  Express API :3001                         React UI :5173    │   │                       │
│  LinkedIn feed tab (you scroll)     │   │                                                              │   │  Gemini API (primary) │
│        │                            │   │  POST /api/ingest ── dedupe (URN + text hash)                │   │  Groq API (fallback)  │
│        ▼                            │   │        │                                                     │   │  Ollama (optional,    │
│  Content script                     │   │        ▼                                                     │   │   local, no limits)   │
│   MutationObserver → parse posts    │   │  1. Keyword gate      (regex, free)                          │   │        ▲              │
│        │                            │   │        ▼                                                     │   │        │              │
│        ▼                            │   │  2. Classify+extract  (1 LLM call → JSON) ──► LLM gateway ───┼───┼────────┘              │
│  Background service worker ─────────┼──►│        ▼                                                     │   │                       │
│   batches, retries, counters        │   │  3. Filter + score    (your rules, free)                     │   │                       │
│                                     │   │        ▼                                                     │   │                       │
│  React review tab  ◄────────────────┼──►│  4. Draft email       (LLM + profile.md) ──► LLM gateway     │   │                       │
│   approve / edit / reject           │   │        ▼                                                     │   │                       │
│                                     │   │  Sender queue (throttled, daily cap) ────────────────────────┼──►│  Gmail SMTP ──► HR    │
└─────────────────────────────────────┘   │                                                              │   └───────────────────────┘
                                          │  SQLite (data/hireloop.db): posts · jobs · drafts ·          │
                                          │                             contacts · events                │
                                          │  profile/: profile.md · preferences.yaml · resume.pdf        │
                                          └──────────────────────────────────────────────────────────────┘
```

### Why this architecture

| Decision | Reason |
|---|---|
| **Extension, not a scraper bot** | A headless bot that logs in and scrolls is the fastest way to get your LinkedIn account restricted. The extension only reads what you are already looking at in your real session. It never clicks, scrolls or messages. |
| **Local-first** | No hosting cost. Gmail app password, resume and API keys stay on your laptop. The extension talks to `localhost`, so there is no public endpoint to secure. |
| **Cheap filters before LLM calls** | Most feed posts aren't hiring posts. A regex gate drops about 80% of them for free, and rule filtering is plain code. Only what's left uses LLM quota, so you stay inside free tiers. (Same idea as interview-helper's detector → answer.) |
| **Human approval before any send** | One bad email (wrong name, invented skill) to an HR inbox costs more than it gains. Nothing leaves without your click. |
| **Express API + React UI** | Express owns the pipeline, DB and secrets. React is only the UI and never sees a key. The extension, the UI and scripts all use the same API. `npm run dev` starts both. |
| **SQLite (built-in `node:sqlite`)** | Unique keys (never process a post twice, never email the same HR twice) and status queries like "drafts waiting". One file, and nothing native to compile, because it ships with Node ≥ 22.13. |
| **Swappable LLM providers** | Free tiers change without notice. A gateway with Gemini → Groq → Ollama fallback means a quota cut never stops the job search. |

### The filtering funnel (illustrative numbers for one scroll session)

| Stage | Posts left | Cost |
|---|---|---|
| Captured by extension | 200 | free |
| New (not seen before) | 180 | free |
| Pass keyword gate | 35 | free |
| LLM confirms real job post + extracts fields | 18 | **LLM** |
| Match your role / experience / location rules | 8 | free |
| Email drafted (has an email address) | 5 | **LLM** |
| You approve → sent | 4 | you |

That's about 23 LLM calls per session, well within free quotas. Matching posts with no email go to an **Apply manually** list with the link.

---

## 3. Components

| Component | What it does | Why it exists |
|---|---|---|
| **Content script** (`extension/content.js` + `parse.js`) | A `MutationObserver` finds posts as they load; an `IntersectionObserver` captures each one once it is actually on screen. `parse.js` extracts key, text, author, headline, time label and job-card link. Re-sends a post if its text grows (you clicked "…more"). Emails are extracted on the server. | LinkedIn loads posts as you scroll. Observers catch each one when it appears, with no polling and no automation. |
| **Selectors** (`extension/selectors.js`) | All LinkedIn DOM selectors in one file, for both DOM generations (see below), with backups (attributes, then longest text block, then raw `innerText`). | LinkedIn changes its HTML often. One file to fix, and the backups keep capture working meanwhile. |
| **Background worker** (`extension/background.js`) | Receives batches, POSTs to `localhost:3001/api/ingest`, queues failed batches in storage and retries every minute. Keeps counters. | Requests from a content script to localhost get blocked by CORS; the worker has host permissions. If the server is down, nothing is lost. |
| **Popup** (`extension/popup.html`) | Shows server status, captured / delivered / queued counts, a pause switch. | So you can see capture is working without opening anything. |
| **Ingest API** (`POST /api/ingest`) | Stores posts by key (URN or `ck:` hash). Same key with longer text → update. Same text + same author under a new key → ignored. Same text, different author → `duplicate`. Every decision goes to `events`. Returns right away. | The extension never waits on an LLM. Accept fast, process later. |
| **Stage 1 · Keyword gate** | Regex for hiring signals (hiring, opening, vacancy, JD, send your CV, DM me, email address…). | Free and instant. Keeps you on the free tier. |
| **Stage 2 · Classify + extract** | One LLM call → JSON: `is_job_post, role, company, exp_min, exp_max, location, work_mode, tech_stack[], emails[], apply_url, summary`. Zod-validated. | One call instead of two halves quota use. **Safety rule:** keep an email only if it appears literally in the post text. |
| **Stage 3 · Filter + score** | Plain code reads `preferences.yaml`: roles, years vs. required range, locations, must-have / avoid keywords. Score = stack overlap with your skills, plus reasons. | Predictable, free, and you can see exactly why a post was dropped. |
| **Stage 4 · Draft email** | Prompt = `profile.md` + extracted job + style rules (under 150 words, plain text, name 2–3 matching skills, one clear ask, no invented experience). | Runs only on the few posts worth sending, so it can use the better model. |
| **LLM gateway** | `generateJSON(prompt, schema)`: Gemini → Groq → Ollama fallback, token-bucket rate limiter, one retry on invalid JSON. | Providers are interchangeable, so a quota cut never stops the job search. |
| **Review UI** (React) | Cards: original post + link, summary, match reasons, editable subject/body. Approve / Reject / Regenerate. Tabs: Apply manually, Sent, Rejected. | Where you spend your time. Ten cards should take about 5 minutes. |
| **Sender queue** | Nodemailer + Gmail SMTP, resume attached, 60–120 s gap with jitter, daily cap of about 25, skips contacts emailed in the last 30 days. Stores message ID / error. | Bursts of near-identical emails land in spam or get your Gmail flagged. |
| **SQLite + event log** | `data/hireloop.db`. Every decision is logged in `events`. | When a good post gets dropped, you can see which stage dropped it. |
| **Profile files** | `profile.md`, `preferences.yaml`, `resume.pdf`. | LLMs read Markdown better than a PDF dump, and you can edit it in seconds. |

### LinkedIn's two DOM generations (found in 004)
LinkedIn now serves a server-driven UI with **hashed class names, no `data-urn`, and no post permalinks** (seen on search results, April 2026). The classic markup (`data-urn="urn:li:activity:…"`) may still appear. The extension supports both and uses only stable hooks (`role`, `data-testid`, `componentkey`, `aria-label`, `href`):
- Post key: the URN when present, else `ck:<hash>` from `componentkey="expanded<hash>FeedType_…"`, else the server derives `tx:<hash of author+text>`.
- No permalink in the new DOM: the UI links the job card, the author, and a LinkedIn content search for the post's opening words.
- The full post text is normally in the DOM even behind "…more", so no expanding is needed.

---

## 4. Tech stack (all free)

| Layer | Tool | Cost | Why |
|---|---|---|---|
| Extension | Chrome Manifest V3, plain JS, no build step | free | Load unpacked from a folder. |
| Backend | Node.js + Express + TypeScript (`tsx` in dev) | free | Chosen stack. Owns API, pipeline, secrets, sender. |
| Frontend | React + TypeScript + Vite | free | Chosen stack. Vite proxies `/api` to Express. |
| Database | SQLite via built-in `node:sqlite` | free | Ships with Node ≥ 22.13, nothing native to compile. |
| Config parsing | `yaml` | free | Reads `preferences.yaml`. |
| Validation | Zod | free | Rejects malformed LLM JSON (phase 2). |
| LLM primary | Google Gemini API (Flash-Lite to extract, Flash to draft) | free tier | Native JSON output. AI Studio key, no card needed. |
| LLM fallback | Groq (Llama 3.3 70B / gpt-oss-120b) | free tier | Fast, separate quota. |
| LLM offline | Ollama + 7–8B model (optional) | free | No limits if you have ~8 GB of RAM free. |
| Email | Nodemailer + Gmail SMTP + App Password | free | Sends from your real address. Needs 2-step verification. |

> Free-tier limits change. Before relying on any number, check the official pages: https://ai.google.dev/gemini-api/docs/rate-limits and https://console.groq.com/docs/rate-limits. Google may use free-tier prompts to improve its models, and your profile is in those prompts.

---

## 5. Project structure

```
hireloop/
├── PLAN.md                  ← this file
├── CLAUDE.md                ← project rules for AI assistants
├── README.md                ← how to run
├── docs/                    ← one file per change: NNN-short-description.md
├── package.json             ← npm workspaces + `npm run dev`
├── server/                  ← Express + TypeScript API
│   ├── .env.example
│   └── src/
│       ├── index.ts         ← app bootstrap
│       ├── config.ts        ← env + paths
│       ├── db/              ← schema + node:sqlite connection
│       ├── app.ts           ← Express app (routes, origin guard); index.ts listens
│       ├── routes/          ← one router per resource (ingest, posts, health…)
│       └── lib/             ← profile loader, event log, text utils
├── client/                  ← React + TypeScript + Vite UI
│   └── src/
├── extension/               ← Chrome MV3 extension (load unpacked)
│   ├── manifest.json
│   ├── selectors.js · parse.js · content.js · background.js
│   ├── popup.html · popup.js
│   └── test/parse.test.html
├── profile/                 ← YOUR data (real files gitignored, *.example committed)
└── data/                    ← hireloop.db (gitignored)
```

---

## 6. Data model

```
posts     id, urn UNIQUE (URN | ck:<hash> | tx:<hash>), text_hash, author,
          author_headline, author_url, text, raw_text, url, emails(json),
          posted_label, page_url, parse_quality, status, reject_reason, seen_at,
          job_url, source (feed|search|profile|other)            ← v2

jobs      post_id, title, company, exp_min, exp_max, location, work_mode,
          tech_stack(json), emails(json), apply_url, summary, score,
          match_reasons(json)                                    ← phase 2

drafts    job_id, to_email, subject, body, status, approved_at,
          sent_at, message_id, error                             ← phase 3

contacts  email UNIQUE, last_contacted_at, times_contacted       ← phase 3

events    id, at, post_id, type, data(json)
```

**Post status lifecycle**

```
new ─┬─► duplicate
     ├─► rejected_prefilter
     ├─► not_job
     ├─► filtered_out
     └─► matched ─┬─► no_email  (→ Apply manually list)
                  └─► drafted ─► approved ─► sent | failed
                                └► rejected
```

**`preferences.yaml` shape**

```yaml
roles: [backend, full stack, sde, node]
my_experience_years: 1.5
accept_exp_range: [0, 3]
locations: [bangalore, remote, gurgaon]
must_have_any: [node, react, python]
avoid: [unpaid, internship, sales]
send:
  daily_cap: 25
  gap_seconds: [60, 120]
  recontact_after_days: 30
  dry_run: true
```

---

## 7. Phases

The goal is a job in 2 months, not a finished tool. Have it sending real emails by about day 10, then improve it while using it.

### Phase 1 — Setup + profile + capture (days 1–3) ✅ done (docs 002–004)
- Monorepo with npm workspaces: `server/` (Express + TS), `client/` (React + TS + Vite), `extension/` (MV3). `npm run dev` starts server + client.
- SQLite schema (`posts`, `events`), `server/.env`, `GET /api/health` reporting whether profile files are set up.
- Profile templates: `profile.md`, `preferences.yaml`; you add `resume.pdf`.
- Extension: content script + MutationObserver, selectors file with backups, background worker with retry queue, popup with counts and pause switch.
- `POST /api/ingest` with URN + text-hash dedupe. React page listing captured posts.
- **Done when:** you scroll for 2 minutes and see every visible post in the React app exactly once.

### Phase 2 — Understand + filter + score (days 4–6)
- Keyword gate. LLM gateway (Gemini → Groq → Ollama), rate limiter, Zod validation.
- One classify + extract prompt. Keep emails only if they appear in the post text.
- Apply `preferences.yaml` rules and calculate a score with match reasons. Log the reason for every rejection.
- 30 real posts saved as fixtures (replay suite) to measure accuracy.
- **Done when:** job posts show correct fields, and every dropped post shows a reason you agree with.

### Phase 3 — Draft + review + send (days 7–10)
- Email drafting prompt from profile + extracted job.
- Review page: summary, post link, editable draft, Approve / Reject / Regenerate. Apply manually tab.
- Nodemailer + Gmail SMTP, resume attached, throttled queue, daily cap, contacts dedupe.
- **Dry-run first:** everything goes to your own address until you switch it off.
- **Done when:** the first real approved email arrives and appears in your Gmail Sent folder.

### Phase 4 — Friendlier UI for beginners (optional, week 3+)
- Modular component library; guided setup wizard (keys, Gmail, profile) instead of editing files.
- Edit profile and preferences in forms instead of Markdown/YAML.
- Clear empty states, tooltips, stats page (sent, replies, reply rate).
- Extras if time allows: follow-up drafts after 5 days, reply tracking over IMAP, LinkedIn search result pages.

---

## 8. From interview-helper (friend's project)

**Reuse:** one file per API route, all prompts in one file, a per-task model config table, cheap gate before the expensive model, structured `events` log, replay suite of real cases before changing prompts.

**Drop or change:** Next.js → Express + React (Vite); AWS Bedrock (paid) → Gemini/Groq/Ollama; `NEXT_PUBLIC_*` secrets (visible in the browser) → server-only `.env`; JSON file DB → SQLite; streaming UI and AssemblyAI → not needed.

---

## 9. Risks and guards

| Risk | Guard |
|---|---|
| LinkedIn changes its HTML | Selectors in one file with backups, stable hooks only (never hashed classes). Popup warns when posts parse without text. `extension/test/parse.test.html` to re-verify. |
| LinkedIn terms of service | Reading the page you're viewing is low risk but not zero. Never auto-scroll, auto-click, auto-connect or auto-message. Only email leaves the tool. |
| Post text cut off at "…more" | Full text is often already in the DOM. Otherwise mark `parse_quality=truncated`; expand it by hand if it looks good. |
| Email only in an image or comment | Out of scope for v1 → Apply manually list. |
| LLM invents an email or skill | Keep an email only if it's literally in the post. The prompt only allows claims from `profile.md`. You review every draft. |
| Gmail spam flags | 25 a day or fewer, 60–120 s apart, plain text, personalized, no repeat recipient within 30 days. |
| A free tier gets cut | Gateway falls back to the next provider; Ollama has no limits. |

---

## 10. Working rules

- Every change gets a doc in `docs/` named `NNN-short-description.md` (zero-padded index, e.g. `002-phase-1-setup.md`), written **before** implementing.
- Update the doc when the change is finished (what was done, how to test, open questions).
