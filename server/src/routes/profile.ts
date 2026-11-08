import { Router } from "express";
import { checkProfile } from "../lib/profile.js";

export const profileRouter = Router();

// Which profile files are set up, and how to fix the ones that aren't.
profileRouter.get("/status", (_req, res) => {
  res.json({ ok: true, ...checkProfile() });
});
