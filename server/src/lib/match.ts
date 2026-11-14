// Whole-word, case-insensitive matching — the same approach as the friend's repo
// (linkedin-jobs-outreach: `\b…\b` regexes with the `i` flag), built from preferences.yaml lists,
// plus aliases (one word covers its spellings) and safe boundaries for terms with symbols.

/** Each group: spellings that mean the same thing. The first entry is the canonical name. */
const ALIAS_GROUPS: string[][] = [
  ["node", "node.js", "nodejs", "node js"],
  ["react", "react.js", "reactjs", "react js"],
  ["next.js", "nextjs", "next js"],
  ["express", "express.js", "expressjs"],
  ["vue", "vue.js", "vuejs"],
  ["angular", "angularjs", "angular.js"],
  ["full stack", "fullstack", "full-stack"],
  ["mern", "mern stack"],
  ["mean", "mean stack"],
  ["postgresql", "postgres", "psql"],
  ["mongodb", "mongo", "mongo db"],
  ["javascript", "js", "es6"],
  ["typescript", "ts"],
  ["golang", "go lang"],
  ["aws", "amazon web services"],
  ["gcp", "google cloud"],
  ["k8s", "kubernetes"],
  ["rest", "rest api", "restful", "rest apis"],
  ["llm", "llms", "large language model", "large language models"],
  ["rag", "retrieval augmented generation", "retrieval-augmented generation"],
  ["sde", "software development engineer", "sde-1", "sde-2", "sde 1", "sde 2", "sde i", "sde ii"],
  ["software engineer", "software engineers", "software developer", "software developers"],
  ["bangalore", "bengaluru", "blr"],
  ["gurgaon", "gurugram", "ggn"],
  ["delhi", "new delhi", "ncr", "delhi ncr", "delhi/ncr"],
  ["noida", "greater noida"],
  ["mumbai", "bombay", "navi mumbai"],
  ["remote", "wfh", "work from home", "remote-first", "fully remote"],
];

const aliasIndex = new Map<string, string[]>();
for (const group of ALIAS_GROUPS) for (const term of group) aliasIndex.set(term, group);

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Pattern for one term: `\b` like the friend's repo, but "not a letter/digit" when the term starts/ends with a symbol (c++, .net). */
function termPattern(term: string): string {
  const body = escape(term).replace(/\\?[\s-]+/g, "[\\s-]+"); // "full stack" also matches "full-stack" / extra spaces
  const start = /^\w/.test(term) ? "\\b" : "(?<![A-Za-z0-9])";
  const end = /\w$/.test(term) ? "\\b" : "(?![A-Za-z0-9])";
  return `${start}${body}${end}`;
}

/** All spellings of a term (itself + its alias group). */
export function expand(term: string): string[] {
  const t = term.trim().toLowerCase();
  return aliasIndex.get(t) ?? [t];
}

/** Canonical name for comparing stacks ("Node.js" and "nodejs" → "node"). */
export function canonical(term: string): string {
  const t = term.trim().toLowerCase();
  return aliasIndex.get(t)?.[0] ?? t;
}

const cache = new Map<string, RegExp>();
/** Case-insensitive whole-word regex for a term and all its aliases. */
export function termRegex(term: string): RegExp {
  const key = term.trim().toLowerCase();
  let re = cache.get(key);
  if (!re) {
    const variants = [...new Set(expand(key))].sort((a, b) => b.length - a.length);
    re = new RegExp(`(?:${variants.map(termPattern).join("|")})`, "i");
    cache.set(key, re);
  }
  return re;
}

/** True if `text` contains `term` (or an alias) as a whole word. */
export function hasTerm(text: string, term: string): boolean {
  return !!term.trim() && termRegex(term).test(text);
}

/** The terms from `terms` that appear in `text` (as given in the list, in list order). */
export function findTerms(text: string, terms: string[]): string[] {
  return terms.filter((t) => hasTerm(text, t));
}

/** Exact whole-word phrase match without aliases (used for author names). */
export function hasPhrase(text: string, phrase: string): boolean {
  const p = phrase.trim();
  return !!p && new RegExp(termPattern(p.toLowerCase()), "i").test(text);
}
