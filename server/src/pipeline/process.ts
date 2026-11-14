// Runs posts through: pre-filter → LLM extract → rules + score. Started only by the user
// (Process button / POST /api/process). One run at a time; posts are processed one by one and
// the LLM rate limiter paces them. Every decision is logged to `events`.

import { db } from "../db/index.js";
import { logEvent } from "../lib/events.js";
import { loadProfile, skillsFromProfile, type Preferences } from "../lib/profile.js";
import { LlmBudgetError, LlmUnavailableError } from "../llm/gateway.js";
import { extractJob, type Extraction } from "./extract.js";
import { prefilter } from "./prefilter.js";
import { applyRules } from "./rules.js";

type PostRow = { id: number; author: string | null; text: string; raw_text: string; emails: string; status: string };
type JobRow = Record<string, unknown> & { other_titles: string; tech_stack: string; is_job_post: number; is_job_seeker: number };

export type RunState = {
  running: boolean;
  startedAt: number | null;
  finishedAt: number | null;
  total: number;
  done: number;
  counts: Record<string, number>;
  lastError: string | null;
  stoppedReason: string | null;
};

const state: RunState = { running: false, startedAt: null, finishedAt: null, total: 0, done: 0, counts: {}, lastError: null, stoppedReason: null };
export const runState = (): RunState => ({ ...state, counts: { ...state.counts } });

const q = {
  post: db.prepare("SELECT id, author, text, raw_text, emails, status FROM posts WHERE id = ?"),
  pending: db.prepare("SELECT id FROM posts WHERE status IN ('new', 'error') ORDER BY seen_at ASC, id ASC LIMIT ?"),
  processed: db.prepare(
    "SELECT id FROM posts WHERE status IN ('blocked','rejected_prefilter','not_job','filtered_out','matched','no_email') ORDER BY id",
  ),
  setStatus: db.prepare("UPDATE posts SET status = ?, reject_reason = ? WHERE id = ?"),
  job: db.prepare("SELECT * FROM jobs WHERE post_id = ?"),
  upsertJob: db.prepare(`
    INSERT INTO jobs (post_id, is_job_post, is_job_seeker, title, other_titles, company, exp_min, exp_max, location, work_mode,
                      employment_type, tech_stack, emails, apply_url, summary, score, match_reasons, filter_reasons, provider, model, extracted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, '[]', '[]', ?, ?, ?)
    ON CONFLICT(post_id) DO UPDATE SET
      is_job_post = excluded.is_job_post, is_job_seeker = excluded.is_job_seeker, title = excluded.title,
      other_titles = excluded.other_titles, company = excluded.company, exp_min = excluded.exp_min, exp_max = excluded.exp_max,
      location = excluded.location, work_mode = excluded.work_mode, employment_type = excluded.employment_type,
      tech_stack = excluded.tech_stack, emails = excluded.emails, apply_url = excluded.apply_url, summary = excluded.summary,
      provider = excluded.provider, model = excluded.model, extracted_at = excluded.extracted_at`),
  setScore: db.prepare("UPDATE jobs SET score = ?, match_reasons = ?, filter_reasons = ? WHERE post_id = ?"),
};

type Ctx = { prefs: Preferences; skills: string[] };

function loadCtx(): Ctx {
  const { preferences, profileMd } = loadProfile(); // throws a readable error if the profile isn't ready
  return { prefs: preferences, skills: skillsFromProfile(profileMd) };
}

const bodyOf = (p: PostRow) => p.text || p.raw_text;

function setStatus(id: number, status: string, reason: string | null, type: string, data: Record<string, unknown>) {
  q.setStatus.run(status, reason, id);
  logEvent(id, type, data);
}

function rowToExtraction(j: JobRow): Extraction {
  return {
    is_job_post: !!j.is_job_post,
    is_job_seeker: !!j.is_job_seeker,
    title: (j.title as string) ?? null,
    other_titles: JSON.parse(j.other_titles),
    company: (j.company as string) ?? null,
    exp_min: (j.exp_min as number) ?? null,
    exp_max: (j.exp_max as number) ?? null,
    location: (j.location as string) ?? null,
    work_mode: (j.work_mode as Extraction["work_mode"]) ?? null,
    employment_type: (j.employment_type as Extraction["employment_type"]) ?? null,
    tech_stack: JSON.parse(j.tech_stack),
    apply_url: (j.apply_url as string) ?? null,
    summary: (j.summary as string) ?? null,
  };
}

