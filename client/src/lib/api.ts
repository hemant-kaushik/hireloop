// Typed wrappers around the Express API. All calls go to /api (proxied by Vite).

export type Health = {
  ok: boolean;
  app: string;
  version: string;
  node: string;
  uptimeSec: number;
  db: { ok: boolean; schemaVersion: number; path: string; error?: string };
};

async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { Accept: "application/json" } });
  const body = await res.json().catch(() => null);
  if (!res.ok && !body) throw new Error(`${res.status} ${res.statusText}`);
  return body as T;
}

export const api = {
  health: () => getJSON<Health>("/api/health"),
};
