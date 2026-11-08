# profile/

Your personal data. The real files are **gitignored**; only the templates and this README are committed.

| File | What it's for | Set up with |
|---|---|---|
| `profile.md` | Who you are. The LLM reads it to write email drafts and may only claim what's written here. | `cp profile/profile.example.md profile/profile.md`, then replace every `<…>` placeholder |
| `preferences.yaml` | Which posts to keep, and email sending limits | `cp profile/preferences.example.yaml profile/preferences.yaml`, then edit |
| `resume.pdf` | Attached to every email you approve | Copy your resume here, named `resume.pdf` (PDF, under 10 MB) |

The UI's **Profile setup** card (http://localhost:5173) and `GET /api/health` show which files are ready and what to fix. Edits are picked up within a few seconds, with no restart needed.
