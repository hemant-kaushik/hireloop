import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// server/src/config.ts → project root is two levels up (works from dist/ too).
const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(here, "..", "..");
export const SERVER_DIR = path.join(ROOT_DIR, "server");

// Load server/.env if present, using Node's built-in loader (no dotenv).
const envFile = path.join(SERVER_DIR, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

function num(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

function resolveFromRoot(p: string): string {
  return path.isAbsolute(p) ? p : path.join(ROOT_DIR, p);
}

export const config = {
  port: Number(process.env.PORT ?? 3001),
  dbPath: resolveFromRoot(process.env.DB_PATH ?? "data/hireloop.db"),
  profileDir: resolveFromRoot(process.env.PROFILE_DIR ?? "profile"), // tests point this at dummy files
  envFileLoaded: existsSync(envFile),
  llm: {
    // Providers are tried in this order; one without a key/model is skipped.
    order: (process.env.LLM_ORDER ?? "gemini,groq,openai,ollama").split(",").map((s) => s.trim()).filter(Boolean),
    dailyBudget: num("LLM_DAILY_BUDGET", 300), // max LLM calls per day, all providers together
    timeoutMs: num("LLM_TIMEOUT_MS", 30_000),
    gemini: {
      apiKey: process.env.GEMINI_API_KEY ?? "",
      model: process.env.GEMINI_MODEL || "gemini-3.5-flash-lite", // 2.5-flash-lite is listed but refused for new keys (009)
      rpm: num("GEMINI_RPM", 10),
    },
    groq: {
      apiKey: process.env.GROQ_API_KEY ?? "",
      model: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
      rpm: num("GROQ_RPM", 20),
    },
    openai: {
      // Paid API (no free tier): last in the default order, used only when the free providers fail.
      apiKey: process.env.OPENAI_API_KEY ?? "",
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      rpm: num("OPENAI_RPM", 30),
    },
    ollama: {
      url: process.env.OLLAMA_URL || "http://127.0.0.1:11434",
      model: process.env.OLLAMA_MODEL ?? "", // empty = Ollama off
      rpm: num("OLLAMA_RPM", 60),
    },
  },
} as const;
