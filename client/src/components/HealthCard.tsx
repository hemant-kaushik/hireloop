import type { HealthState } from "../lib/useHealth";

function formatUptime(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
}

export function HealthCard({ state }: { state: HealthState }) {
  if (state.kind === "loading") {
    return (
      <section className="card">
        <h2>System status</h2>
        <p className="muted">Checking the API…</p>
      </section>
    );
  }

  const apiUp = state.kind === "online";
  const h = apiUp ? state.health : null;

  return (
    <section className="card">
      <div className="card-head">
        <h2>System status</h2>
        <span className="muted small">checked {new Date(state.checkedAt).toLocaleTimeString()}</span>
      </div>
      <ul className="checks">
        <li>
          <span className={`dot ${apiUp ? "ok" : "bad"}`} aria-hidden />
          <span className="label">API server</span>
          <span className="value">
            {apiUp ? `online · up ${formatUptime(h!.uptimeSec)}` : "offline. Run npm run dev in the project folder."}
          </span>
        </li>
        <li>
          <span className={`dot ${h?.db.ok ? "ok" : apiUp ? "bad" : "idle"}`} aria-hidden />
          <span className="label">Database</span>
          <span className="value">
            {!h ? "unknown (API offline)" : h.db.ok ? `OK · schema v${h.db.schemaVersion}` : `error: ${h.db.error}`}
          </span>
        </li>
        {h && (
          <li>
            <span className="dot idle" aria-hidden />
            <span className="label">Runtime</span>
            <span className="value mono">
              Node {h.node} · v{h.version}
            </span>
          </li>
        )}
      </ul>
      {h && <p className="muted small mono path">{h.db.path}</p>}
    </section>
  );
}
