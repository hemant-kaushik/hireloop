import assert from "node:assert/strict";
import { test } from "node:test";
import { canonical, findTerms, hasPhrase, hasTerm } from "../src/lib/match.ts";
import { checkRules, prefilter } from "../src/pipeline/prefilter.ts";

// ---------- match.ts ----------
test("whole words only, case-insensitive (like the friend's \\b regexes)", () => {
  assert.ok(hasTerm("We need a SALES lead", "sales"));
  assert.ok(!hasTerm("Salesforce developer needed", "sales"));
  assert.ok(!hasTerm("international team", "intern"));
  assert.ok(hasTerm("Looking for an Intern!", "intern"));
});

test("aliases: one word covers its spellings", () => {
  for (const s of ["Node.js", "NodeJS", "node js", "node"]) assert.ok(hasTerm(`exp in ${s} required`, "node"), s);
  assert.ok(hasTerm("Location: Bengaluru", "bangalore"));
  assert.ok(hasTerm("Gurugram office", "gurgaon"));
  assert.ok(hasTerm("Full-Stack Engineer", "full stack"));
  assert.ok(hasTerm("Fullstack dev", "full stack"));
  assert.ok(hasTerm("WFH available", "remote"));
  assert.equal(canonical("NodeJS"), "node");
  assert.equal(canonical("Postgres"), "postgresql");
});

test("terms with symbols match without false hits", () => {
  assert.ok(hasTerm("Skills: C++, Go", "c++"));
  assert.ok(!hasTerm("Skills: C, Go", "c++"));
  assert.ok(hasTerm("ASP .NET Core", ".net"));
  assert.ok(!hasTerm("dotnetcore", ".net"));
  assert.ok(hasTerm("Next.js app router", "next.js"));
});

test("findTerms keeps list order; hasPhrase has no aliases", () => {
  assert.deepEqual(findTerms("React and Node.js", ["python", "node", "react"]), ["node", "react"]);
  assert.ok(hasPhrase("Ocean IT Tech", "Ocean IT"));
  assert.ok(!hasPhrase("Ocean Tech Service", "Ocean IT"));
});

// ---------- ported rules ----------
const hit = (t: string, off: string[] = []) => checkRules(t, new Set(off))?.rule ?? null;

test("f2f / walk-in", () => {
  assert.equal(hit("Walk-in interview for React developers this Saturday"), "f2f");
});

test("non-India location, with the friend's exceptions", () => {
  assert.equal(hit("Hiring Node developer in Dubai, apply now"), "non_india");
  assert.equal(hit("Hiring Java dev, H1B required, Texas"), "non_india");
  assert.equal(hit("Send CV to jobs@company.co.uk for the role"), "non_india");
  assert.equal(hit("Hiring Node dev for a London client, remote India friendly"), null);
  assert.equal(hit("Hiring: remote role, client in Singapore"), null); // single foreign hit in a remote post
  assert.equal(hit("US-based client, office in Noida, hiring React devs"), null);
});

test("local candidates only (unless the context is India)", () => {
  assert.equal(hit("Hiring React dev. Local candidates only from Pune."), "local_only");
  assert.equal(hit("Hiring React dev. Must be based in India."), null);
});

test("internship: rejected unless the post is also full-time; stipend/unpaid always", () => {
  assert.equal(hit("Hiring interns for our web team"), "internship");
  assert.equal(hit("Hiring full-time Node devs and one intern"), null);
  assert.equal(hit("Full-time role, stipend during training"), "internship");
});

test("job seeker: rejected unless the post also hires", () => {
  assert.equal(hit("#OpenToWork Actively seeking opportunities as a frontend dev"), "job_seeker");
  assert.equal(hit("We are hiring! Not for #OpenToWork folks only, everyone can apply"), null);
  // Recruiter / job-list posts that open with seeker wording (patterns from real posts, dummy text):
  assert.equal(hit("HIRING ALERT! Looking for your next IT opportunity? Open Positions: MERN Developer"), null);
  assert.equal(hit("React Job Openings this week. Looking for a new opportunity in Frontend? Acme – React Dev, Apply: https://x.example"), null);
  assert.equal(hit("We\u2019re hiring! Looking for a new role? Join us"), null); // curly apostrophe
});

test("low salary and staffing", () => {
  assert.equal(hit("Hiring Node developer, salary 4 LPA"), "low_salary");
  assert.equal(hit("Hiring Node developer, salary 12 LPA"), null);
  assert.equal(hit("Looking for empanelment with IT companies, hiring support"), "staffing");
});

test("disable_rules switches a rule off", () => {
  assert.equal(hit("Hiring Node developer, salary 4 LPA", ["low_salary"]), null);
});

// ---------- prefilter() ----------
const prefs = { block_authors: ["Ocean IT"], disable_rules: [] };

test("block_authors → blocked (whole-word phrase)", () => {
  const r = prefilter({ author: "Ocean IT HR Service", text: "We are hiring Node devs" }, prefs);
  assert.deepEqual(r.pass ? null : [r.status, r.rule], ["blocked", "block_authors"]);
  assert.ok(prefilter({ author: "Ocean Tech Service", text: "We are hiring Node devs" }, prefs).pass);
});

test("needs a hiring signal (an email address counts)", () => {
  const r = prefilter({ author: "A", text: "Had a great time at the conference today, thanks everyone" }, prefs);
  assert.ok(!r.pass && r.rule === "no_hiring_signal");
  assert.ok(prefilter({ author: "A", text: "Node + React folks, ping careers@example.com" }, prefs).pass);
  assert.ok(prefilter({ author: "A", text: "We're hiring a backend engineer, 2-4 yrs, Noida" }, prefs).pass);
});
