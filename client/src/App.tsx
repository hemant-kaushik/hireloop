import { useEffect, useState } from "react";
import { HealthCard } from "./components/HealthCard";
import { PostsPage } from "./components/PostsPage";
import { ProfileCard } from "./components/ProfileCard";
import { useHealth } from "./lib/useHealth";

type View = "posts" | "setup";
const viewFromHash = (): View => (location.hash === "#/setup" ? "setup" : "posts");

export function App() {
  const health = useHealth();
  const [view, setView] = useState<View>(viewFromHash);

  useEffect(() => {
    const onHash = () => setView(viewFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const online = health.kind === "online";
  const offline = health.kind === "offline";
  const profile = online ? (health.health.profile ?? null) : null;
  const setupNeeded = offline || (profile !== null && !profile.ready);

  return (
    <div className="app">
      <header className="topbar">
        <h1>HireLoop</h1>
        <nav className="nav">
          <a href="#/posts" className={view === "posts" ? "active" : ""}>
            Posts
          </a>
          <a href="#/setup" className={view === "setup" ? "active" : ""}>
            Setup {setupNeeded && <span className="dot bad inline" aria-label="needs attention" />}
          </a>
        </nav>
      </header>

      {view === "setup" ? (
        <main className="main">
          <HealthCard state={health} />
          {health.kind !== "loading" && <ProfileCard profile={profile} />}
        </main>
      ) : (
        <>
          {setupNeeded && (
            <div className="banner small">
              {health.kind === "offline" ? "The API is offline. " : "Your profile isn't set up yet. "}
              <a href="#/setup">Open Setup</a>
            </div>
          )}
          <PostsPage />
        </>
      )}
    </div>
  );
}
