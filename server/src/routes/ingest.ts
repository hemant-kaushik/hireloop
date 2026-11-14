// POST /api/ingest — the extension delivers captured posts here. Accept fast, process later:
// this only stores and dedupes, it never calls an LLM.

import { Router } from "express";
import { db } from "../db/index.js";
import { logEvent } from "../lib/events.js";
import { cleanText, extractEmails, sha256, textHash } from "../lib/text.js";

export const MAX_BATCH = 100;
const MAX_TEXT = 20_000;
const KEY_RE = /^(urn:li:(activity|ugcPost|share):\d{5,25}|ck:[A-Za-z0-9_-]{16,128})$/;
const QUALITIES = new Set(["ok", "fallback", "raw", "truncated"]);
const SOURCES = new Set(["feed", "search", "profile", "other"]);

export type IncomingPost = {
  key?: unknown;
  author?: unknown;
  authorHeadline?: unknown;
  authorUrl?: unknown;
  text?: unknown;
  rawText?: unknown;
  url?: unknown;
  postedLabel?: unknown;
  pageUrl?: unknown;
  parseQuality?: unknown;
  jobUrl?: unknown;
  source?: unknown;
};

type CleanPost = {
  key: string;
  author: string | null;
  authorHeadline: string | null;
  authorUrl: string | null;
  text: string;
  rawText: string;
  url: string | null;
  postedLabel: string | null;
  pageUrl: string | null;
  parseQuality: string;
  jobUrl: string | null;
  source: string;
};

const str = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
};

/** Only LinkedIn https links are stored (they are rendered as links in the UI). */
export function linkedinUrl(v: unknown, opts: { keepQuery?: boolean } = {}): string | null {
  const s = str(v, 2000);
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== "https:" || !/(^|\.)linkedin\.com$/i.test(u.hostname)) return null;
    if (!opts.keepQuery) u.search = "";
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
}

/** Validates and normalizes one post. Returns a reason string if it can't be used. */
export function cleanPost(p: IncomingPost): CleanPost | string {
  if (!p || typeof p !== "object") return "not an object";
  const text = cleanText(str(p.text, MAX_TEXT) ?? "");
  const rawText = cleanText(str(p.rawText, MAX_TEXT) ?? "");
  const author = str(p.author, 200);
  if (!text && !rawText) return "no text";

  let key = str(p.key, 200);
  if (key && !KEY_RE.test(key)) return `bad key: ${key.slice(0, 40)}`;
  // No LinkedIn id at all: derive a stable one from author + text.
  if (!key) key = `tx:${sha256(`${(author ?? "").toLowerCase()}\n${textHash(text || rawText)}`).slice(0, 32)}`;

  const quality = typeof p.parseQuality === "string" && QUALITIES.has(p.parseQuality) ? p.parseQuality : "ok";
  const source = typeof p.source === "string" && SOURCES.has(p.source) ? p.source : "other";
  return {
    key,
    author,
    authorHeadline: str(p.authorHeadline, 300),
    authorUrl: linkedinUrl(p.authorUrl),
    text,
    rawText,
    url: linkedinUrl(p.url),
    postedLabel: str(p.postedLabel, 40),
    pageUrl: linkedinUrl(p.pageUrl),
    parseQuality: quality,
    jobUrl: linkedinUrl(p.jobUrl),
    source,
  };
}

type ExistingRow = { id: number; urn: string; author: string | null; text: string; raw_text: string; status: string; job_url: string | null };