/** Stage 1. Returns true if the post continues to the LLM. */
function runPrefilter(post: PostRow, ctx: Ctx): boolean {
  const pre = prefilter({ author: post.author, text: bodyOf(post) }, ctx.prefs);
  if (pre.pass) return true;
  setStatus(post.id, pre.status, pre.reason, pre.status === "blocked" ? "blocked" : "prefilter_reject", { rule: pre.rule, reason: pre.reason });
  return false;
}

/** Stage 3 on a stored extraction. Returns the final status. */
function runRules(post: PostRow, extraction: Extraction, ctx: Ctx): string {
  const emails = JSON.parse(post.emails) as string[];
  const out = applyRules({ text: bodyOf(post), extraction, prefs: ctx.prefs, skills: ctx.skills, emails });
  q.setScore.run(out.score, JSON.stringify(out.matchReasons), JSON.stringify(out.filterReasons), post.id);
  const reason = out.filterReasons.length ? out.filterReasons.join("; ") : null;
  setStatus(post.id, out.status, reason, out.status, { score: out.score, reasons: out.status === "filtered_out" || out.status === "not_job" ? out.filterReasons : out.matchReasons });
  return out.status;
}

/** Full pipeline for one post. Throws LlmBudgetError (the run stops; the post stays as it was). */
export async function processPost(id: number, ctx: Ctx): Promise<string> {
  const post = q.post.get(id) as PostRow | undefined;
  if (!post) return "missing";
  if (!runPrefilter(post, ctx)) return (q.post.get(id) as PostRow).status;

  let res;
  try {
    res = await extractJob({ id, text: bodyOf(post) });
  } catch (err) {
    if (err instanceof LlmBudgetError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    setStatus(id, "error", msg.slice(0, 500), "llm_error", { error: msg.slice(0, 1000), unavailable: err instanceof LlmUnavailableError });
    state.lastError = msg.slice(0, 500);
    return "error";
  }
  const e = res.data;
  q.upsertJob.run(
    id, e.is_job_post ? 1 : 0, e.is_job_seeker ? 1 : 0, e.title, JSON.stringify(e.other_titles), e.company, e.exp_min, e.exp_max,
    e.location, e.work_mode, e.employment_type, JSON.stringify(e.tech_stack), post.emails, e.apply_url, e.summary,
    res.provider, res.model, Date.now(),
  );
  logEvent(id, "llm_extract", { provider: res.provider, model: res.model, is_job_post: e.is_job_post, title: e.title });
  return runRules(post, e, ctx);
}

/** Starts a background run over `new` + `error` posts. Throws if the profile isn't ready. */
export function startProcessing(limit = 500): RunState {
  if (state.running) return runState();
  const ctx = loadCtx();
  const ids = (q.pending.all(limit) as { id: number }[]).map((r) => r.id);
  Object.assign(state, { running: true, startedAt: Date.now(), finishedAt: null, total: ids.length, done: 0, counts: {}, lastError: null, stoppedReason: null });

  void (async () => {
    try {
      for (const id of ids) {
        try {
          const status = await processPost(id, ctx);
          state.counts[status] = (state.counts[status] ?? 0) + 1;
        } catch (err) {
          if (err instanceof LlmBudgetError) {
            state.stoppedReason = err.message;
            break;
          }
          state.lastError = err instanceof Error ? err.message : String(err);
          console.error("[process] post", id, err);
        }
        state.done++;
      }
    } finally {
      state.running = false;
      state.finishedAt = Date.now();
      console.log(`[process] done ${state.done}/${state.total}`, state.counts, state.stoppedReason ?? "");
    }
  })();
  return runState();
}

/** Re-runs the pre-filter and rules on processed posts, without the LLM. Synchronous. */
export function reapplyRules(): { total: number; counts: Record<string, number> } {
  const ctx = loadCtx();
  const counts: Record<string, number> = {};
  const ids = (q.processed.all() as { id: number }[]).map((r) => r.id);
  db.exec("BEGIN");
  try {
    for (const id of ids) {
      const post = q.post.get(id) as PostRow;
      let status: string;
      if (!runPrefilter(post, ctx)) status = (q.post.get(id) as PostRow).status;
      else {
        const job = q.job.get(id) as JobRow | undefined;
        if (job) status = runRules(post, rowToExtraction(job), ctx);
        else {
          status = "new"; // passes the gate now but was never extracted: needs Process
          setStatus(id, "new", null, "reapply_reset", { reason: "passes pre-filter now; needs extraction" });
        }
      }
      counts[status] = (counts[status] ?? 0) + 1;
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return { total: ids.length, counts };
}
