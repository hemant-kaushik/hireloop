// Whole Phase 2 pipeline on a throwaway DB with DUMMY posts and a fake LLM.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { DUMMY_PREFS, cleanup, profileDir, writeProfile } from "./helpers.ts";

writeProfile();
const { ingestPosts } = await import("../src/routes/ingest.ts");
const { startProcessing, runState, reapplyRules } = await import("../src/pipeline/process.ts");
const { setProvidersForTest, resetGatewayState } = await import("../src/llm/gateway.ts");
const { ProviderError } = await import("../src/llm/providers.ts");
const { db } = await import("../src/db/index.ts");
type Provider = import("../src/llm/providers.ts").Provider;

after(cleanup);

// Fake LLM: answers by a tag in the post text. Never sees emails (asserted below).
let failTag = "FAILME";
const seenPrompts: string[] = [];
const job = (o: Record<string, unknown>) =>
  JSON.stringify({
    is_job_post: true, is_job_seeker: false, title: "Node.js Developer", other_titles: [], company: "Acme",
    exp_min: 2, exp_max: 4, location: "Noida", work_mode: "onsite", employment_type: "full-time",
    tech_stack: ["Node.js", "React", "PostgreSQL"], apply_url: null, summary: "Node role", ...o,
  });
const fakeLlm: Provider = {
  name: "fake",
  model: "fake-1",
  rpm: 60_000,
  configured: () => true,
  listModels: async () => [],
  async call({ prompt }) {
    seenPrompts.push(prompt);
    if (prompt.includes(failTag)) throw new ProviderError("server", "fake: HTTP 503");
    if (prompt.includes("[T:seeker]")) return JSON.stringify({ is_job_post: false, is_job_seeker: true });
    if (prompt.includes("[T:senior]")) return job({ title: "Senior Node Developer", exp_min: 8, exp_max: 12 });
    return job({});
  },
};

const posts = {
  match: { key: "ck:match0000000000000000", author: "HR One", text: "[T:match] We're hiring a Node.js developer, 2-4 yrs, Noida. Send CV to jobs@acme.example" },
  noEmail: { key: "ck:noemail00000000000000", author: "HR Two", text: "[T:noemail] We're hiring a Node.js developer, 2-4 yrs, Noida. Apply via the job link", jobUrl: "https://www.linkedin.com/jobs/view/123/" },
  seeker: { key: "ck:seeker0000000000000000", author: "Dev", text: "[T:seeker] Looking for a role as a React developer, please refer me" },
  noSignal: { key: "ck:nosignal00000000000000", author: "Someone", text: "Great conference today, thanks to all the speakers" },
  dubai: { key: "ck:dubai000000000000000000", author: "HR Three", text: "We're hiring Node devs in Dubai, send CV to hr@acme.example" },
  blocked: { key: "ck:blocked0000000000000000", author: "Ocean IT HR Service", text: "We're hiring Node devs, Noida, mail jobs@ocean.example" },
  senior: { key: "ck:senior00000000000000000", author: "HR Four", text: "[T:senior] Hiring Senior Node developer 8-12 years, Noida, cv@big.example" },
  flaky: { key: "ck:flaky000000000000000000", author: "HR Five", text: "FAILME We're hiring Node devs, Noida, mail flaky@acme.example" },
};

const statusOf = (key: string) => (db.prepare("SELECT status FROM posts WHERE urn = ?").get(key) as { status: string }).status;
const jobOf = (key: string) =>
  db.prepare("SELECT j.* FROM jobs j JOIN posts p ON p.id = j.post_id WHERE p.urn = ?").get(key) as Record<string, any> | undefined;
const eventsOf = (key: string) =>
  (db.prepare("SELECT e.type FROM events e JOIN posts p ON p.id = e.post_id WHERE p.urn = ? ORDER BY e.id").all(key) as { type: string }[]).map((e) => e.type);

async function runToEnd() {
  startProcessing();
  for (let i = 0; i < 200 && runState().running; i++) await new Promise((r) => setTimeout(r, 10));
  return runState();
}

