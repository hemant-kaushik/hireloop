// LLM providers. Each one turns (system, prompt) into raw JSON text, and maps HTTP failures to a
// ProviderError kind the gateway can act on. Plain fetch, no SDKs.

import { config } from "../config.js";

export type ErrorKind = "rate_limit" | "no_credits" | "server" | "network" | "auth" | "config" | "bad_response";

export class ProviderError extends Error {
  constructor(
    readonly kind: ErrorKind,
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}

export type CallInput = { system: string; prompt: string };

export interface Provider {
  name: string;
  model: string;
  rpm: number;
  configured(): boolean;
  call(input: CallInput): Promise<string>;
  /** Model ids this key can use (for `llm:check`). */
  listModels(): Promise<string[]>;
}

/** Seconds from a Retry-After header, or Gemini's RetryInfo "retryDelay": "30s". */
function retryAfter(res: Response, body: string): number | undefined {
  const h = Number(res.headers.get("retry-after"));
  if (Number.isFinite(h) && h > 0) return h * 1000;
  const m = body.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
  return m ? Number(m[1]) * 1000 : undefined;
}

async function request(name: string, url: string, init: RequestInit): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(config.llm.timeoutMs) });
  } catch (err) {
    const timeout = err instanceof Error && err.name === "TimeoutError";
    throw new ProviderError("network", `${name}: ${timeout ? "timeout" : "network error"}`);
  }
  const text = await res.text();
  if (res.ok) {
    try {
      return JSON.parse(text);
    } catch {
      throw new ProviderError("bad_response", `${name}: response is not JSON`);
    }
  }
  const short = text.replace(/\s+/g, " ").slice(0, 200);
  // 429 can mean "out of credits/quota" (won't recover by waiting a minute) or a real rate limit.
  if (res.status === 429 && /insufficient_quota|credit_balance|no credits|billing/i.test(text)) {
    throw new ProviderError("no_credits", `${name}: no credits/quota left on this account (add billing, or remove the key) ${short}`);
  }
  if (res.status === 429) throw new ProviderError("rate_limit", `${name}: rate limited (429) ${short}`, retryAfter(res, text));
  if (res.status === 401 || res.status === 403) throw new ProviderError("auth", `${name}: key rejected (${res.status}) ${short}`);
  if (res.status === 404 || res.status === 400) throw new ProviderError("config", `${name}: ${res.status} ${short}`);
  throw new ProviderError("server", `${name}: HTTP ${res.status} ${short}`);
}

export const gemini: Provider = {
  name: "gemini",
  get model() {
    return config.llm.gemini.model;
  },
  get rpm() {
    return config.llm.gemini.rpm;
  },
  configured: () => !!config.llm.gemini.apiKey,
  async call({ system, prompt }) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.llm.gemini.model)}:generateContent`;
    const data = (await request("gemini", url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": config.llm.gemini.apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, responseMimeType: "application/json" },
      }),
    })) as { candidates?: { content?: { parts?: { text?: string }[] } }[]; promptFeedback?: { blockReason?: string } };
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("");
    if (!text) throw new ProviderError("bad_response", `gemini: empty reply${data.promptFeedback?.blockReason ? ` (blocked: ${data.promptFeedback.blockReason})` : ""}`);
    return text;
  },
  async listModels() {
    const data = (await request("gemini", "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000", {
      headers: { "x-goog-api-key": config.llm.gemini.apiKey },
    })) as { models?: { name: string; supportedGenerationMethods?: string[] }[] };
    return (data.models ?? [])
      .filter((m) => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes("generateContent"))
      .map((m) => m.name.replace(/^models\//, ""));
  },
};

export const groq: Provider = {
  name: "groq",
  get model() {
    return config.llm.groq.model;
  },
  get rpm() {
    return config.llm.groq.rpm;
  },
  configured: () => !!config.llm.groq.apiKey,
  async call({ system, prompt }) {
    const data = (await request("groq", "https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.llm.groq.apiKey}` },
      body: JSON.stringify({
        model: config.llm.groq.model,
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
      }),
    })) as { choices?: { message?: { content?: string } }[] };
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new ProviderError("bad_response", "groq: empty reply");
    return text;
  },
  async listModels() {
    const data = (await request("groq", "https://api.groq.com/openai/v1/models", {
      headers: { Authorization: `Bearer ${config.llm.groq.apiKey}` },
    })) as { data?: { id: string }[] };
    return (data.data ?? []).map((m) => m.id);
  },
};

/** OpenAI (paid API). Chat Completions + JSON mode. No temperature: some newer models accept only the default. */
export const openai: Provider = {
  name: "openai",
  get model() {
    return config.llm.openai.model;
  },
  get rpm() {
    return config.llm.openai.rpm;
  },
  configured: () => !!config.llm.openai.apiKey,
  async call({ system, prompt }) {
    const data = (await request("openai", "https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.llm.openai.apiKey}` },
      body: JSON.stringify({
        model: config.llm.openai.model,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
      }),
    })) as { choices?: { message?: { content?: string } }[] };
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new ProviderError("bad_response", "openai: empty reply");
    return text;
  },
  async listModels() {
    const data = (await request("openai", "https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${config.llm.openai.apiKey}` },
    })) as { data?: { id: string }[] };
    return (data.data ?? []).map((m) => m.id);
  },
};

export const ollama: Provider = {
  name: "ollama",
  get model() {
    return config.llm.ollama.model;
  },
  get rpm() {
    return config.llm.ollama.rpm;
  },
  configured: () => !!config.llm.ollama.model,
  async call({ system, prompt }) {
    const data = (await request("ollama", `${config.llm.ollama.url}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.llm.ollama.model,
        stream: false,
        format: "json",
        options: { temperature: 0.1 },
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
      }),
    })) as { message?: { content?: string } };
    const text = data.message?.content;
    if (!text) throw new ProviderError("bad_response", "ollama: empty reply");
    return text;
  },
  async listModels() {
    const data = (await request("ollama", `${config.llm.ollama.url}/api/tags`, {})) as { models?: { name: string }[] };
    return (data.models ?? []).map((m) => m.name);
  },
};

export const ALL_PROVIDERS: Record<string, Provider> = { gemini, groq, openai, ollama };