const q = {
  byKey: db.prepare("SELECT id, urn, author, text, raw_text, status, job_url FROM posts WHERE urn = ?"),
  byHash: db.prepare(
    "SELECT id, urn, author, text, raw_text, status, job_url FROM posts WHERE text_hash = ? AND text_hash != ? ORDER BY id LIMIT 20",
  ),
  insert: db.prepare(`
    INSERT INTO posts (urn, text_hash, author, author_headline, author_url, text, raw_text, url, emails,
                       posted_label, page_url, parse_quality, status, reject_reason, seen_at, job_url, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  updateText: db.prepare(`
    UPDATE posts SET text = ?, raw_text = ?, text_hash = ?, emails = ?, parse_quality = ?, job_url = COALESCE(job_url, ?)
    WHERE id = ?`),
  setKey: db.prepare("UPDATE posts SET urn = ? WHERE id = ?"),
  // Fill fields an older parser version missed (e.g. headline/time before 005).
  fillMeta: db.prepare(`
    UPDATE posts SET author_headline = COALESCE(author_headline, ?), posted_label = COALESCE(posted_label, ?),
                     author_url = COALESCE(author_url, ?), job_url = COALESCE(job_url, ?)
    WHERE id = ?`),
};

const EMPTY_HASH = textHash("");

export type IngestResult = { received: number; inserted: number; updated: number; duplicates: number; seen: number; invalid: number; errors: string[] };

/** Stores a batch in one transaction. Exported for tests. */
export function ingestPosts(posts: IncomingPost[]): IngestResult {
  const r: IngestResult = { received: posts.length, inserted: 0, updated: 0, duplicates: 0, seen: 0, invalid: 0, errors: [] };
  db.exec("BEGIN");
  try {
    for (const raw of posts) {
      const p = cleanPost(raw);
      if (typeof p === "string") {
        r.invalid++;
        if (r.errors.length < 10) r.errors.push(p);
        continue;
      }
      const body = p.text || p.rawText;
      const hash = textHash(body);
      const emails = JSON.stringify(extractEmails(body));

      // 1. Same key: already stored. Keep the longer text (the user may have expanded "…more").
      const existing = q.byKey.get(p.key) as ExistingRow | undefined;
      if (existing) {
        const oldBody = existing.text || existing.raw_text;
        if (body.length > oldBody.length && (existing.status === "new" || existing.status === "duplicate")) {
          q.updateText.run(p.text, p.rawText, hash, emails, p.parseQuality, p.jobUrl, existing.id);
          logEvent(existing.id, "ingest_updated", { oldLength: oldBody.length, newLength: body.length });
          r.updated++;
        } else {
          q.fillMeta.run(p.authorHeadline, p.postedLabel, p.authorUrl, p.jobUrl, existing.id);
          r.seen++;
        }
        continue;
      }

      // 2. Same text under another key.
      let status = "new";
      let rejectReason: string | null = null;
      const sameText = q.byHash.all(hash, EMPTY_HASH) as ExistingRow[];
      if (sameText.length) {
        const sameAuthor = sameText.find((s) => (s.author ?? "").toLowerCase() === (p.author ?? "").toLowerCase());
        if (sameAuthor) {
          // Same post, new key: don't store it twice. If the stored key was only derived from the
          // text (tx:) and LinkedIn's real key is known now, upgrade it, so later text growth
          // ("…more") matches by key instead of creating a second row.
          const upgrade = sameAuthor.urn.startsWith("tx:") && !p.key.startsWith("tx:");
          if (upgrade) q.setKey.run(p.key, sameAuthor.id);
          q.fillMeta.run(p.authorHeadline, p.postedLabel, p.authorUrl, p.jobUrl, sameAuthor.id);
          logEvent(sameAuthor.id, "ingest_rekey", upgrade ? { from: sameAuthor.urn, to: p.key } : { key: p.key });
          r.seen++;
          continue;
        }
        status = "duplicate";
        rejectReason = `same text as post #${sameText[0].id}`;
      }

      const res = q.insert.run(
        p.key, hash, p.author, p.authorHeadline, p.authorUrl, p.text, p.rawText, p.url, emails,
        p.postedLabel, p.pageUrl, p.parseQuality, status, rejectReason, Date.now(), p.jobUrl, p.source,
      );
      const id = Number(res.lastInsertRowid);
      if (status === "duplicate") {
        logEvent(id, "ingest_duplicate", { of: sameText[0].id });
        r.duplicates++;
      } else {
        logEvent(id, "ingest_inserted", { key: p.key, parseQuality: p.parseQuality, source: p.source });
        r.inserted++;
      }
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return r;
}

export const ingestRouter = Router();

ingestRouter.post("/", (req, res) => {
  const posts = (req.body as { posts?: unknown })?.posts;
  if (!Array.isArray(posts)) {
    res.status(400).json({ ok: false, error: "Body must be { posts: [...] }" });
    return;
  }
  if (posts.length > MAX_BATCH) {
    res.status(413).json({ ok: false, error: `At most ${MAX_BATCH} posts per request` });
    return;
  }
  const result = ingestPosts(posts as IncomingPost[]);
  if (result.inserted || result.updated || result.duplicates || result.invalid) {
    console.log(
      `[ingest] ${result.received} received · ${result.inserted} new · ${result.updated} updated · ${result.duplicates} dup · ${result.seen} seen · ${result.invalid} invalid`,
    );
  }
  res.json({ ok: true, ...result });
});
