// Test sandbox: a throwaway DB and a DUMMY profile folder, set up before any app module is imported.
// Import this first, then import app modules dynamically (await import(...)).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export const sandbox = mkdtempSync(path.join(tmpdir(), "hireloop-test-"));
export const profileDir = path.join(sandbox, "profile");
mkdirSync(profileDir);

process.env.DB_PATH = path.join(sandbox, "test.db");
process.env.PROFILE_DIR = profileDir;
process.env.LLM_DAILY_BUDGET = "1000";

export const DUMMY_PROFILE = `# Test Candidate

## Summary
Full stack developer with two years of experience building Node.js and React applications with PostgreSQL and MongoDB, plus some LLM integration work. Looking for full stack or backend roles in Noida or remote.

## Skills
- Languages: JavaScript, TypeScript, Python
- Backend: Node.js, Express.js, REST APIs, Redis
- Frontend: React.js, Next.js, Tailwind CSS
- Databases: PostgreSQL, MongoDB

## Experience
- Software Engineer at Example Co (2024 – Present)
`;

export const DUMMY_PREFS = {
  roles: ["full stack", "backend", "node", "mern", "software engineer"],
  my_experience_years: 2,
  accept_exp_range: [1, 4] as [number, number],
  locations: ["noida", "gurgaon", "bangalore", "remote"],
  must_have_any: ["node", "react", "python"],
  avoid: ["unpaid", "sales"],
  block_authors: ["Ocean IT"],
  disable_rules: [] as string[],
};

export function writeProfile(prefs: Record<string, unknown> = DUMMY_PREFS): void {
  writeFileSync(path.join(profileDir, "profile.md"), DUMMY_PROFILE);
  writeFileSync(path.join(profileDir, "preferences.yaml"), JSON.stringify(prefs)); // JSON is valid YAML
  writeFileSync(path.join(profileDir, "resume.pdf"), "%PDF-1.4\n%%EOF\n");
}

export function cleanup(): void {
  rmSync(sandbox, { recursive: true, force: true });
}
