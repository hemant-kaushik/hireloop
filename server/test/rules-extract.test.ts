import assert from "node:assert/strict";
import { test } from "node:test";
import { ExtractionSchema, maskContacts, sanitizeExtraction, type Extraction } from "../src/pipeline/extract.ts";
import { applyRules } from "../src/pipeline/rules.ts";
import { skillsFromProfile } from "../src/lib/profile.ts";
import { DUMMY_PREFS, DUMMY_PROFILE } from "./helpers.ts";

const base: Extraction = {
  is_job_post: true,
  is_job_seeker: false,
  title: "Node.js Developer",
  other_titles: [],
  company: "Acme",
  exp_min: 2,
  exp_max: 4,
  location: "Noida",
  work_mode: "onsite",
  employment_type: "full-time",
  tech_stack: ["Node.js", "React", "PostgreSQL", "AWS"],
  apply_url: null,
  summary: "Node dev",
};
const skills = skillsFromProfile(DUMMY_PROFILE);
const run = (e: Partial<Extraction>, text = "We are hiring", emails = ["jobs@acme.example"]) =>
  applyRules({ text, extraction: { ...base, ...e }, prefs: DUMMY_PREFS, skills, emails });

test("skills come from the profile's ## Skills section", () => {
  for (const s of ["node.js", "react.js", "postgresql", "mongodb", "typescript", "rest apis"]) assert.ok(skills.includes(s), s);
  assert.ok(!skills.includes("languages"));
});

test("good match with email → matched, score = stack 3/4·50 + role 20 + exp 20 + loc 10", () => {
  const r = run({});
  assert.equal(r.status, "matched");
  assert.equal(r.score, Math.round(50 * 0.75 + 20 + 20 + 10));
  assert.match(r.matchReasons[0], /Stack: Node\.js, React, PostgreSQL \(3\/4\)/);
});

test("no email → no_email (Apply manually)", () => {
  const r = run({}, "We are hiring", []);
  assert.equal(r.status, "no_email");
  assert.ok(r.matchReasons.some((m) => /apply manually/i.test(m)));
});

test("experience: outside range filtered; '3+' overlaps; not stated keeps half credit", () => {
  assert.equal(run({ exp_min: 6, exp_max: 10 }).status, "filtered_out");
  assert.match(run({ exp_min: 6, exp_max: 10 }).filterReasons[0], /Needs 6–10 yrs; you accept 1–4 yrs/);
  const plus = run({ exp_min: 3, exp_max: null });
  assert.equal(plus.status, "matched");
  assert.ok(plus.matchReasons.includes("Experience overlaps your range: 3+ yrs"));
  const none = run({ exp_min: null, exp_max: null });
  assert.equal(none.status, "matched");
  assert.equal(none.score, Math.round(37.5 + 20 + 10 + 10));
  assert.ok(none.matchReasons.includes("Experience not stated"));
});

test("location: alias match, remote, not stated, PAN India, elsewhere", () => {
  assert.ok(run({ location: "Gurugram" }).matchReasons.includes("Location: gurgaon"));
  assert.ok(run({ location: null, work_mode: "remote" }).matchReasons.includes("Remote"));
  const ns = run({ location: null, work_mode: null });
  assert.ok(ns.matchReasons.includes("Location not stated"));
  assert.equal(run({ location: "PAN India" }).status, "matched");
  const far = run({ location: "Chennai" });
  assert.equal(far.status, "filtered_out");
  assert.match(far.filterReasons.join(), /Location "Chennai" not in your locations/);
});

test("role: title match, text-only half credit, no match filtered", () => {
  assert.ok(run({ title: "Software Developer" }).matchReasons.some((m) => /Role matches/.test(m))); // alias of software engineer
  const textOnly = run({ title: "Engineer II" }, "We are hiring for our backend team");
  assert.ok(textOnly.matchReasons.some((m) => /Role mentioned in text: backend/.test(m)));
  assert.equal(run({ title: "Data Analyst" }, "Hiring a data analyst").status, "filtered_out");
});

test("multi-role posts: other_titles count for the role check", () => {
  assert.equal(run({ title: "QA Engineer", other_titles: ["MERN Stack Developer"] }, "Hiring QA").status, "matched");
});

test("avoid list and must-have", () => {
  assert.match(run({}, "We are hiring a sales engineer").filterReasons.join(), /"sales" \(avoid list\)/);
  assert.equal(run({}, "We are hiring Salesforce devs").status, "matched"); // whole word
  const noMust = run({ title: "Java Backend Developer", tech_stack: ["Java", "Spring"] }, "Hiring Java backend devs");
  assert.match(noMust.filterReasons.join(), /None of your must-have skills/);
});

test("all problems are listed, not just the first", () => {
  const r = run({ exp_min: 8, exp_max: 12, location: "Chennai" });
  assert.equal(r.filterReasons.length, 2);
});

test("not a job / job seeker → not_job", () => {
  assert.equal(run({ is_job_post: false }).status, "not_job");
  assert.match(run({ is_job_post: false, is_job_seeker: true }).filterReasons[0], /looking for a job/);
});

// ---------- extraction parsing ----------
test("schema is lenient with typical model output", () => {
  const e = ExtractionSchema.parse({
    is_job_post: true,
    title: "",
    other_titles: null,
    company: "N/A",
    exp_min: "3",
    exp_max: null,
    location: "Not mentioned",
    work_mode: "Remote",
    employment_type: "Full Time",
    tech_stack: ["React", "React", "Node.js"],
    apply_url: null,
    summary: "x",
  });
  assert.equal(e.title, null);
  assert.equal(e.company, null);
  assert.equal(e.exp_min, 3);
  assert.equal(e.location, null);
  assert.equal(e.work_mode, "remote");
  assert.equal(e.employment_type, "full-time");
  assert.deepEqual(e.tech_stack, ["React", "Node.js"]);
  assert.deepEqual(e.other_titles, []);
  assert.equal(e.is_job_seeker, false);
  assert.equal(ExtractionSchema.safeParse({ title: "x" }).success, false); // is_job_post is required
});

test("emails and phone numbers are masked before the LLM sees the text", () => {
  const m = maskContacts("Mail hr@acme.example or call +91 98765 43210 / 011-2345-6789. 2-4 yrs, 12 LPA, 2026.");
  assert.equal(m, "Mail [EMAIL] or call [PHONE] / [PHONE]. 2-4 yrs, 12 LPA, 2026.");
  assert.equal(maskContacts("Call (011) 2345 6789 or 9876543210."), "Call [PHONE] or [PHONE].");
  assert.equal(maskContacts("Budget 1,20,000 to 2,40,000; ref 2024-2025"), "Budget 1,20,000 to 2,40,000; ref 2024-2025");
});

test("apply_url is kept only if it is in the post text; seekers are never job posts", () => {
  const text = "Apply at https://acme.example/careers/42 today";
  const e = ExtractionSchema.parse({ is_job_post: true, apply_url: "https://acme.example/careers/42." });
  assert.equal(sanitizeExtraction(e, text).apply_url, "https://acme.example/careers/42");
  const fake = ExtractionSchema.parse({ is_job_post: true, apply_url: "https://invented.example/jobs" });
  assert.equal(sanitizeExtraction(fake, text).apply_url, null);
  const seeker = ExtractionSchema.parse({ is_job_post: true, is_job_seeker: true });
  assert.equal(sanitizeExtraction(seeker, text).is_job_post, false);
});
