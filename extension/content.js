// Runs on linkedin.com. READ-ONLY: never clicks, scrolls, expands, connects or messages.
// - MutationObserver: finds post elements as LinkedIn adds them while you scroll.
// - IntersectionObserver: captures a post once ≥30% of it is actually on screen.
// - Re-sends a post when its text grows (e.g. after YOU click "…more").
// Batches go to background.js, which delivers them to the local server.

(() => {
  if (globalThis.__hireloopContent) return; // injected once per page
  globalThis.__hireloopContent = true;

  const P = globalThis.HL_PARSE;
  const FLUSH_MS = 1500;
  const FLUSH_MAX = 20;
  const RESCAN_MS = 400;

  let paused = false;
  let dead = false; // extension reloaded/removed → this script is orphaned
  const observed = new WeakSet();
  const visible = new Set();
  const sentLength = new Map(); // post id → text length already sent
  const stats = { found: 0, captured: 0, noText: 0, promoted: 0, lastCaptureAt: null };
  let queue = [];
  let flushTimer = null;
  let rescanTimer = null;

  chrome.storage.local.get("paused").then((v) => (paused = !!v.paused)).catch(() => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && "paused" in changes) {
      paused = !!changes.paused.newValue;
      if (!paused) visible.forEach(capture); // catch up on what's on screen now
    }
  });

  function capture(root) {
    if (paused || dead) return;
    if (!root.isConnected) {
      visible.delete(root);
      return;
    }
    let post;
    try {
      post = P.parsePost(root, location);
    } catch (err) {
      console.warn("[HireLoop] parse error", err);
      return;
    }
    if (!post) return;
    if (post.promoted) {
      if (!root.__hlPromoted) stats.promoted++;
      root.__hlPromoted = true;
      return;
    }
    const body = post.text || post.rawText;
    if (!body) return; // content not rendered yet; the next rescan retries
    const id = post.key || `${post.author}|${body.slice(0, 200)}`;
    const prev = sentLength.get(id);
    if (prev !== undefined && body.length <= prev) return;
    if (prev === undefined) {
      stats.captured++;
      if (!post.text) stats.noText++;
    }
    sentLength.set(id, body.length);
    stats.lastCaptureAt = Date.now();
    delete post.hasMore;
    delete post.dom;
    queue.push(post);
    if (queue.length >= FLUSH_MAX) flush();
    else if (!flushTimer) flushTimer = setTimeout(flush, FLUSH_MS);
  }

  function flush() {
    clearTimeout(flushTimer);
    flushTimer = null;
    if (!queue.length || dead) return;
    const posts = queue;
    queue = [];
    try {
      chrome.runtime.sendMessage({ type: "hl:posts", posts }).catch(onSendError);
    } catch (err) {
      onSendError(err);
    }
  }

  function onSendError(err) {
    if (/context invalidated/i.test(String(err && err.message))) shutdown();
    else console.warn("[HireLoop] could not reach the extension worker", err);
  }

  // After the extension is reloaded, old content scripts can't talk to it. Stop quietly;
  // the new content script takes over when the page is reloaded.
  function shutdown() {
    dead = true;
    io.disconnect();
    mo.disconnect();
    console.info("[HireLoop] extension was reloaded. Refresh this tab to resume capturing.");
  }

  // "Seen" = 30% of the post is on screen, or it fills half the screen (tall posts can
  // never reach 30%). Many thresholds so the callback re-fires as a tall post scrolls in.
  const THRESHOLDS = Array.from({ length: 21 }, (_, i) => i / 20);
  const isSeen = (e) => {
    const vh = window.innerHeight || document.documentElement.clientHeight;
    return e.intersectionRect.height >= Math.min(0.3 * e.boundingClientRect.height, 0.5 * vh);
  };
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) {
          visible.delete(e.target);
        } else if (isSeen(e)) {
          visible.add(e.target);
          capture(e.target);
        }
      }
    },
    { threshold: THRESHOLDS },
  );

  function scan() {
    rescanTimer = null;
    if (dead) return;
    for (const root of P.findPostRoots(document)) {
      if (observed.has(root)) continue;
      observed.add(root);
      stats.found++;
      io.observe(root);
    }
    // Posts on screen may have changed (text expanded, lazy content loaded).
    visible.forEach(capture);
  }

  const mo = new MutationObserver(() => {
    if (!rescanTimer) rescanTimer = setTimeout(scan, RESCAN_MS);
  });
  mo.observe(document.body, { childList: true, subtree: true, characterData: true });

  // Popup asks for this tab's numbers.
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === "hl:pageStats") {
      sendResponse({ ...stats, paused, url: location.href });
    }
  });

  window.addEventListener("pagehide", flush);
  scan();
})();
