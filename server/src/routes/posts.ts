import { Router } from "express";
import { db } from "../db/index.js";
import { eventsForPost } from "../lib/events.js";

type PostRow = Record<string, unknown> & { emails: string };

const COLUMNS = `id, urn, author, author_headline, author_url, text, url, emails, posted_label, page_url,
                 parse_quality, status, reject_reason, seen_at, job_url, source`;

const toApi = (r: PostRow) => ({ ...r, emails: JSON.parse(r.emails) as string[] });

type JobRow = Record<string, unknown> & { post_id: number };
const JSON_COLS = ["other_titles", "tech_stack", "emails", "match_reasons", "filter_reasons"];

/** Extracted job rows (Phase 2) for these posts, JSON columns parsed. */
function jobsFor(ids: number[]): Map<number, Record<string, unknown>> {
  if (!ids.length) return new Map();
  const rows = db.prepare(`SELECT * FROM jobs WHERE post_id IN (${ids.map(() => "?").join(",")})`).all(...ids) as JobRow[];
  return new Map(
    rows.map((j) => {
      const out: Record<string, unknown> = { ...j, is_job_post: !!j.is_job_post, is_job_seeker: !!j.is_job_seeker };
      for (const c of JSON_COLS) out[c] = JSON.parse(j[c] as string);
      return [j.post_id, out];
    }),
  );
}

export const postsRouter = Router();

/**
 * GET /api/posts?status=all|new|duplicate|…&q=text&limit=50&offset=0
 * status=all (default) means every post except duplicates.
 */
postsRouter.get("/", (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : "all";
  const search = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 200) : "";
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 500);
  const offset = Math.max(Number(req.query.offset) || 0, 0);

  const where: string[] = [];
  const params: (string | number)[] = [];
  if (status === "all") where.push("status != 'duplicate'");
  else {
    where.push("status = ?");
    params.push(status);
  }
  if (search) {
    where.push("(text LIKE ? ESCAPE '\\' OR author LIKE ? ESCAPE '\\' OR author_headline LIKE ? ESCAPE '\\')");
    const like = `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    params.push(like, like, like);
  }
  const whereSql = `WHERE ${where.join(" AND ")}`;

  const rows = db
    .prepare(`SELECT ${COLUMNS} FROM posts ${whereSql} ORDER BY seen_at DESC, id DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as PostRow[];
  const { total } = db.prepare(`SELECT COUNT(*) AS total FROM posts ${whereSql}`).get(...params) as { total: number };
  const counts = Object.fromEntries(
    (db.prepare("SELECT status, COUNT(*) AS n FROM posts GROUP BY status").all() as { status: string; n: number }[]).map(
      (c) => [c.status, c.n],
    ),
  );

  const jobs = jobsFor(rows.map((r) => r.id as number));
  res.json({ ok: true, posts: rows.map((r) => ({ ...toApi(r), job: jobs.get(r.id as number) ?? null })), total, limit, offset, counts });
});

/** GET /api/posts/:id → the post with its full text and its event log. */
postsRouter.get("/:id", (req, res) => {
  const id = Number(req.params.id);
  const row = Number.isInteger(id) ? (db.prepare(`SELECT ${COLUMNS}, raw_text, text_hash FROM posts WHERE id = ?`).get(id) as PostRow | undefined) : undefined;
  if (!row) {
    res.status(404).json({ ok: false, error: "Post not found" });
    return;
  }
  res.json({ ok: true, post: { ...toApi(row), job: jobsFor([id]).get(id) ?? null }, events: eventsForPost(id) });
});
