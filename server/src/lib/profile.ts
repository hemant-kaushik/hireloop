// Reads and validates the user's profile files (profile/). Read fresh on every
// call, with no cache: the files are tiny, and edits should show up without a restart.

import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml, YAMLParseError } from "yaml";
import { config } from "../config.js";
import { RULE_IDS } from "../pipeline/prefilter.js";

export type FileState = "ok" | "missing" | "template" | "invalid";

export type FileStatus = {
  state: FileState;
  path: string; // relative to project root, for display
  reason?: string; // why it isn't ok
  fix?: string; // what to do about it
  warnings?: string[]; // ok, but worth knowing
};

export type ProfileStatus = {
  ready: boolean;
  files: { profile: FileStatus; preferences: FileStatus; resume: FileStatus };
};

export type Preferences = {
  roles: string[];
  my_experience_years: number;
  accept_exp_range: [number, number];
  locations: string[];
  must_have_any: string[];
  avoid: string[];
  block_authors: string[]; // optional; whole-word phrase match on the author name
  disable_rules: string[]; // optional; pre-filter rule ids to switch off
  send: {
    daily_cap: number;
    gap_seconds: [number, number];
    recontact_after_days: number;
    dry_run: boolean;
  };
};

export type Profile = { profileMd: string; preferences: Preferences; resumePath: string };

const MIN_PROFILE_CHARS = 200;
const MAX_RESUME_BYTES = 10 * 1024 * 1024;

const paths = {
  profile: path.join(config.profileDir, "profile.md"),
  profileExample: path.join(config.profileDir, "profile.example.md"),
  preferences: path.join(config.profileDir, "preferences.yaml"),
  resume: path.join(config.profileDir, "resume.pdf"),
};

const rel = (p: string) => `profile/${path.basename(p)}`;

// ---------- profile.md ----------

// Placeholders look like <Your Full Name>. Markdown autolinks (<https://…>,
// <me@x.com>) are real content, unless they are the template's own sample values.
const TEMPLATE_SAMPLES = ["your-handle", "you@example.com", "your-site.dev", "98xxxxxxxx"];

export function findPlaceholders(md: string): string[] {
  const noComments = md.replace(/<!--[\s\S]*?-->/g, "");
  const found: string[] = [];
  for (const m of noComments.matchAll(/<([^<>\n]{1,120})>/g)) {
    const inner = m[1].trim();
    const isAutolink = /^(https?:\/\/|mailto:)\S+$/i.test(inner) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inner);
    const isSample = TEMPLATE_SAMPLES.some((s) => inner.toLowerCase().includes(s));
    if (!isAutolink || isSample) found.push(m[0]);
  }
  return found;
}

function checkProfileMd(): FileStatus & { content?: string } {
  const base = { path: rel(paths.profile) };
  if (!existsSync(paths.profile)) {
    return { ...base, state: "missing", reason: "File not found.", fix: "cp profile/profile.example.md profile/profile.md" };
  }
  const content = readFileSync(paths.profile, "utf8");
  const example = existsSync(paths.profileExample) ? readFileSync(paths.profileExample, "utf8") : null;
  const editFix = "Open profile/profile.md and replace every <…> placeholder with your details.";

  if (example !== null && content.trim() === example.trim()) {
    return { ...base, state: "template", reason: "Still the unedited template.", fix: editFix };
  }
  const placeholders = findPlaceholders(content);
  if (placeholders.length > 0) {
    const shown = placeholders.slice(0, 3).join(", ");
    const more = placeholders.length > 3 ? ` and ${placeholders.length - 3} more` : "";
    return { ...base, state: "template", reason: `${placeholders.length} placeholder(s) left: ${shown}${more}.`, fix: editFix };
  }
  const visible = content.replace(/<!--[\s\S]*?-->/g, "").trim();
  if (visible.length < MIN_PROFILE_CHARS) {
    return {
      ...base,
      state: "invalid",
      reason: `Too short (${visible.length} characters). Drafts need real detail to work from.`,
      fix: "Add your summary, skills, experience and projects.",
    };
  }
  return { ...base, state: "ok", content };
}

// ---------- preferences.yaml ----------

type Issues = { errors: string[]; warnings: string[] };

function stringList(obj: Record<string, unknown>, key: string, issues: Issues, opts: { required?: boolean } = {}): string[] {
  const v = obj[key];
  if (v === undefined || v === null) {
    if (opts.required) issues.errors.push(`\`${key}\` is required (a list, e.g. [backend, node]).`);
    return [];
  }
  if (!Array.isArray(v)) {
    issues.errors.push(`\`${key}\` must be a list, e.g. [a, b].`);
    return [];
  }
  const out = v.map((x) => String(x).trim().toLowerCase()).filter(Boolean);
  if (opts.required && out.length === 0) issues.errors.push(`\`${key}\` must have at least one entry.`);
  return out;
}

