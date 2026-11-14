// API tests against a throwaway database. DB_PATH must be set before the app is imported.
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { cleanup } from "./helpers.ts"; // throwaway DB + dummy profile dir

const { createApp } = await import("../src/app.ts");
const { isAllowedOrigin } = await import("../src/app.ts");

let base = "";
let close: () => void;

before(async () => {
  const server = createApp().listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => server.close();
});
after(() => {
  close();
  cleanup();
});

async function ingest(posts: unknown[], headers: Record<string, string> = {}) {
  const res = await fetch(`${base}/api/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ posts }),
  });
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}
async function get(p: string) {
  const res = await fetch(`${base}${p}`);
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

const hiring = {
  key: "ck:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  author: "Priya Sharma",
  authorHeadline: "Talent Acquisition at Acme",
  authorUrl: "https://www.linkedin.com/in/priya/?miniProfileUrn=xyz",
  text: "We're hiring Node.js developers (2-4 yrs), Bangalore. Send CV to Careers@Acme.com …more",
  postedLabel: "3h",
  pageUrl: "https://www.linkedin.com/feed/",
  parseQuality: "ok",
  jobUrl: "https://www.linkedin.com/jobs/view/123/?trackingId=abc",
  source: "feed",
};

test("schema is migrated to the latest version", async () => {
  const { MIGRATIONS } = await import("../src/db/migrations.ts");
  const { body } = await get("/api/health");
  assert.equal(body.db.schemaVersion, MIGRATIONS.length);
  assert.ok(body.llm && Array.isArray(body.llm.providers), "health reports LLM status");
});

test("ingest inserts a new post, extracts emails and strips tracking params", async () => {
  const { body } = await ingest([hiring]);
  assert.equal(body.inserted, 1);
  const list = await get("/api/posts");
  assert.equal(list.body.total, 1);
  const p = list.body.posts[0];
  assert.deepEqual(p.emails, ["careers@acme.com"]);
  assert.equal(p.author_url, "https://www.linkedin.com/in/priya/");
  assert.equal(p.job_url, "https://www.linkedin.com/jobs/view/123/");
  assert.equal(p.status, "new");
  const detail = await get(`/api/posts/${p.id}`);
  assert.deepEqual(detail.body.events.map((e: any) => e.type), ["ingest_inserted"]);
});

test("same key again is ignored; longer text updates the post", async () => {
  assert.equal((await ingest([hiring])).body.seen, 1);
  const longer = { ...hiring, text: hiring.text.replace(" …more", "") + " Also DM hr@acme.com for referrals." };
  const { body } = await ingest([longer]);
  assert.equal(body.updated, 1);
  const p = (await get("/api/posts")).body.posts[0];
  assert.deepEqual(p.emails, ["careers@acme.com", "hr@acme.com"]);
  const ev = (await get(`/api/posts/${p.id}`)).body.events.map((e: any) => e.type);
  assert.deepEqual(ev, ["ingest_inserted", "ingest_updated"]);
});

test("same text + same author under a new key is not stored twice", async () => {
  const p = (await get("/api/posts")).body.posts[0];
  const full = (await get(`/api/posts/${p.id}`)).body.post.text;
  const { body } = await ingest([{ ...hiring, key: "ck:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB", text: full }]);
  assert.equal(body.seen, 1);
  assert.equal((await get("/api/posts")).body.total, 1);
});

test("same text from a different author is stored as a duplicate (repost)", async () => {
  const p = (await get("/api/posts")).body.posts[0];
  const full = (await get(`/api/posts/${p.id}`)).body.post.text;
  const { body } = await ingest([{ ...hiring, key: "urn:li:activity:7300000000000000001", author: "Someone Else", text: full }]);
  assert.equal(body.duplicates, 1);
  const all = await get("/api/posts");
  assert.equal(all.body.total, 1, "duplicates are hidden from the default list");
  assert.equal(all.body.counts.duplicate, 1);
  const dups = await get("/api/posts?status=duplicate");
  assert.match(dups.body.posts[0].reject_reason, /same text as post #/);
});

test("posts without a key get a stable derived key", async () => {
  const noKey = { author: "Rahul", text: "Hiring React devs in Pune, mail jobs@pune.dev" };
  assert.equal((await ingest([noKey])).body.inserted, 1);
  assert.equal((await ingest([noKey])).body.seen, 1);
  const p = (await get("/api/posts?q=pune")).body.posts[0];
  assert.match(p.urn, /^tx:[0-9a-f]{32}$/);
});

test("a tx: key is upgraded to LinkedIn's key when seen again, and missing headline/time are filled", async () => {
  const old = { author: "Yasmeen", text: "Today's openings: MERN dev, Noida. Mail cv@hirenza.example" }; // pre-005 capture
  assert.equal((await ingest([old])).body.inserted, 1);
  const before = (await get("/api/posts?q=hirenza")).body.posts[0];
  assert.match(before.urn, /^tx:/);
  assert.equal(before.author_headline, null);

  const ck = "ck:xmrL5q1amhMGkDa0ERropd0dd-rlv7Gly2syHD6-zK0";
  const now = { ...old, key: ck, authorHeadline: "HR at Hirenza", postedLabel: "3d" };
  assert.equal((await ingest([now])).body.seen, 1);
  const after = (await get(`/api/posts/${before.id}`)).body;
  assert.equal(after.post.urn, ck);
  assert.equal(after.post.author_headline, "HR at Hirenza");
  assert.equal(after.post.posted_label, "3d");
  assert.deepEqual(after.events.at(-1).data, { from: before.urn, to: ck });

  // Expanding "…more" later now updates the same row instead of creating a second one.
  const longer = await ingest([{ ...now, text: `${old.text} Also hiring QA, 1-3 yrs.` }]);
  assert.equal(longer.body.updated, 1);
  assert.equal((await get("/api/posts?q=hirenza")).body.total, 1);
});

test("invalid posts are counted, not stored", async () => {
  const { body } = await ingest([{ key: "javascript:alert(1)", text: "x" }, { key: "ck:CCCCCCCCCCCCCCCCCCCCCC", text: "" }, null]);
  assert.equal(body.invalid, 3);
  assert.equal(body.inserted, 0);
});

test("non-LinkedIn URLs are dropped", async () => {
  await ingest([{ ...hiring, key: "ck:DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD", author: "X", text: "unique text 1", authorUrl: "javascript:alert(1)", jobUrl: "https://evil.com/jobs/view/1" }]);
  const p = (await get("/api/posts?q=unique%20text%201")).body.posts[0];
  assert.equal(p.author_url, null);
  assert.equal(p.job_url, null);
});

test("bad request shapes", async () => {
  const res = await fetch(`${base}/api/ingest`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  assert.equal(res.status, 400);
  assert.equal((await ingest(new Array(101).fill(hiring))).status, 413);
});

test("search escapes LIKE wildcards", async () => {
  assert.equal((await get("/api/posts?q=%25")).body.total, 0);
});

test("origin guard", async () => {
  assert.equal((await ingest([], { Origin: "https://evil.example" })).status, 403);
  assert.equal((await ingest([], { Origin: "chrome-extension://abcdef" })).status, 200);
  assert.ok(isAllowedOrigin("http://localhost:5173"));
  assert.ok(isAllowedOrigin(undefined));
  assert.ok(!isAllowedOrigin("http://localhost.evil.com"));
  assert.ok(!isAllowedOrigin("https://www.linkedin.com"));
});
