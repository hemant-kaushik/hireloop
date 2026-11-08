import { useCallback, useEffect, useState } from "react";
import { postsApi, type Post, type PostEvent, type PostList } from "../lib/api";

const POLL_MS = 5000;
const PAGE = 50;

// Phase 1 statuses; later phases add more (they show up automatically via counts).
const TABS: { id: string; label: string }[] = [
  { id: "all", label: "All" },
  { id: "new", label: "New" },
  { id: "duplicate", label: "Duplicates" },
];

function timeAgo(ms: number): string {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(ms).toLocaleDateString();
}

/** The new LinkedIn DOM has no permalinks: fall back to a content search for the opening words. */
function findOnLinkedIn(p: Post): string {
  if (p.url) return p.url;
  const words = p.text.replace(/[#@]\S+/g, "").split(/\s+/).filter(Boolean).slice(0, 10).join(" ");
  return `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(words)}`;
}

function PostCard({ post }: { post: Post }) {
  const [expanded, setExpanded] = useState(false);
  const [events, setEvents] = useState<PostEvent[] | null>(null);
  const long = post.text.length > 420;

  const toggleLog = async () => {
    if (events) return setEvents(null);
    const d = await postsApi.get(post.id).catch(() => null);
    setEvents(d?.events ?? []);
  };

  return (
    <article className="card post">
      <div className="post-head">
        <div className="post-author">
          {post.author_url ? (
            <a href={post.author_url} target="_blank" rel="noreferrer" className="label">
              {post.author ?? "Unknown author"}
            </a>
          ) : (
            <span className="label">{post.author ?? "Unknown author"}</span>
          )}
          {post.author_headline && <div className="muted small clamp1">{post.author_headline}</div>}
        </div>
        <div className="post-meta small muted">
          {post.posted_label && <span>{post.posted_label} on LinkedIn · </span>}
          <span title={new Date(post.seen_at).toLocaleString()}>captured {timeAgo(post.seen_at)}</span>
        </div>
      </div>

      <div className={`post-text ${expanded || !long ? "" : "collapsed"}`}>{post.text || <em className="muted">No text captured.</em>}</div>
      {long && (
        <button className="linkish small" onClick={() => setExpanded(!expanded)}>
          {expanded ? "Show less" : "Show more"}
        </button>
      )}

      <div className="post-foot small">
        <span className={`badge status-${post.status}`}>{post.status}</span>
        {post.parse_quality !== "ok" && (
          <span className="badge warn" title="How the text was read from the page">
            {post.parse_quality}
          </span>
        )}
        {post.source && <span className="badge">{post.source}</span>}
        {post.emails.map((e) => (
          <span key={e} className="badge email mono">
            {e}
          </span>
        ))}
        <span className="spacer" />
        {post.job_url && (
          <a href={post.job_url} target="_blank" rel="noreferrer">
            Job
          </a>
        )}
        <a href={findOnLinkedIn(post)} target="_blank" rel="noreferrer" title={post.url ? "Open the post" : "No permalink; searches LinkedIn for the post"}>
          {post.url ? "Open post" : "Find post"}
        </a>
        <button className="linkish" onClick={toggleLog}>
          {events ? "Hide log" : "Log"}
        </button>
      </div>
      {post.reject_reason && <div className="small muted">Reason: {post.reject_reason}</div>}
      {events && (
        <ul className="events small mono">
          {events.length === 0 && <li className="muted">No events.</li>}
          {events.map((ev) => (
            <li key={ev.id}>
              {new Date(ev.at).toLocaleTimeString()} {ev.type} {ev.data ? JSON.stringify(ev.data) : ""}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

export function PostsPage() {
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState(""); // debounced search
  const [limit, setLimit] = useState(PAGE);
  const [data, setData] = useState<PostList | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    try {
      const d = await postsApi.list({ status, q: query, limit });
      if (!d.ok) throw new Error("API error");
      setData(d);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [status, query, limit]);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  const counts = data?.counts ?? {};
  const allCount = Object.entries(counts).reduce((n, [s, c]) => (s === "duplicate" ? n : n + c), 0);
  const extraTabs = Object.keys(counts)
    .filter((s) => !TABS.some((t) => t.id === s))
    .map((s) => ({ id: s, label: s.replace(/_/g, " ") }));

  return (
    <div className="main">
      <div className="toolbar">
        <div className="tabs" role="tablist">
          {[...TABS, ...extraTabs].map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={status === t.id}
              className={`tab ${status === t.id ? "active" : ""}`}
              onClick={() => {
                setStatus(t.id);
                setLimit(PAGE);
              }}
            >
              {t.label} <span className="count">{t.id === "all" ? allCount : (counts[t.id] ?? 0)}</span>
            </button>
          ))}
        </div>
        <input
          className="search"
          type="search"
          placeholder="Search text, author, headline…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setLimit(PAGE);
          }}
        />
      </div>

      {error && <div className="card state-bad small">Could not load posts: {error}. Is the API running?</div>}

      {data && data.total === 0 && (
        <section className="card muted">
          {query || status !== "all" ? (
            <p>No posts match.</p>
          ) : (
            <>
              <h2>No posts captured yet</h2>
              <ol className="next">
                <li>
                  Load the extension: <span className="mono">chrome://extensions</span> → Developer mode → Load unpacked → pick
                  the <span className="mono">extension/</span> folder.
                </li>
                <li>Open LinkedIn (feed or a search for posts) and scroll as usual.</li>
                <li>Posts appear here within a few seconds.</li>
              </ol>
            </>
          )}
        </section>
      )}

      {data?.posts.map((p) => <PostCard key={p.id} post={p} />)}

      {data && data.total > data.posts.length && (
        <button className="more" onClick={() => setLimit(limit + PAGE)}>
          Show more ({data.total - data.posts.length} left)
        </button>
      )}
    </div>
  );
}
