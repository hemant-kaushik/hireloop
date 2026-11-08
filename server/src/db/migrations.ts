// Versioned schema migrations. PRAGMA user_version stores how many have run.
// To change the schema: APPEND a new entry. Never edit one that has shipped.

export const MIGRATIONS: string[] = [
  // v1 — base tables for Phase 1 capture
  `
  CREATE TABLE posts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    urn             TEXT NOT NULL UNIQUE,          -- urn:li:activity:… (LinkedIn post id)
    text_hash       TEXT NOT NULL,                 -- hash of normalized text, catches reposts
    author          TEXT,
    author_headline TEXT,
    author_url      TEXT,
    text            TEXT NOT NULL DEFAULT '',      -- best-effort post body
    raw_text        TEXT NOT NULL DEFAULT '',      -- whole post innerText (fallback)
    url             TEXT,                          -- permalink
    emails          TEXT NOT NULL DEFAULT '[]',    -- JSON array, extracted server-side
    posted_label    TEXT,                          -- e.g. "2h", "1d" as shown on LinkedIn
    page_url        TEXT,                          -- page it was captured from
    parse_quality   TEXT NOT NULL DEFAULT 'ok',    -- ok | fallback | raw | truncated
    status          TEXT NOT NULL DEFAULT 'new',   -- see PLAN.md lifecycle
    reject_reason   TEXT,
    seen_at         INTEGER NOT NULL               -- epoch ms
  );
  CREATE INDEX idx_posts_status    ON posts(status);
  CREATE INDEX idx_posts_text_hash ON posts(text_hash);
  CREATE INDEX idx_posts_seen_at   ON posts(seen_at DESC);

  CREATE TABLE events (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    at       INTEGER NOT NULL,                     -- epoch ms
    post_id  INTEGER REFERENCES posts(id) ON DELETE CASCADE,
    type     TEXT NOT NULL,                        -- e.g. ingest_inserted, prefilter_reject
    data     TEXT                                  -- JSON
  );
  CREATE INDEX idx_events_post ON events(post_id);
  CREATE INDEX idx_events_at   ON events(at DESC);
  `,

  // v2 — capture details from the extension (004)
  `
  ALTER TABLE posts ADD COLUMN job_url TEXT;       -- LinkedIn job card link inside the post, if any
  ALTER TABLE posts ADD COLUMN source  TEXT;       -- feed | search | profile | other
  CREATE INDEX idx_posts_status_seen ON posts(status, seen_at DESC);
  `,
];
