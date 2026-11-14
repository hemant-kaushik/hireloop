// generateJSON(): the only way the app talks to an LLM.
// Providers in config order (skipping ones without a key), a rate limiter per provider,
// cooldown after 429/5xx/network errors, one retry on invalid JSON, a daily call budget,
// and every call logged to llm_calls (no prompts or replies are stored).

import type { z } from "zod";
import { config } from "../config.js";
import { db } from "../db/index.js";
import { ALL_PROVIDERS, ProviderError, type ErrorKind, type Provider } from "./providers.js";

export class LlmUnavailableError extends Error {
  constructor(readonly attempts: string[]) {
    super(`No LLM provider could answer: ${attempts.join(" | ") || "no provider configured"}`);
  }
}
export class LlmBudgetError extends Error {
  constructor(readonly used: number, readonly budget: number) {
    super(`Daily LLM budget reached (${used}/${budget} calls). Raise LLM_DAILY_BUDGET or try tomorrow.`);
  }
}

// ---- cooldowns + rate limiting (in memory; reset on restart) ----
const COOLDOWN_MS: Record<ErrorKind, number> = {
  rate_limit: 60_000,
  no_credits: 60 * 60_000, // account out of credits: pause this provider for an hour
  server: 30_000,
  network: 30_000,
  auth: 10 * 60_000, // wrong key: don't hammer it
  config: 10 * 60_000, // e.g. model not found
  bad_response: 0,
};
const coolUntil = new Map<string, number>();
const MAX_COOLDOWN_WAIT_MS = 120_000;
const nextSlot = new Map<string, number>();

/** Waits until this provider may be called again (even spacing: 60000 / rpm ms). */
async function acquire(p: Provider): Promise<void> {
  const gap = 60_000 / Math.max(p.rpm, 1);
  const now = Date.now();
  const at = Math.max(now, nextSlot.get(p.name) ?? 0);
  nextSlot.set(p.name, at + gap);
  if (at > now) await new Promise((r) => setTimeout(r, at - now));
}

/** For tests. */
export function resetGatewayState(): void {
  coolUntil.clear();
  nextSlot.clear();
}

// ---- providers in use ----
let providerOverride: Provider[] | null = null;
/** For tests: replace the provider list. */
export function setProvidersForTest(list: Provider[] | null): void {
  providerOverride = list;
}

export function activeProviders(): Provider[] {
  if (providerOverride) return providerOverride;
  return config.llm.order.map((n) => ALL_PROVIDERS[n]).filter((p): p is Provider => !!p && p.configured());
}

// ---- budget + log ----
const startOfToday = () => new Date().setHours(0, 0, 0, 0);
const countToday = db.prepare("SELECT COUNT(*) AS n FROM llm_calls WHERE at >= ?");
const logCall = db.prepare(
  "INSERT INTO llm_calls (at, provider, model, task, ok, latency_ms, error, post_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
);

export function llmUsage(): { usedToday: number; budget: number } {
  return { usedToday: (countToday.get(startOfToday()) as { n: number }).n, budget: config.llm.dailyBudget };
}

/** Parses model output: tolerates ```json fences and text around one JSON object. */
export function parseJsonLoose(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(t);
  } catch {
    const a = t.indexOf("{");
    const b = t.lastIndexOf("}");
    if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
    throw new Error("reply is not JSON");
  }
}

export type GenerateInput<S extends z.ZodTypeAny> = {
  task: string;
  system: string;
  prompt: string;
  schema: S;
  postId?: number | null;
};
export type GenerateResult<T> = { data: T; provider: string; model: string };

export async function generateJSON<S extends z.ZodTypeAny>(input: GenerateInput<S>): Promise<GenerateResult<z.infer<S>>> {
  const attempts: string[] = [];
  const providers = activeProviders();
  if (!providers.length) throw new LlmUnavailableError(["no provider configured (set GEMINI_API_KEY / GROQ_API_KEY in server/.env)"]);

  // Every provider is cooling down (e.g. one free-tier 429): wait it out if it's short, instead of
  // failing every remaining post in the run.
  const soonest = Math.min(...providers.map((p) => (coolUntil.get(p.name) ?? 0) - Date.now()));
  if (soonest > 0 && soonest <= MAX_COOLDOWN_WAIT_MS) await new Promise((r) => setTimeout(r, soonest + 50));

  for (const p of providers) {
    const cooling = (coolUntil.get(p.name) ?? 0) - Date.now();
    if (cooling > 0) {
      attempts.push(`${p.name}: cooling down ${Math.ceil(cooling / 1000)}s`);
      continue;
    }
    let prompt = input.prompt;
    for (let attempt = 0; attempt < 2; attempt++) {
      const { usedToday, budget } = llmUsage();
      if (usedToday >= budget) throw new LlmBudgetError(usedToday, budget);
      await acquire(p);

      const t0 = Date.now();
      let text: string;
      try {
        text = await p.call({ system: input.system, prompt });
      } catch (err) {
        const pe = err instanceof ProviderError ? err : new ProviderError("network", `${p.name}: ${String(err)}`);
        logCall.run(Date.now(), p.name, p.model, input.task, 0, Date.now() - t0, pe.message.slice(0, 300), input.postId ?? null);
        attempts.push(pe.message);
        if (pe.kind === "bad_response" && attempt === 0) continue; // e.g. empty reply: try once more
        // Retry-After from the provider wins for rate limits; otherwise a fixed cooldown per error kind.
        const wait = pe.kind === "rate_limit" && pe.retryAfterMs ? pe.retryAfterMs : COOLDOWN_MS[pe.kind];
        if (wait) coolUntil.set(p.name, Date.now() + wait);
        break; // next provider
      }

      let problem: string;
      try {
        const parsed = input.schema.safeParse(parseJsonLoose(text));
        if (parsed.success) {
          logCall.run(Date.now(), p.name, p.model, input.task, 1, Date.now() - t0, null, input.postId ?? null);
          return { data: parsed.data, provider: p.name, model: p.model };
        }
        problem = parsed.error.issues
          .slice(0, 5)
          .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
          .join("; ");
      } catch (err) {
        problem = err instanceof Error ? err.message : String(err);
      }
      logCall.run(Date.now(), p.name, p.model, input.task, 0, Date.now() - t0, `invalid: ${problem}`.slice(0, 300), input.postId ?? null);
      attempts.push(`${p.name}: invalid output (${problem})`);
      prompt = `${input.prompt}\n\nYour previous reply was invalid: ${problem}\nReply again with ONLY one JSON object that follows the schema exactly.`;
    }
  }
  throw new LlmUnavailableError(attempts);
}

/** For /api/health. */
export function llmStatus() {
  const now = Date.now();
  return {
    providers: config.llm.order
      .map((n) => ALL_PROVIDERS[n])
      .filter(Boolean)
      .map((p) => ({
        name: p.name,
        configured: p.configured(),
        model: p.model || null,
        coolingDownSec: Math.max(0, Math.ceil(((coolUntil.get(p.name) ?? 0) - now) / 1000)),
      })),
    ...llmUsage(),
  };
}
