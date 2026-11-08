import express, { type NextFunction, type Request, type Response } from "express";
import { config } from "./config.js";
import "./db/index.js"; // opens the DB and runs migrations at startup
import { healthRouter } from "./routes/health.js";
import { profileRouter } from "./routes/profile.js";

const app = express();

app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" })); // post batches from the extension

app.use("/api/health", healthRouter);
app.use("/api/profile", profileRouter);

// Unknown API route → JSON 404 (not Express's HTML page)
app.use("/api", (req, res) => {
  res.status(404).json({ ok: false, error: `No route: ${req.method} ${req.originalUrl}` });
});

// Central error handler → always JSON
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[api] error:", err);
  const status = (err as { status?: number }).status ?? 500;
  res.status(status).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
});

app.listen(config.port, "127.0.0.1", () => {
  console.log(`[api] HireLoop API on http://localhost:${config.port}`);
  console.log(`[api] db: ${config.dbPath}${config.envFileLoaded ? "" : "  (no server/.env, using defaults)"}`);
});
