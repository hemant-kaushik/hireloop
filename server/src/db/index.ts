import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "../config.js";
import { MIGRATIONS } from "./migrations.js";

mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const db = new DatabaseSync(config.dbPath);
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");
db.exec("PRAGMA busy_timeout = 5000;");

export function schemaVersion(): number {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
  return row.user_version;
}

function migrate(): void {
  const current = schemaVersion();
  if (current > MIGRATIONS.length) {
    throw new Error(
      `Database schema v${current} is newer than this code (v${MIGRATIONS.length}). Update the code or use a different DB_PATH.`,
    );
  }
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec("BEGIN");
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec("COMMIT");
      console.log(`[db] migrated to v${v + 1}`);
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
}

migrate();

export function dbHealth(): { ok: boolean; schemaVersion: number; path: string; error?: string } {
  try {
    db.prepare("SELECT 1").get();
    return { ok: true, schemaVersion: schemaVersion(), path: config.dbPath };
  } catch (err) {
    return { ok: false, schemaVersion: -1, path: config.dbPath, error: String(err) };
  }
}
