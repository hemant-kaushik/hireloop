# 004 — Phase 1 (part 3 of 3): Capture

## Goal
Scroll LinkedIn as usual and see every post that appeared on screen in the HireLoop UI, exactly once. This completes Phase 1.

## Scope
**In**
- `extension/` (Chrome MV3, plain JS, no build step):
  - `selectors.js`: every LinkedIn selector, for both DOM generations (see Design), each with backups.
  - `parse.js`: turns one post element into a plain object. No side effects, so it can be tested on saved HTML.
  - `content.js`: a `MutationObserver` finds post elements and an `IntersectionObserver` captures each one when it is actually on screen. Re-sends a post when its text grows (e.g. you clicked "…more"). Batches messages to the worker. Honors the pause switch.
  - `background.js`: a persistent queue in `chrome.storage.local`. POSTs batches to `http://127.0.0.1:3001/api/ingest` and retries every minute while the server is down. Keeps counters.
  - `popup.html` / `popup.js`: server status; captured / delivered / queued counts; posts seen on this page; a pause switch; "Send now"; a warning when posts parse without text.
  - `test/parse.test.html`: synthetic posts (new DOM, classic, promoted, backup path) and assertions. Open it in Chrome.
- Server:
  - Migration v2: `posts.job_url` (LinkedIn job card link) and `posts.source` (feed / search / profile / other).
  - `lib/text.ts`: normalize text, text hash, email extraction.
  - `lib/events.ts`: `logEvent()`.
  - `POST /api/ingest` with key + text-hash dedupe (rules below); every decision logged to `events`.
  - `GET /api/posts` (status filter, search, paging, counts per status) and `GET /api/posts/:id` (post + its events).
  - Origin guard: `/api` rejects browser requests from any origin other than the extension, localhost or 127.0.0.1.
  - Tests with Node's built-in test runner: `npm test`.
- Client: a "Posts" view listing captured posts, refreshed every 5 s, with status tabs and search. The setup cards move to a "Setup" view.
- Phase 1 wrap-up: README run guide including loading the extension, PLAN.md updates, and statuses in 002–004.

**Out**
- Keyword gate, LLM and filtering (Phase 2). No clicking, scrolling or expanding on LinkedIn, ever: "…more" is only captured if *you* click it.

## Design

### LinkedIn has two DOM generations
Real HTML saved in April 2026 (search results) shows LinkedIn's new server-driven UI: **hashed class names, no `data-urn`, no post permalinks**. The classic feed markup (`data-urn="urn:li:activity:…"`, `update-components-*` classes) may still be served on some pages or accounts. `selectors.js` supports both:

| Field | New DOM (stable hooks only) | Classic DOM |
|---|---|---|
| Post root | `[role="listitem"][componentkey^="expanded"]`; backup: closest ancestor of `[data-testid="expandable-text-box"]` | `[data-urn^="urn:li:activity:"]`, `[data-id^="urn:li:activity:"]` |
| Post key | `ck:<hash>` taken from `componentkey="expanded<hash>FeedType_…"` | the URN |
| Text | `[data-testid="expandable-text-box"]` minus its "…more" button | `.update-components-text`, `.feed-shared-inline-show-more-text` |
| Author / headline / time | the profile/company link that contains `<p>`s: name, "• 3rd+", headline, "19h •" | `update-components-actor__*` |
| Job card | `a[href*="/jobs/view/"]` | same |

Backups when no text selector matches: the longest text block inside the post (`parse_quality=fallback`), then the post's whole `innerText` (`raw`). Promoted posts are skipped.

### Keys and dedupe (server)
- `posts.urn` stores the key: a real `urn:li:…` or `ck:<hash>`. Posts with neither get `tx:<hash of author + text>`.
- **Same key seen again:** ignored. If the new text is longer (you expanded "…more"), the text, hash and emails are updated (`ingest_updated`).
- **New key, same text hash, same author:** the same post under a new key (for example, if LinkedIn's key isn't stable across page loads). Not inserted; logged as `ingest_rekey` on the original.
- **New key, same text hash, different author:** a repost. Inserted with `status=duplicate`.
- Otherwise inserted as `new`. Empty text never dedupes by hash.
- The text hash is SHA-256 of the text after Unicode NFKC normalization, lowercasing, removing "…more" and zero-width characters, and collapsing whitespace.
- Emails are extracted on the server from the text only (so Phase 2 can enforce "an email must literally appear in the post").

### Why IntersectionObserver
The Done criterion is "every *visible* post". LinkedIn pre-renders posts below the fold; capturing them when ≥ 30 % is on screen means the list matches what you actually saw.

