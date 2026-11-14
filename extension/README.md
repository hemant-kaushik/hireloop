# HireLoop Capture (Chrome extension)

Reads the LinkedIn posts that appear on your screen and sends them to your local HireLoop server (`http://127.0.0.1:3001`). **Read-only:** it never clicks, scrolls, expands, connects or messages.

## Install
1. Start the server: `npm run dev` in the project folder.
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and pick this `extension/` folder.
3. Reload any LinkedIn tab that was already open.
4. Scroll your feed, or a search for posts (e.g. search "hiring node" → Posts). Posts appear in the UI at http://localhost:5173.

After changing any file here, click the reload icon on the extension card, then reload the LinkedIn tab.

## Files
| File | What it does |
|---|---|
| `selectors.js` | **Every LinkedIn selector.** The only file to fix when LinkedIn changes its HTML. |
| `parse.js` | One post element → plain object (key, author, headline, text, job link…). No side effects. |
| `content.js` | Finds posts as they load (MutationObserver), captures them once they're on screen (IntersectionObserver), batches them to the worker. |
| `background.js` | Persistent queue; delivers to `/api/ingest`; retries every minute while the server is down; counters and badge. |
| `popup.html/js` | Server status, counts, pause switch, "Send now", warnings. |
| `test/parse.test.html` | Parser tests on synthetic posts. Open it in Chrome; it should say "All N passed". |

## Popup
- **captured**: posts read from your tabs (including re-sends when you expand "…more").
- **delivered**: accepted by the server. **new**: of those, posts the server hadn't seen before.
- **queued**: waiting for the server. The toolbar badge shows this number, red while the server is offline.
- A warning appears when many recent posts were captured without text, which usually means LinkedIn changed its HTML.

## When capture breaks
1. The popup shows "0 posts found" or a "without text" warning.
2. On LinkedIn, right-click a post → Inspect. Find the stable hooks: `role`, `data-testid`, `componentkey`, `aria-label`, `href`. **Never use hashed class names** like `c127c4d1`; they change on every LinkedIn deploy.
3. Or save the page (Ctrl+S → "Webpage, Complete"). Saved pages named `*LinkedIn*.html` are gitignored, because they contain other people's posts. To run the parser on one, remove its `Content-Security-Policy` `<meta>` tag first.
4. Update `selectors.js`, add a matching synthetic post to `test/parse.test.html`, and keep that page green.

History: November 2026, the post container's `componentkey` prefix changed from `expanded…` to `update-card-focus…`, and the headline and time moved out of the author link (doc 005).

## Notes
- LinkedIn's newer layout has no post permalinks in the page, so posts are keyed by the post hash in their `componentkey` (`ck:…`). The UI's "Find post" link searches LinkedIn for the post's opening words instead.
- The full post text is usually already in the page, even when LinkedIn shows "…more". If it isn't, clicking "…more" yourself makes the extension re-send the longer text.
- Promoted posts are skipped.