function num(v: unknown, key: string, issues: Issues, opts: { def?: number; min?: number; max?: number; int?: boolean }): number {
  if (v === undefined || v === null) {
    if (opts.def !== undefined) return opts.def;
    issues.errors.push(`\`${key}\` is required (a number).`);
    return NaN;
  }
  if (typeof v !== "number" || !Number.isFinite(v)) {
    issues.errors.push(`\`${key}\` must be a number, got ${JSON.stringify(v)}.`);
    return NaN;
  }
  if (opts.int && !Number.isInteger(v)) issues.errors.push(`\`${key}\` must be a whole number.`);
  if (opts.min !== undefined && v < opts.min) issues.errors.push(`\`${key}\` must be ≥ ${opts.min}.`);
  if (opts.max !== undefined && v > opts.max) issues.errors.push(`\`${key}\` must be ≤ ${opts.max}.`);
  return v;
}

function range(v: unknown, key: string, issues: Issues, opts: { def?: [number, number]; min?: number }): [number, number] {
  if ((v === undefined || v === null) && opts.def) return opts.def;
  if (!Array.isArray(v) || v.length !== 2 || !v.every((x) => typeof x === "number" && Number.isFinite(x))) {
    issues.errors.push(`\`${key}\` must be two numbers [min, max].`);
    return [NaN, NaN];
  }
  const [lo, hi] = v as [number, number];
  if (lo > hi) issues.errors.push(`\`${key}\`: min (${lo}) is greater than max (${hi}).`);
  if (opts.min !== undefined && lo < opts.min) issues.errors.push(`\`${key}\`: min must be ≥ ${opts.min}.`);
  return [lo, hi];
}

const TOP_KEYS = ["roles", "my_experience_years", "accept_exp_range", "locations", "must_have_any", "avoid", "block_authors", "disable_rules", "send"];
const SEND_KEYS = ["daily_cap", "gap_seconds", "recontact_after_days", "dry_run"];

export function validatePreferences(raw: unknown): { prefs?: Preferences } & Issues {
  const issues: Issues = { errors: [], warnings: [] };
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    issues.errors.push("The file must be a YAML mapping (key: value lines).");
    return issues;
  }
  const obj = raw as Record<string, unknown>;
  for (const k of Object.keys(obj)) if (!TOP_KEYS.includes(k)) issues.warnings.push(`Unknown key \`${k}\` is ignored.`);

  const sendRaw = obj.send ?? {};
  if (typeof sendRaw !== "object" || Array.isArray(sendRaw)) issues.errors.push("`send` must be a mapping.");
  const send = (typeof sendRaw === "object" && !Array.isArray(sendRaw) ? sendRaw : {}) as Record<string, unknown>;
  for (const k of Object.keys(send)) if (!SEND_KEYS.includes(k)) issues.warnings.push(`Unknown key \`send.${k}\` is ignored.`);

  let dryRun = true; // safe default: never email HR unless explicitly turned off
  if (send.dry_run !== undefined && send.dry_run !== null) {
    if (typeof send.dry_run !== "boolean") issues.errors.push("`send.dry_run` must be true or false.");
    else dryRun = send.dry_run;
  }

  const prefs: Preferences = {
    roles: stringList(obj, "roles", issues, { required: true }),
    my_experience_years: num(obj.my_experience_years, "my_experience_years", issues, { min: 0, max: 60 }),
    accept_exp_range: range(obj.accept_exp_range, "accept_exp_range", issues, { min: 0 }),
    locations: stringList(obj, "locations", issues),
    must_have_any: stringList(obj, "must_have_any", issues),
    avoid: stringList(obj, "avoid", issues),
    block_authors: stringList(obj, "block_authors", issues),
    disable_rules: stringList(obj, "disable_rules", issues),
    send: {
      daily_cap: num(send.daily_cap, "send.daily_cap", issues, { def: 25, min: 1, max: 100, int: true }),
      gap_seconds: range(send.gap_seconds, "send.gap_seconds", issues, { def: [60, 120], min: 10 }),
      recontact_after_days: num(send.recontact_after_days, "send.recontact_after_days", issues, { def: 30, min: 0, int: true }),
      dry_run: dryRun,
    },
  };
  const badRules = prefs.disable_rules.filter((r) => !(RULE_IDS as readonly string[]).includes(r));
  if (badRules.length) issues.errors.push(`\`disable_rules\`: unknown rule(s) ${badRules.join(", ")}. Valid: ${RULE_IDS.join(", ")}.`);
  if (prefs.locations.length === 0) issues.warnings.push("`locations` is empty, so posts won't be filtered by location.");
  return issues.errors.length ? issues : { ...issues, prefs };
}

