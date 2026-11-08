import { useEffect, useState } from "react";
import { api, type Health } from "./api";

const POLL_MS = 5000;

export type HealthState =
  | { kind: "loading" }
  | { kind: "online"; health: Health; checkedAt: number }
  | { kind: "offline"; error: string; checkedAt: number };

/** Polls /api/health every 5 s. One poll shared by every card that needs it. */
export function useHealth(): HealthState {
  const [state, setState] = useState<HealthState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const health = await api.health();
        if (!cancelled) setState({ kind: "online", health, checkedAt: Date.now() });
      } catch (err) {
        if (!cancelled)
          setState({ kind: "offline", error: err instanceof Error ? err.message : String(err), checkedAt: Date.now() });
      }
    };
    check();
    const id = setInterval(check, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return state;
}
