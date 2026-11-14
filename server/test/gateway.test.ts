import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { z } from "zod";
import { cleanup } from "./helpers.ts";

const { generateJSON, setProvidersForTest, resetGatewayState, LlmUnavailableError, LlmBudgetError, parseJsonLoose, llmUsage } =
  await import("../src/llm/gateway.ts");
const { ProviderError } = await import("../src/llm/providers.ts");
const { db } = await import("../src/db/index.ts");
type Provider = import("../src/llm/providers.ts").Provider;

after(cleanup);
beforeEach(() => {
  resetGatewayState();
  db.exec("DELETE FROM llm_calls");
});

/** A fake provider that returns scripted replies (string) or throws (Error), in order. */
function fake(name: string, script: (string | Error)[]): Provider & { calls: string[] } {
  const calls: string[] = [];
  return {
    name,
    model: `${name}-model`,
    rpm: 60_000,
    calls,
    configured: () => true,
    listModels: async () => [],
    async call({ prompt }) {
      calls.push(prompt);
      const next = script.shift();
      if (next === undefined) throw new Error("script exhausted");
      if (next instanceof Error) throw next;
      return next;
    },
  };
}

const Schema = z.object({ ok: z.boolean(), n: z.number() });
const ask = () => generateJSON({ task: "test", system: "s", prompt: "p", schema: Schema });

test("returns validated data from the first provider", async () => {
  const a = fake("a", ['{"ok":true,"n":1}']);
  setProvidersForTest([a]);
  assert.deepEqual(await ask(), { data: { ok: true, n: 1 }, provider: "a", model: "a-model" });
});

test("tolerates ```json fences and text around the object", () => {
  assert.deepEqual(parseJsonLoose('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseJsonLoose('Sure! {"a":1} hope that helps'), { a: 1 });
});

test("429 on the first provider → falls back to the second, and the first cools down", async () => {
  const a = fake("a", [new ProviderError("rate_limit", "a: rate limited (429)", 5000)]);
  const b = fake("b", ['{"ok":true,"n":2}', '{"ok":true,"n":3}']);
  setProvidersForTest([a, b]);
  assert.equal((await ask()).provider, "b");
  assert.equal((await ask()).data.n, 3);
  assert.equal(a.calls.length, 1, "a is skipped while cooling down");
});

test("invalid output → one retry on the same provider, with the error fed back", async () => {
  const a = fake("a", ['{"ok":"yes"}', '{"ok":true,"n":7}']);
  setProvidersForTest([a]);
  assert.equal((await ask()).data.n, 7);
  assert.match(a.calls[1], /Your previous reply was invalid: ok:/);
});

test("invalid twice → next provider", async () => {
  const a = fake("a", ["not json", "still not json"]);
  const b = fake("b", ['{"ok":false,"n":0}']);
  setProvidersForTest([a, b]);
  assert.equal((await ask()).provider, "b");
});

test("all providers fail → LlmUnavailableError listing each attempt", async () => {
  setProvidersForTest([
    fake("a", [new ProviderError("server", "a: HTTP 503")]),
    fake("b", [new ProviderError("auth", "b: key rejected (401)")]),
  ]);
  await assert.rejects(ask(), (err: unknown) => err instanceof LlmUnavailableError && /a: HTTP 503.*b: key rejected/.test((err as Error).message));
});

test("no provider configured → clear error", async () => {
  setProvidersForTest([]);
  await assert.rejects(ask(), /no provider configured/);
});

test("every call is logged; the daily budget stops calls", async () => {
  setProvidersForTest([fake("a", ['{"ok":true,"n":1}'])]);
  await ask();
  const row = db.prepare("SELECT provider, model, task, ok FROM llm_calls").get() as Record<string, unknown>;
  assert.deepEqual({ ...row }, { provider: "a", model: "a-model", task: "test", ok: 1 });

  const { budget } = llmUsage();
  const ins = db.prepare("INSERT INTO llm_calls (at, provider, model, task, ok) VALUES (?, 'x', 'x', 'x', 1)");
  for (let i = 0; i < budget; i++) ins.run(Date.now());
  setProvidersForTest([fake("a", ['{"ok":true,"n":1}'])]);
  await assert.rejects(ask(), (err: unknown) => err instanceof LlmBudgetError);
});

test("when every provider is cooling down briefly, the gateway waits instead of failing", async () => {
  const a = fake("a", [new ProviderError("rate_limit", "a: rate limited (429)", 300), '{"ok":true,"n":9}']);
  setProvidersForTest([a]);
  await assert.rejects(ask(), LlmUnavailableError); // first call: 429, no other provider
  const t0 = Date.now();
  assert.equal((await ask()).data.n, 9); // waits out the cooldown, then succeeds
  assert.ok(Date.now() - t0 >= 250);
});

test("out of credits → that provider pauses for an hour, the next one answers", async () => {
  const a = fake("a", [new ProviderError("no_credits", "a: no credits/quota left on this account")]);
  const b = fake("b", ['{"ok":true,"n":4}', '{"ok":true,"n":5}']);
  setProvidersForTest([a, b]);
  assert.equal((await ask()).provider, "b");
  assert.equal((await ask()).provider, "b");
  assert.equal(a.calls.length, 1, "no retry while out of credits");
});
