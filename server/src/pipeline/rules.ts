// Stage 3: your preferences.yaml rules + score. Pure functions (no DB, no LLM), so
// "Re-apply rules" after editing preferences.yaml is instant and free.

import { canonical, findTerms, hasTerm } from "../lib/match.js";
import type { Preferences } from "../lib/profile.js";
import type { Extraction } from "./extract.js";

/** Score weights (sum 100). Not-stated fields get half of their weight. */
export const WEIGHTS = { stack: 50, role: 20, experience: 20, location: 10 } as const;

export type RulesInput = {
  text: string;
  extraction: Extraction;
  prefs: Pick<Preferences, "roles" | "my_experience_years" | "accept_exp_range" | "locations" | "must_have_any" | "avoid">;
  skills: string[]; // from profile.md "## Skills" (local only)
  emails: string[]; // from the server regex over the post text
};

export type RulesOutcome = {
  status: "not_job" | "filtered_out" | "matched" | "no_email";
  score: number | null;
  matchReasons: string[];
  filterReasons: string[];
};

const fmtRange = (a: number | null, b: number | null) =>
  a !== null && b !== null ? (a === b ? `${a} yrs` : `${a}–${b} yrs`) : a !== null ? `${a}+ yrs` : `up to ${b} yrs`;

const SPREAD_LOCATION = /\b(pan[- ]india|anywhere in india|multiple (locations|cities)|across india)\b/i;

export function applyRules({ text, extraction: e, prefs, skills, emails }: RulesInput): RulesOutcome {
  if (!e.is_job_post) {
    return {
      status: "not_job",
      score: null,
      matchReasons: [],
      filterReasons: [e.is_job_seeker ? "Author is looking for a job (not hiring)" : "Not a job post"],
    };
  }

  const filter: string[] = [];
  const reasons: string[] = [];
  let score = 0;
  const titles = [e.title, ...e.other_titles].filter(Boolean).join(" | ");

  // ---- avoid list ----
  const avoided = findTerms(`${titles}\n${text}`, prefs.avoid);
  if (avoided.length) filter.push(`Mentions ${avoided.map((a) => `"${a}"`).join(", ")} (avoid list)`);

  // ---- role ----
  const roleInTitle = findTerms(titles, prefs.roles);
  const roleInText = roleInTitle.length ? [] : findTerms(text, prefs.roles);
  if (roleInTitle.length) {
    score += WEIGHTS.role;
    reasons.push(`Role matches: ${roleInTitle.join(", ")}`);
  } else if (roleInText.length) {
    score += WEIGHTS.role / 2;
    reasons.push(`Role mentioned in text: ${roleInText.join(", ")}`);
  } else {
    filter.push(`Role ${e.title ? `"${e.title}"` : "(none stated)"} doesn't match your roles`);
  }

  // ---- experience ----
  const [accMin, accMax] = prefs.accept_exp_range;
  if (e.exp_min === null && e.exp_max === null) {
    score += WEIGHTS.experience / 2;
    reasons.push("Experience not stated");
  } else {
    const lo = e.exp_min ?? 0;
    const hi = e.exp_max ?? Infinity;
    const label = fmtRange(e.exp_min, e.exp_max);
    if (lo <= accMax && hi >= accMin) {
      const mine = prefs.my_experience_years;
      if (lo <= mine && mine <= hi) {
        score += WEIGHTS.experience;
        reasons.push(`Experience fits: ${label}`);
      } else {
        score += WEIGHTS.experience * 0.75;
        reasons.push(`Experience overlaps your range: ${label}`);
      }
    } else {
      filter.push(`Needs ${label}; you accept ${accMin}–${accMax} yrs`);
    }
  }

  // ---- location ----
  const loc = e.location ?? "";
  const remote = e.work_mode === "remote" || hasTerm(loc, "remote");
  const wantsRemote = prefs.locations.some((l) => canonical(l) === "remote");
  const cityPrefs = prefs.locations.filter((l) => canonical(l) !== "remote");
  const cityHits = findTerms(loc || text, cityPrefs);
  if (cityHits.length && (loc || !remote)) {
    score += WEIGHTS.location;
    reasons.push(`Location: ${cityHits.join(", ")}`);
  } else if (remote && wantsRemote) {
    score += WEIGHTS.location;
    reasons.push("Remote");
  } else if (!loc && !remote) {
    score += WEIGHTS.location / 2;
    reasons.push("Location not stated");
  } else if (SPREAD_LOCATION.test(loc)) {
    score += WEIGHTS.location / 2;
    reasons.push(`Location: ${loc}`);
  } else if (prefs.locations.length === 0) {
    score += WEIGHTS.location / 2;
  } else {
    filter.push(`Location "${loc || "remote"}" not in your locations`);
  }

  // ---- must-have ----
  if (prefs.must_have_any.length) {
    const found = findTerms(`${e.tech_stack.join(", ")}\n${titles}\n${text}`, prefs.must_have_any);
    if (!found.length) filter.push(`None of your must-have skills (${prefs.must_have_any.join(", ")})`);
  }

  // ---- stack overlap ----
  const mySkills = [...new Set([...prefs.must_have_any, ...skills])];
  if (e.tech_stack.length === 0) {
    score += WEIGHTS.stack / 2;
    reasons.push("Tech stack not stated");
  } else {
    const matched = e.tech_stack.filter((t) =>
      mySkills.some((k) => canonical(k) === canonical(t) || hasTerm(k, t) || hasTerm(t, k)),
    );
    score += WEIGHTS.stack * (matched.length / e.tech_stack.length);
    reasons.unshift(
      matched.length
        ? `Stack: ${matched.join(", ")} (${matched.length}/${e.tech_stack.length})`
        : `Stack: no overlap with your skills (0/${e.tech_stack.length})`,
    );
  }

  if (filter.length) return { status: "filtered_out", score: null, matchReasons: reasons, filterReasons: filter };
  return {
    status: emails.length ? "matched" : "no_email",
    score: Math.round(score),
    matchReasons: emails.length ? reasons : [...reasons, "No email in the post: apply manually"],
    filterReasons: [],
  };
}
