import type { FileState, FileStatus, ProfileStatus } from "../lib/api";

const LABELS: Record<keyof ProfileStatus["files"], { name: string; purpose: string }> = {
  profile: { name: "Profile", purpose: "who you are, used to write drafts" },
  preferences: { name: "Preferences", purpose: "which posts to keep and sending limits" },
  resume: { name: "Resume", purpose: "attached to every email" },
};

const STATE_TEXT: Record<FileState, string> = {
  ok: "ready",
  missing: "missing",
  template: "not filled in",
  invalid: "needs fixing",
};

const dotClass = (s: FileState) => (s === "ok" ? "ok" : s === "template" ? "warn" : "bad");

// A fix that starts with "cp " is a shell command, so show it as copyable code.
function Fix({ fix }: { fix: string }) {
  return fix.startsWith("cp ") ? <code className="cmd">{fix}</code> : <span>{fix}</span>;
}

function FileRow({ id, file }: { id: keyof ProfileStatus["files"]; file: FileStatus }) {
  const { name, purpose } = LABELS[id];
  return (
    <li className="file-row">
      <span className={`dot ${dotClass(file.state)}`} aria-hidden />
      <div className="file-body">
        <div>
          <span className="label">{name}</span> <span className="muted small">({purpose})</span>
        </div>
        <div className="small">
          <span className="mono">{file.path}</span> · <span className={`state-${dotClass(file.state)}`}>{STATE_TEXT[file.state]}</span>
          {file.reason && <span className="muted">. {file.reason}</span>}
        </div>
        {file.fix && file.state !== "ok" && (
          <div className="small fix">
            Fix: <Fix fix={file.fix} />
          </div>
        )}
        {file.warnings?.map((w) => (
          <div key={w} className="small state-warn">
            ⚠ {w}
          </div>
        ))}
      </div>
    </li>
  );
}

export function ProfileCard({ profile }: { profile: ProfileStatus | null }) {
  return (
    <section className="card">
      <div className="card-head">
        <h2>Profile setup</h2>
        {profile && (
          <span className={`small ${profile.ready ? "state-ok" : "state-warn"}`}>
            {profile.ready ? "✓ Profile ready" : "Not ready yet"}
          </span>
        )}
      </div>
      {!profile ? (
        <p className="muted">Unknown while the API is offline.</p>
      ) : (
        <>
          <ul className="files">
            {(Object.keys(LABELS) as (keyof ProfileStatus["files"])[]).map((id) => (
              <FileRow key={id} id={id} file={profile.files[id]} />
            ))}
          </ul>
          {!profile.ready && (
            <p className="muted small">
              Edit the files in the <span className="mono">profile/</span> folder. This card updates within a few seconds,
              no restart needed.
            </p>
          )}
        </>
      )}
    </section>
  );
}