function checkPreferences(): FileStatus & { prefs?: Preferences } {
  const base = { path: rel(paths.preferences) };
  if (!existsSync(paths.preferences)) {
    return { ...base, state: "missing", reason: "File not found.", fix: "cp profile/preferences.example.yaml profile/preferences.yaml" };
  }
  let raw: unknown;
  try {
    raw = parseYaml(readFileSync(paths.preferences, "utf8"));
  } catch (err) {
    const where = err instanceof YAMLParseError && err.linePos ? ` (line ${err.linePos[0].line})` : "";
    const msg = err instanceof Error ? err.message.split("\n")[0] : String(err);
    return { ...base, state: "invalid", reason: `YAML syntax error${where}: ${msg}`, fix: "Fix the syntax in profile/preferences.yaml." };
  }
  const { prefs, errors, warnings } = validatePreferences(raw);
  const w = warnings.length ? { warnings } : {};
  if (!prefs) {
    return { ...base, ...w, state: "invalid", reason: errors.join(" "), fix: "Edit profile/preferences.yaml (see preferences.example.yaml)." };
  }
  if (!prefs.send.dry_run) (w.warnings ??= []).push("dry_run is off: approved emails go to real HR addresses.");
  return { ...base, ...w, state: "ok", prefs };
}

// ---------- resume.pdf ----------

function checkResume(): FileStatus {
  const base = { path: rel(paths.resume) };
  const fix = "Copy your resume to profile/resume.pdf";
  if (!existsSync(paths.resume)) return { ...base, state: "missing", reason: "File not found.", fix };
  const size = statSync(paths.resume).size;
  if (size === 0) return { ...base, state: "invalid", reason: "File is empty.", fix };
  if (size > MAX_RESUME_BYTES) {
    return { ...base, state: "invalid", reason: `Too large (${(size / 1048576).toFixed(1)} MB, max 10 MB).`, fix: "Export a smaller PDF." };
  }
  const head = readFileSync(paths.resume).subarray(0, 5).toString("latin1");
  if (head !== "%PDF-") return { ...base, state: "invalid", reason: "Not a PDF (the file doesn't start with %PDF-).", fix };
  const warnings = size > 2 * 1048576 ? [`Large file (${(size / 1048576).toFixed(1)} MB); under 2 MB is kinder to inboxes.`] : undefined;
  return { ...base, state: "ok", ...(warnings && { warnings }) };
}

// ---------- public API ----------

export function checkProfile(): ProfileStatus {
  const strip = <T extends FileStatus>({ state, path, reason, fix, warnings }: T): FileStatus => ({
    state,
    path,
    ...(reason && { reason }),
    ...(fix && { fix }),
    ...(warnings && { warnings }),
  });
  const safe = (fn: () => FileStatus, p: string): FileStatus => {
    try {
      return strip(fn());
    } catch (err) {
      return { state: "invalid", path: rel(p), reason: `Could not read: ${err instanceof Error ? err.message : String(err)}` };
    }
  };
  const files = {
    profile: safe(checkProfileMd, paths.profile),
    preferences: safe(checkPreferences, paths.preferences),
    resume: safe(checkResume, paths.resume),
  };
  return { ready: Object.values(files).every((f) => f.state === "ok"), files };
}

/** For pipeline stages (Phases 2–3). Throws with a readable message if anything isn't ok. */
export function loadProfile(): Profile {
  const p = checkProfileMd();
  const prefs = checkPreferences();
  const resume = checkResume();
  const bad = [p, prefs, resume].filter((f) => f.state !== "ok");
  if (bad.length) throw new Error(`Profile not ready: ${bad.map((f) => `${f.path} is ${f.state}${f.reason ? ` (${f.reason})` : ""}`).join("; ")}`);
  return { profileMd: p.content!, preferences: prefs.prefs!, resumePath: paths.resume };
}

/** Words from the "## Skills" section of profile.md, split on commas/slashes. Used locally for scoring; never sent anywhere. */
export function skillsFromProfile(md: string): string[] {
  const m = md.match(/^##\s*(?:technical\s+)?skills\b[^\n]*\n([\s\S]*?)(?=^##\s|(?![\s\S]))/im);
  if (!m) return [];
  const out = new Set<string>();
  for (const line of m[1].split("\n")) {
    const body = line.replace(/^\s*[-*]\s*/, "").replace(/^[^:]{1,40}:\s*/, ""); // drop "- Backend:" labels
    for (const part of body.split(/[,/;]|\band\b/)) {
      const t = part.replace(/\(.*?\)/g, "").trim().toLowerCase();
      if (t && t.length <= 40) out.add(t);
    }
  }
  return [...out];
}
