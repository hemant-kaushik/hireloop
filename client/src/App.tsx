import { HealthCard } from "./components/HealthCard";
import { ProfileCard } from "./components/ProfileCard";
import { useHealth } from "./lib/useHealth";

export function App() {
  const health = useHealth();
  const profile = health.kind === "online" ? (health.health.profile ?? null) : null;

  return (
    <div className="app">
      <header className="topbar">
        <h1>HireLoop</h1>
        <span className="muted">LinkedIn posts → approved emails</span>
      </header>
      <main className="main">
        <HealthCard state={health} />
        {health.kind !== "loading" && <ProfileCard profile={profile} />}
        <section className="card muted">
          <h2>Coming next</h2>
          <ol className="next">
            <li>Capture: the Chrome extension and the captured-posts list</li>
          </ol>
        </section>
      </main>
    </div>
  );
}
