# 005 — Fix capture for LinkedIn's live DOM (keys, headline, time)

## Goal
Make capture work correctly on the LinkedIn markup served today (November 2026), found from a page saved by the owner from a live LinkedIn search.

## Problem (from the owner's 35 real captured posts)
| Symptom | Count | Cause |
|---|---|---|
| Every key is a server-derived `tx:` key, never `ck:` | 35/35 | The post container is now `[role="listitem"][componentkey="update-card-focus<hash>FeedType_…"]`. The April 2026 sample used the `expanded<hash>…` prefix, and that's what the root selector and key pattern required. Posts were only found via the backup path, and the key pattern didn't match. |
| `author_headline` empty | 35/35 | The author link now holds only the name and "• 2nd". The headline `<p>` and the time `<p>` moved to sibling elements outside the link. |
| `posted_label` empty | 35/35 | Same cause. |

Why this matters: a `tx:` key is derived from author + text. If you expand "…more", the text changes, so the key changes and the post can be stored twice. Phase 2 also wants the headline (e.g. "HR at …").

Facts from the saved page:
- The same 43-character hash appears as `update-card-focus<hash>…`, as `expanded<hash>…`, and as a bare `componentkey="<hash>"` on the post's inner `div`. So the hash identifies the post; only the prefix changes.
- `urn:li:activity:…` IDs exist only inside `<script>` data, not in the page markup, so there are still no permalinks.
- The 14 `duplicate` rows are genuine: the same post copied across several "Ocean IT …" company pages.

## Scope
**In**
- `extension/selectors.js`:
  - Root: any `[role="listitem"]` whose `componentkey` contains `FeedType_` (prefix-agnostic), keeping the old selectors as backups.
  - Key: the 43-character base64url hash right before `FeedType_`. Backup: an inner element whose `componentkey` is exactly such a hash. Older prefix-based pattern kept as a last resort.
- `extension/parse.js`: author header = the largest ancestor of the author link that doesn't contain the post text. Name, headline and time are read from all `<p>` lines in that header (works for the old and new layouts).
- `extension/test/parse.test.html`: add a synthetic post in the new live layout (headline and time outside the link).
- Server `POST /api/ingest`: when a post already stored under a `tx:` key is seen again with a real key (same text + same author), **upgrade the stored key** to the real one (`ingest_rekey` event with `from`/`to`). Existing rows heal as you scroll past them again.
- Server: when a stored post is seen again, fill in fields that are still empty (headline, time, author link, job link) with `COALESCE`, never overwriting. This backfills the 35 existing rows as you scroll past them again.
- `.gitignore`: ignore saved LinkedIn pages (`*LinkedIn*.html`, `extension/*_files/`) so other people's posts are never committed.

**Out**
- Reading URNs from `<script>` data: it only covers posts rendered on first page load, not ones loaded while scrolling.

## How to test
1. `npm test`: includes a new test for the `tx:` → real key upgrade.
2. `extension/test/parse.test.html`: all green, including the new live-layout post.
3. Parser on the owner's saved page (outside the repo): every post has a `ck:` key, headline and time.
4. Owner: reload the extension in `chrome://extensions`, reload the LinkedIn tab, scroll. The popup counts go up, and new posts in the UI show headline and time.

## Status
**Done. Waiting for owner review.**

Built as scoped. One change from the plan: the key is matched **exactly** first, as the inner element's bare hash that the container key ends with, then by known prefixes, then by "43 chars before `FeedType_`". The synthetic test showed that a fixed 43-character window grabs prefix letters if a hash is ever a different length.

### Test results (2026-11-08)
| Test | Result |
|---|---|
| `extension/test/parse.test.html` | 31/31 pass (6 new checks for the Nov 2026 layout) |
| Parser on the owner's saved live page (Nov 2026) | 3/3 posts: `ck:` key (43-char hash), author, headline, time, text |
| Parser on the April 2026 page (regression) | 33/33, same as before |
| `npm test` | 17/17 pass, including a new test: `tx:` row → upgraded to `ck:` with headline and time filled → a later "…more" expansion updates that row instead of creating a second one |
| E2E: DB seeded with the 3 live posts as the old extension stored them (`tx:`, no headline), then the fixed extension run over the live page in Chrome | Still **3 rows**, now with `ck:` keys, headlines and time labels; no duplicates |
| `npm run typecheck` | Pass |

### Owner steps
1. `chrome://extensions` → HireLoop Capture → reload icon. Then reload the LinkedIn tab.
2. Scroll. New posts show headline and time. Old posts upgrade when they scroll past again.

### Notes
- The saved page has only 3 posts (LinkedIn renders posts lazily), so the live layout is verified on 3 posts plus the synthetic test.
- `extension/Search _ LinkedIn.html` is now gitignored. It's also inside the folder Chrome loads as the extension; that's harmless, but moving it to `data/` (also gitignored) keeps the extension folder clean.
- The main **/feed** page wasn't in the saved sample. If its popup shows 0 posts or missing text, save that page too.
