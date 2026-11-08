import { HealthCard } from "./components/HealthCard";

export function App() {
  return (
    <div className="app">
      <header className="topbar">
        <h1>HireLoop</h1>
        <span className="muted">LinkedIn posts → approved emails</span>
      </header>
      <main className="main">
        <HealthCard />
        <section className="card muted">
          <h2>Coming next</h2>
          <ol className="next">
            <li>Profile setup: your profile, preferences and resume</li>
            <li>Capture: the Chrome extension and the captured-posts list</li>
          </ol>
        </section>
      </main>
    </div>
  );
}