before(() => {
  resetGatewayState();
  setProvidersForTest([fakeLlm]);
  ingestPosts(Object.values(posts));
});

test("Process: every post ends in the expected status, with a reason", async () => {
  const st = await runToEnd();
  assert.equal(st.done, 8);
  assert.equal(statusOf(posts.match.key), "matched");
  assert.equal(statusOf(posts.noEmail.key), "no_email");
  assert.equal(statusOf(posts.seeker.key), "not_job");
  assert.equal(statusOf(posts.noSignal.key), "rejected_prefilter");
  assert.equal(statusOf(posts.dubai.key), "rejected_prefilter");
  assert.equal(statusOf(posts.blocked.key), "blocked");
  assert.equal(statusOf(posts.senior.key), "filtered_out");
  assert.equal(statusOf(posts.flaky.key), "error");
  assert.match(st.lastError ?? "", /fake: HTTP 503/);

  const reasons = db.prepare("SELECT urn, reject_reason FROM posts WHERE status IN ('rejected_prefilter','blocked','filtered_out','not_job','error')").all() as {
    reject_reason: string | null;
  }[];
  for (const r of reasons) assert.ok(r.reject_reason, "every dropped post has a reason");
});

test("only the LLM-worthy posts reached the LLM, with emails masked", () => {
  assert.equal(seenPrompts.length, 5); // match, noEmail, seeker, senior, flaky (gate dropped 3)
  for (const p of seenPrompts) assert.ok(!/@acme\.example|@big\.example/.test(p), "no raw emails sent");
  assert.ok(seenPrompts.some((p) => p.includes("Send CV to [EMAIL]")));
  assert.ok(seenPrompts.every((p) => !p.includes("HR One")), "author name is not sent");
});

test("jobs row: score, reasons, emails from the regex, provider", () => {
  const j = jobOf(posts.match.key)!;
  assert.equal(j.score, 100); // stack 3/3 + role + exp + location
  assert.deepEqual(JSON.parse(j.emails), ["jobs@acme.example"]);
  assert.equal(j.provider, "fake");
  assert.match(JSON.parse(j.match_reasons)[0], /Stack: Node\.js, React, PostgreSQL \(3\/3\)/);
  assert.match(JSON.parse(jobOf(posts.senior.key)!.filter_reasons)[0], /Needs 8–12 yrs/);
  assert.deepEqual(eventsOf(posts.match.key), ["ingest_inserted", "llm_extract", "matched"]);
  assert.deepEqual(eventsOf(posts.dubai.key), ["ingest_inserted", "prefilter_reject"]);
});

test("Process again retries only `error` posts", async () => {
  failTag = "NEVER";
  resetGatewayState(); // the provider is cooling down after its 503 (the gateway would wait up to 30 s)
  const before = seenPrompts.length;
  const st = await runToEnd();
  assert.equal(st.total, 1);
  assert.equal(seenPrompts.length, before + 1);
  assert.equal(statusOf(posts.flaky.key), "matched");
});

test("Re-apply rules after editing preferences.yaml: no LLM calls", () => {
  const before = seenPrompts.length;
  writeFileSync(
    path.join(profileDir, "preferences.yaml"),
    JSON.stringify({ ...DUMMY_PREFS, accept_exp_range: [1, 15], block_authors: [], disable_rules: ["non_india"] }),
  );
  const r = reapplyRules();
  assert.equal(seenPrompts.length, before, "no LLM calls");
  assert.equal(statusOf(posts.senior.key), "matched"); // 8–12 now accepted
  assert.equal(statusOf(posts.blocked.key), "new"); // unblocked, never extracted → needs Process
  assert.equal(statusOf(posts.dubai.key), "new"); // non_india switched off → needs Process
  assert.ok(r.counts.new >= 2);
});

test("Process refuses to start when the profile isn't ready", () => {
  writeFileSync(path.join(profileDir, "preferences.yaml"), "roles: [");
  assert.throws(() => startProcessing(), /Profile not ready/);
});
