// Typed wrappers around the Express API. All calls go to /api (proxied by Vite).

export type FileState = "ok" | "missing" | "template" | "invalid";

export type FileStatus = {
  state: FileState;
  path: string;
  reason?: string;
  fix?: string;
  warnings?: string[];
};

export type ProfileStatus = {
  ready: boolean;
  files: { profile: FileStatus; preferences: FileStatus; resume: FileStatus };
};

export type Health = {
  ok: boolean;
  app: string;
  version: string;
  node: string;
  uptimeSec: number;
  db: { ok: boolean; schemaVersion: number; path: string; error?: string };
  profile: ProfileStatus;
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

export type Post = {
  id: number;
  urn: string;
  author: string | null;
  author_headline: string | null;
  author_url: string | null;
  text: string;
  url: string | null;
  emails: string[];
  posted_label: string | null;
  page_url: string | null;
  parse_quality: "ok" | "fallback" | "raw" | "truncated";
  status: string;
  reject_reason: string | null;
  seen_at: number;
  job_url: string | null;
  source: string | null;
  job: Job | null;
};

export type PostList = {
  ok: boolean;
  posts: Post[];
  total: number;
  limit: number;
  offset: number;
  counts: Record<string, number>;
};

export type PostEvent = { id: number; at: number; type: string; data: Record<string, unknown> | null };

export const postsApi = {
  list: (params: { status?: string; q?: string; limit?: number; offset?: number }) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") qs.set(k, String(v));
    return getJSON<PostList>(`/api/posts?${qs}`);
  },
  get: (id: number) => getJSON<{ ok: boolean; post: Post & { raw_text: string }; events: PostEvent[] }>(`/api/posts/${id}`),
};

export type Job = {
  post_id: number;
  is_job_post: boolean;
  is_job_seeker: boolean;
  title: string | null;
  other_titles: string[];
  company: string | null;
  exp_min: number | null;
  exp_max: number | null;
  location: string | null;
  work_mode: string | null;
  employment_type: string | null;
  tech_stack: string[];
  emails: string[];
  apply_url: string | null;
  summary: string | null;
  score: number | null;
  match_reasons: string[];
  filter_reasons: string[];
  provider: string | null;
  model: string | null;
};

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

async function postJSON<T>(path: string, body: unknown = {}): Promise<T> {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data as { error?: string } | null)?.error ?? `${res.status} ${res.statusText}`);
  return data as T;
}

export const processApi = {
  status: () => getJSON<{ ok: boolean; state: RunState }>("/api/process/status"),
  start: () => postJSON<{ ok: boolean; state: RunState }>("/api/process"),
  reapply: () => postJSON<{ ok: boolean; total: number; counts: Record<string, number> }>("/api/process/reapply"),
};
