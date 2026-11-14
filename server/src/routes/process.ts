import { Router } from "express";
import { reapplyRules, runState, startProcessing } from "../pipeline/process.js";

export const processRouter = Router();

/** POST /api/process { limit? } — starts processing `new` + `error` posts in the background. */
processRouter.post("/", (req, res) => {
  if (runState().running) {
    res.status(409).json({ ok: false, error: "A run is already in progress", state: runState() });
    return;
  }
  const limit = Math.min(Math.max(Number((req.body as { limit?: unknown })?.limit) || 500, 1), 2000);
  try {
    res.status(202).json({ ok: true, state: startProcessing(limit) });
  } catch (err) {
    res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

/** POST /api/process/reapply — re-runs pre-filter + rules on processed posts, no LLM calls. */
processRouter.post("/reapply", (_req, res) => {
  if (runState().running) {
    res.status(409).json({ ok: false, error: "Wait for the current run to finish" });
    return;
  }
  try {
    res.json({ ok: true, ...reapplyRules() });
  } catch (err) {
    res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

processRouter.get("/status", (_req, res) => {
  res.json({ ok: true, state: runState() });
});