### Permalinks
The new DOM has none without clicking "Copy link", which the extension never does. `url` is the permalink when known (classic DOM), and otherwise empty. The UI then offers the job card link, the author's profile, and a LinkedIn content search for the post's opening words.

## Files touched
```
extension/manifest.json  extension/selectors.js  extension/parse.js  extension/content.js  extension/background.js
extension/popup.html  extension/popup.js  extension/README.md  extension/test/parse.test.html
server/src/db/migrations.ts  server/src/lib/text.ts  server/src/lib/events.ts  server/src/routes/ingest.ts  server/src/routes/posts.ts
server/src/app.ts  server/src/index.ts  server/package.json  server/tsconfig.test.json  server/test/text.test.ts  server/test/api.test.ts
client/src/App.tsx  client/src/lib/api.ts  client/src/components/PostsPage.tsx  client/src/styles.css
package.json  README.md  PLAN.md  docs/002-phase-1-setup.md  docs/003-profile.md  docs/004-capture.md
```

## How to test
1. `npm test`: server unit + API tests.
2. Open `extension/test/parse.test.html` in Chrome: every fixture post parses with the expected fields.
3. `npm run dev`, then load `extension/` unpacked at `chrome://extensions` (Developer mode → Load unpacked).
4. The popup shows "Server online".
5. Scroll the LinkedIn feed and a search-results page (Posts tab) for 2 minutes. The popup's counts go up, and the UI's Posts view lists each post you saw once.
6. Stop the server, scroll, and check that the popup's "queued" count grows. Start the server; within a minute, queued drops to 0 and the posts appear.
7. Pause: no new captures while paused.
8. `npm run typecheck` and `npm run build` pass.

## Status
**Done. Waiting for owner review.** Phase 1 is complete.

### What was built
As scoped above, plus:
- `server/src/app.ts` split out of `index.ts` (`createApp()`), so tests can start the API on a throwaway DB.
- Visibility rule: a post counts as seen when 30 % of it **or half the screen** is covered. Tall posts can never reach 30 %, which the E2E test caught (only 8/33 captured at first).
- The UI has **Posts** (default) and **Setup** views. Posts has status tabs with counts, search, "Show more" paging, a per-post event log, email chips, and Job / Open-or-Find-post links. A banner appears when setup is incomplete.
- `GET /api/posts` accepts `limit` up to 500.

### Test results (2026-11-08, Node v25.8.1, Chrome 148)
| Test | Result |
|---|---|
| `npm test` (server) | 16/16 pass: hashing, emails, cleanText, insert, same-key ignore, longer-text update, re-key skip, repost → duplicate, derived `tx:` keys, invalid input, non-LinkedIn URLs dropped, 400/413, LIKE escaping, origin guard |
| `extension/test/parse.test.html` | 25/25 pass (headless Chrome) |
| Parser on **real LinkedIn HTML** (search results saved in April 2026, kept outside the repo) | 33/33 posts: unique `ck:` keys, author, headline, time label and full text for all; job links on the 5 that have them; no ads in the sample |
| **E2E**: real extension loaded into Chrome via DevTools `Extensions.loadUnpacked`, local copy of that page, scrolled to the end | **33/33 posts in the DB, each exactly once**; 20 with emails, 5 with job links |
| **Offline E2E**: same, but scrolled with the API down, then started it | All 33 queued and delivered in one batch 34 s after the API started (retry alarm); 0 lost |
| UI screenshots (desktop, 420 px mobile, Setup), dark theme | Render correctly; no horizontal overflow |
| `npm run typecheck` / `npm run build` | Pass (client JS 234 kB, 73 kB gzipped) |

### Not verified here
- **Live LinkedIn.** The extension wasn't run against your logged-in session (that's yours to do: "How to test" steps 3–7). The real-HTML tests cover the new DOM from **search results**. If the main **/feed** page uses different markup, the popup will show "0 posts found" or a no-text warning: send me a saved copy of the page (Ctrl+S) and I'll adjust `selectors.js`.
- Popup appearance (no screenshot), and pause/resume by hand.
- Whether LinkedIn's `componentkey` hash is stable across page loads. If it isn't, the "same text + same author" rule prevents double rows (logged as `ingest_rekey`).

### Notes
- Your running `npm run dev` hot-reloaded the server during this change, so your `data/hireloop.db` is already on schema v2. Restart `npm run dev` once to make sure the API has every new route.
- `ck:` keys and the missing permalinks are documented in PLAN.md ("LinkedIn's two DOM generations").

### Open questions
- In Phase 2, should `job_url` posts (LinkedIn job cards, usually "Easy Apply") go straight to the Apply manually list?
- `posts.raw_text` is only filled when the text selectors miss (to keep the DB small). Store it always if you want Phase 2 to see comments and other surrounding text.
