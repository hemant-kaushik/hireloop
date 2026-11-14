import { useCallback, useEffect, useState } from "react";
import { processApi, type RunState } from "../lib/api";

/** Process (LLM) and Re-apply rules (no LLM) buttons, with live progress. */
export function ProcessBar({ pending, onChange }: { pending: number; onChange: () => void }) {
  const [state, setState] = useState<RunState | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const poll = useCallback(async () => {
    const r = await processApi.status().catch(() => null);
    if (r) setState(r.state);
    return r?.state ?? null;
  }, []);

  // While a run is going, poll every second; refresh the list when it ends.
  useEffect(() => {
    poll();
  }, [poll]);
  useEffect(() => {
    if (!state?.running) return;
    const id = setInterval(async () => {
      const s = await poll();
      onChange();
      if (s && !s.running) {
        const parts = Object.entries(s.counts).map(([k, v]) => `${v} ${k.replace(/_/g, " ")}`);
        setMessage(`Processed ${s.done}/${s.total}${parts.length ? `: ${parts.join(", ")}` : ""}.`);
        setError(s.stoppedReason ?? (s.counts.error ? `Some posts failed: ${s.lastError}` : null));
      }
    }, 1000);
    return () => clearInterval(id);
  }, [state?.running, poll, onChange]);

  const start = async () => {
    setError(null);
    setMessage(null);
    try {
      const r = await processApi.start();
      setState(r.state);
      if (r.state.total === 0) setMessage("Nothing to process.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const reapply = async () => {
    setError(null);
    try {
      const r = await processApi.reapply();
      const parts = Object.entries(r.counts).map(([k, v]) => `${v} ${k.replace(/_/g, " ")}`);
      setMessage(`Re-applied rules to ${r.total} posts (no LLM calls)${parts.length ? `: ${parts.join(", ")}` : ""}.`);
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const running = !!state?.running;
  return (
    <section className="card process">
      <div className="process-row">
        <button className="btn primary" onClick={start} disabled={running || pending === 0}>
          {running ? `Processing ${state!.done}/${state!.total}…` : `Process ${pending} post${pending === 1 ? "" : "s"}`}
        </button>
        <button className="btn" onClick={reapply} disabled={running} title="After editing preferences.yaml: re-check processed posts without calling the LLM">
          Re-apply rules
        </button>
        <span className="muted small">New and failed posts. The LLM is used only for posts that pass the free pre-filter.</span>
      </div>
      {running && (
        <div className="progress" aria-label="progress">
          <div style={{ width: `${state!.total ? (100 * state!.done) / state!.total : 0}%` }} />
        </div>
      )}
      {message && <div className="small">{message}</div>}
      {error && <div className="small state-bad">{error}</div>}
    </section>
  );
}
