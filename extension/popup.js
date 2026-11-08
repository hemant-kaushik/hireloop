const API = "http://127.0.0.1:3001";
const UI = "http://localhost:5173";
const $ = (id) => document.getElementById(id);

function show(id, text) {
  const el = $(id);
  el.hidden = !text;
  el.textContent = text || "";
}

async function checkServer() {
  try {
    const res = await fetch(`${API}/api/health`, { signal: AbortSignal.timeout(3000) });
    const h = await res.json();
    $("serverDot").className = `dot ${h.ok ? "ok" : "bad"}`;
    $("serverText").textContent = h.ok ? (h.profile && !h.profile.ready ? "Online · profile not ready" : "Server online") : "Server error";
  } catch {
    $("serverDot").className = "dot bad";
    $("serverText").textContent = "Server offline";
  }
}

async function renderStats() {
  const { queue = [], stats = {}, paused = false } = await chrome.storage.local.get(["queue", "stats", "paused"]);
  $("captured").textContent = stats.captured || 0;
  $("delivered").textContent = stats.delivered || 0;
  $("newOnServer").textContent = stats.newOnServer || 0;
  $("queued").textContent = queue.length;
  $("pause").checked = paused;

  const recent = stats.recentNoText || [];
  const noText = recent.reduce((a, b) => a + b, 0);
  const warn =
    recent.length >= 5 && noText / recent.length > 0.3
      ? `${noText} of the last ${recent.length} posts were captured without their text. LinkedIn may have changed its HTML: update extension/selectors.js.`
      : "";
  show("warnBox", warn);
  show("errorBox", stats.lastError || "");
}

async function renderTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const s = await chrome.tabs.sendMessage(tab.id, { type: "hl:pageStats" });
    let text = `This page: ${s.found} posts found, ${s.captured} captured`;
    if (s.noText) text += `, ${s.noText} without text`;
    if (s.promoted) text += `, ${s.promoted} ads skipped`;
    text += ".";
    if (s.found === 0) text += " No posts detected yet. Scroll a little, or reload the tab if you just installed the extension.";
    show("tabBox", text);
  } catch {
    show("tabBox", "Open a LinkedIn tab (feed or search results) to capture posts. Already open? Reload it once.");
  }
}

$("pause").addEventListener("change", (e) => chrome.storage.local.set({ paused: e.target.checked }));

$("flush").addEventListener("click", async () => {
  const btn = $("flush");
  btn.disabled = true;
  btn.textContent = "Sending…";
  try {
    await chrome.runtime.sendMessage({ type: "hl:flush" });
  } finally {
    btn.disabled = false;
    btn.textContent = "Send now";
    await Promise.all([renderStats(), checkServer()]);
  }
});

$("open").addEventListener("click", () => chrome.tabs.create({ url: UI }));

$("reset").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "hl:resetStats" });
  await renderStats();
});

chrome.storage.onChanged.addListener((_c, area) => area === "local" && renderStats());

checkServer();
renderStats();
renderTab();
setInterval(() => {
  checkServer();
  renderTab();
}, 3000);
