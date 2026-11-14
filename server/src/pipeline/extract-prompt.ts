// Stage 2 prompt + schema (no DB/LLM imports, so scripts can use it without opening the DB).
// Privacy: only the post text is sent, with emails and phone numbers masked. No author, no profile.

import { z } from "zod";

const MAX_CHARS = 6000;

// Lenient field parsers: models return "" / "N/A" / "3" for null / number.
const nullish = (v: unknown) => (v === undefined || v === "" || (typeof v === "string" && /^(n\/?a|none|null|not (mentioned|specified|stated))$/i.test(v.trim())) ? null : v);
const str = (max: number) => z.preprocess(nullish, z.string().trim().max(max).nullable()).catch(null);
const yrs = z
  .preprocess((v) => {
    const n = nullish(v);
    if (typeof n === "string" && /^\d+(\.\d+)?$/.test(n.trim())) return Number(n);
    return n;
  }, z.number().min(0).max(40).nullable())
  .catch(null);
const list = (maxItems: number) =>
  z.preprocess((v) => (v == null ? [] : v), z.array(z.string().trim().min(1).max(80)).transform((a) => [...new Set(a)].slice(0, maxItems)));
const oneOf = <T extends string>(values: readonly T[]) =>
  z
    .preprocess((v) => (typeof v === "string" ? v.trim().toLowerCase().replace(/[\s_]+/g, "-") : nullish(v)), z.enum(values as [T, ...T[]]).nullable())
    .catch(null);

export const ExtractionSchema = z.object({
  is_job_post: z.boolean(),
  is_job_seeker: z.boolean().default(false),
  title: str(150),
  other_titles: list(10),
  company: str(150),
  exp_min: yrs,
  exp_max: yrs,
  location: str(200),
  work_mode: oneOf(["onsite", "hybrid", "remote"] as const),
  employment_type: oneOf(["full-time", "contract", "internship", "part-time", "freelance"] as const),
  tech_stack: list(15),
  apply_url: str(500),
  summary: str(600),
});
export type Extraction = z.infer<typeof ExtractionSchema>;

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// 10–15 digits with at most one separator between digits (space, dash, dot, or ")"),
// so "…6789. 2-4 yrs" stops at the number and doesn't swallow the next sentence.
const PHONE_RE = /(?<![\w+])\+?\(?\d(?:(?:\)\s?|[\s.-])?\d){9,14}(?![\w])/g;

/** What the LLM sees: emails → [EMAIL], phones → [PHONE]. */
export function maskContacts(text: string): string {
  return text.replace(EMAIL_RE, "[EMAIL]").replace(PHONE_RE, "[PHONE]");
}

export const SYSTEM_PROMPT = `You extract structured data from one LinkedIn post for a software developer in India who is looking for a job.
Reply with ONE JSON object and nothing else. Use only facts written in the post; never guess or invent. Use null when something isn't stated.
Emails and phone numbers in the post are replaced by [EMAIL] and [PHONE].`;

export function buildExtractPrompt(text: string): string {
  return `POST:
"""
${maskContacts(text).slice(0, MAX_CHARS)}
"""

Return this JSON object:
{
  "is_job_post": true/false — true only if the author or their company is hiring for at least one role (including recruiters posting openings),
  "is_job_seeker": true/false — true if the author is looking for a job themselves (#OpenToWork, "looking for opportunities"); then is_job_post is false,
  "title": the role most relevant to a software/web developer, or the main role if none is; null if no role,
  "other_titles": other roles listed in the same post (multi-role posts), [] if none,
  "company": hiring company name or null,
  "exp_min": minimum years of experience as a number ("3-5 yrs" → 3, "3+ yrs" → 3, "fresher"/"0-1" → 0) or null,
  "exp_max": maximum years ("3-5 yrs" → 5, "3+ yrs" → null, "fresher" → 1) or null,
  "location": job location(s) as written, e.g. "Noida" or "Bangalore, Pune" or "PAN India"; null if not stated,
  "work_mode": "onsite" | "hybrid" | "remote" | null,
  "employment_type": "full-time" | "contract" | "internship" | "part-time" | "freelance" | null,
  "tech_stack": up to 12 technology names required (e.g. "React", "Node.js", "PostgreSQL"); no soft skills; [] if none,
  "apply_url": an http(s) link from the post for applying, copied exactly, or null,
  "summary": at most 2 short sentences: the role, key requirements and anything notable
}`;
}

/** Keeps apply_url only if it literally appears in the post text (same rule as emails). */
export function sanitizeExtraction(e: Extraction, text: string): Extraction {
  let url = e.apply_url;
  if (url) {
    const clean = url.replace(/[).,;]+$/, "");
    url = /^https?:\/\//i.test(clean) && text.includes(clean) ? clean : null;
  }
  return { ...e, apply_url: url, is_job_post: e.is_job_post && !e.is_job_seeker };
}

