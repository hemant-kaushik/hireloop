import { db } from "../db/index.js";

export type EventRow = { id: number; at: number; post_id: number | null; type: string; data: unknown };

const insert = db.prepare("INSERT INTO events (at, post_id, type, data) VALUES (?, ?, ?, ?)");

/** Every pipeline decision goes through here (CLAUDE.md rule). */
export function logEvent(postId: number | null, type: string, data?: Record<string, unknown>): void {
  insert.run(Date.now(), postId, type, data === undefined ? null : JSON.stringify(data));
}

export function eventsForPost(postId: number): EventRow[] {
  const rows = db.prepare("SELECT id, at, post_id, type, data FROM events WHERE post_id = ? ORDER BY id").all(postId) as {
    id: number;
    at: number;
    post_id: number | null;
    type: string;
    data: string | null;
  }[];
  return rows.map((r) => ({ ...r, data: r.data ? JSON.parse(r.data) : null }));
}
