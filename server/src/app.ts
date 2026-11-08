import express, { type NextFunction, type Request, type Response } from "express";
import "./db/index.js"; // opens the DB and runs migrations
import { healthRouter } from "./routes/health.js";
import { ingestRouter } from "./routes/ingest.js";
import { postsRouter } from "./routes/posts.js";
import { profileRouter } from "./routes/profile.js";

/**
 * Browsers attach an Origin header. Only the extension and pages on this machine may call the API,
 * so a random website open in another tab can't POST junk to localhost. (curl/scripts send no Origin.)
 */
export function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  if (origin.startsWith("chrome-extension://")) return true;
  try {
    const u = new URL(origin);
    return u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1");
  } catch {
    return false;
  }
}

export function createApp() {
  const app = express();
  app.disable("x-powered-by");

  app.use("/api", (req, res, next) => {
    if (isAllowedOrigin(req.headers.origin)) return next();
    res.status(403).json({ ok: false, error: `Origin not allowed: ${req.headers.origin}` });
  });
  app.use(express.json({ limit: "2mb" })); // post batches from the extension

  app.use("/api/health", healthRouter);
  app.use("/api/profile", profileRouter);
  app.use("/api/ingest", ingestRouter);
  app.use("/api/posts", postsRouter);

  // Unknown API route → JSON 404 (not Express's HTML page)
  app.use("/api", (req, res) => {
    res.status(404).json({ ok: false, error: `No route: ${req.method} ${req.originalUrl}` });
  });

  // Central error handler → always JSON
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status = (err as { status?: number }).status ?? 500;
    if (status >= 500) console.error("[api] error:", err);
    res.status(status).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  });

  return app;
}
