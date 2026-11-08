// Service worker. Receives captured posts from content.js, keeps them in a persistent queue
// (chrome.storage.local survives worker restarts and browser restarts), and delivers them to
// the local HireLoop API. If the server is down, nothing is lost: retry every minute.

const API = "http://127.0.0.1:3001";
const BATCH = 50; // server accepts up to 100
const MAX_QUEUE = 3000; // oldest posts are dropped beyond this
const RECENT = 50; // window for the "posts without text" warning
const TIMEOUT_MS = 10_000;

const DEFAULT_STATS = {
  captured: 0, // posts received from tabs (new + text updates)
  delivered: 0, // accepted by the server
  newOnServer: 0, // of those, stored as new posts
  dropped: 0, // lost because the queue was full, or rejected by the server
  recentNoText: [], // 1 = parsed without text (last RECENT posts)
  serverOnline: null,
  lastError: null,
  lastAttemptAt: null,
  lastDeliveredAt: null,
};

// Serialize every read-modify-write of storage (messages and alarms can overlap).
let chain = Promise.resolve();
const locked = (fn) => {
  const p = chain.then(fn, fn);
  chain = p.catch(() => {});
  return p;
};

async function load() {
  const v = await chrome.storage.local.get(["queue", "stats"]);
  return { queue: v.queue || [], stats: { ...DEFAULT_STATS, ...(v.stats || {}) } };
}
const save = (queue, stats) => chrome.storage.local.set({ queue, stats });

async function updateBadge(queueLen, online) {
  const text = queueLen > 0 ? (queueLen > 999 ? "999+" : String(queueLen)) : "";
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color: online === false ? "#b3261e" : "#a15c00" });
}

function enqueue(posts) {
  return locked(async () => {
    const { queue, stats } = await load();
    queue.push(...posts);
    if (queue.length > MAX_QUEUE) {
      const extra = queue.length - MAX_QUEUE;
      queue.splice(0, extra);
      stats.dropped += extra;
      stats.lastError = `Queue full: dropped ${extra} oldest posts. Is the server running?`;
    }
    stats.captured += posts.length;
    stats.recentNoText = [...stats.recentNoText, ...posts.map((p) => (p.text ? 0 : 1))].slice(-RECENT);
    await save(queue, stats);
    await updateBadge(queue.length, stats.serverOnline);
  });
}

async function postBatch(batch) {
  const res = await fetch(`${API}/api/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ posts: batch }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

/** Delivers the queue in batches until it's empty or the server fails. */
function flush() {
  return locked(async () => {
    const { queue, stats } = await load();
    let online = stats.serverOnline;
    while (queue.length) {
      const batch = queue.slice(0, BATCH);
      stats.lastAttemptAt = Date.now();
      try {
        const { status, body } = await postBatch(batch);
        online = true;
        if (status >= 200 && status < 300) {
          queue.splice(0, batch.length);
          stats.delivered += batch.length;
          stats.newOnServer += body.inserted || 0;
          stats.lastDeliveredAt = Date.now();
          stats.lastError = body.invalid ? `Server rejected ${body.invalid} post(s): ${(body.errors || []).join("; ")}` : null;
        } else if (status >= 400 && status < 500 && status !== 408 && status !== 429) {
          // The server will never accept this batch: drop it instead of retrying forever.
          queue.splice(0, batch.length);
          stats.dropped += batch.length;
          stats.lastError = `Server rejected a batch (${status}): ${body.error || "unknown error"}`;
        } else {
          stats.lastError = `Server error ${status}. Will retry.`;
          break;
        }
      } catch (err) {
        online = false;
        stats.lastError = `Server offline (${err.name === "TimeoutError" ? "timeout" : "not reachable"}). ${queue.length} post(s) queued; retrying every minute.`;
        break;
      }
    }
    stats.serverOnline = online;
    await save(queue, stats);
    await updateBadge(queue.length, online);
    return { queued: queue.length, online };
  });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || typeof msg.type !== "string") return;
  if (msg.type === "hl:posts" && Array.isArray(msg.posts)) {
    enqueue(msg.posts).then(flush);
    return; // no response needed
  }
  if (msg.type === "hl:flush") {
    flush().then(sendResponse);
    return true; // async response
  }
  if (msg.type === "hl:resetStats") {
    locked(async () => {
      const { queue } = await load();
      await save(queue, { ...DEFAULT_STATS });
    }).then(() => sendResponse({ ok: true }));
    return true;
  }
});

// Retry loop. Alarms survive the worker being shut down between events.
chrome.alarms.create("hl-retry", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === "hl-retry") flush();
});
chrome.runtime.onStartup.addListener(flush);
chrome.runtime.onInstalled.addListener(flush);
