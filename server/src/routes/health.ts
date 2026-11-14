import { Router } from "express";
import { dbHealth } from "../db/index.js";
import { checkProfile } from "../lib/profile.js";
import { llmStatus } from "../llm/gateway.js";

const startedAt = Date.now();

export const healthRouter = Router();

healthRouter.get("/", (_req, res) => {
  const db = dbHealth();
  // `ok` covers API + DB only. An unfinished profile is a setup step, not an outage.
  res.status(db.ok ? 200 : 503).json({
    ok: db.ok,
    app: "hireloop",
    version: process.env.npm_package_version ?? "0.1.0",
    node: process.version,
    uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    db,
    profile: checkProfile(),
    llm: llmStatus(),
  });
});
