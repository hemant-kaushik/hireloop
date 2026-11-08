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

function resolveFromRoot(p: string): string {
  return path.isAbsolute(p) ? p : path.join(ROOT_DIR, p);
}

export const config = {
  port: Number(process.env.PORT ?? 3001),
  dbPath: resolveFromRoot(process.env.DB_PATH ?? "data/hireloop.db"),
  profileDir: path.join(ROOT_DIR, "profile"),
  envFileLoaded: existsSync(envFile),
} as const;
