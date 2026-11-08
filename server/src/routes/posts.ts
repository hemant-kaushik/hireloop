import { Router } from "express";
import { db } from "../db/index.js";
import { eventsForPost } from "../lib/events.js";

type PostRow = Record<string, unknown> & { emails: string };

const COLUMNS = `id, urn, author, author_headline, author_url, text, url, emails, posted_label, page_url,
                 parse_quality, status, reject_reason, seen_at, job_url, source`;

const toApi = (r: PostRow) => ({ ...r, emails: JSON.parse(r.emails) as string[] });

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

  res.json({ ok: true, posts: rows.map(toApi), total, limit, offset, counts });
});

/** GET /api/posts/:id → the post with its full text and its event log. */
postsRouter.get("/:id", (req, res) => {
  const id = Number(req.params.id);
  const row = Number.isInteger(id) ? (db.prepare(`SELECT ${COLUMNS}, raw_text, text_hash FROM posts WHERE id = ?`).get(id) as PostRow | undefined) : undefined;
  if (!row) {
    res.status(404).json({ ok: false, error: "Post not found" });
    return;
  }
  res.json({ ok: true, post: toApi(row), events: eventsForPost(id) });
});
