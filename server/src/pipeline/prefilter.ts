// Stage 1: free, deterministic checks before any LLM call.
//
// Rules f2f … staffing are ported from the friend's repo
// linkedin-jobs-outreach/src/services/location-filter.js (MIT License,
// © 2025 LinkedIn Feed Email Extractor Contributors), keeping their regexes and exceptions.
// Changes: plurals in the internship rule ("interns" was missed); curly apostrophes normalized;
// the job-seeker exception also accepts recruiter/job-list wording; each rule has an id so it can be switched off via preferences.yaml `disable_rules`,
// and a hiring-signal gate + block_authors run first.

import { hasPhrase } from "../lib/match.js";

export const RULE_IDS = ["f2f", "non_india", "local_only", "internship", "job_seeker", "low_salary", "staffing"] as const;
export type RuleId = (typeof RULE_IDS)[number];

export type PrefilterResult =
  | { pass: true }
  | { pass: false; status: "blocked" | "rejected_prefilter"; rule: string; reason: string };

// ---- hiring signal (HireLoop) ----
const HIRING_SIGNAL =
  /\b(hiring|we'?re hiring|we are hiring|now hiring|openings?|vacanc(y|ies)|positions?|job (opening|opportunity|role|alert)|jd\b|job description|requirements?|send (your |us your |me your )?(cv|resume|résumé|profile)|share (your )?(cv|resume|profile)|apply|join (our|the) team|looking for (a |an )?[a-z.+# -]{0,30}(developer|engineer|designer|candidate|intern|lead|architect)s?|we are (actively )?(looking|searching|seeking)|we'?re (actively )?(looking|searching|seeking)|immediate joiner|notice period|interested candidates|refer(ral)?s?)\b/i;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

// ---- ported from location-filter.js ----
const LOCATION_PATTERNS: Record<string, RegExp> = {
  usCities: /\b(San Diego|San Francisco|San Jose|New York|NYC|Chicago|Los Angeles|Seattle|Austin|Dallas|Houston|Plano|Boston|Denver|Atlanta|Phoenix|Portland|Raleigh|Charlotte|Arlington|Tampa|Miami|Orlando|Minneapolis|Detroit|Philadelphia|Pittsburgh|Nashville|Las Vegas|Sacramento|Irvine|Sunnyvale|Mountain View|Palo Alto|Cupertino|Redmond|Bellevue|Ann Arbor|Boulder|Scottsdale|Boise|Salt Lake City|St\.? Louis|San Antonio|Columbus|Indianapolis|Jacksonville|Memphis|Louisville|Richmond|Omaha|Tucson|Fresno|Mesa)\b/i,
  usStates: /\b(California|Texas|Florida|Illinois|Ohio|Georgia|Michigan|Pennsylvania|Massachusetts|Washington State|Colorado|Arizona|Maryland|Virginia|Oregon|Tennessee|Minnesota|Wisconsin|Indiana|Missouri|New Jersey|Connecticut|North Carolina|South Carolina)\b/i,
  usGeneral: /\b(United States|USA|U\.S\.A|US[- ]based|based in US)\b(?!\s*(?:shift|timing|hours|time zone))/i,
  visa: /\b(H1B|H-1B|H1-B|Green Card|USC|US Citizen|EAD|OPT|CPT|work authorization|work permit|visa sponsor|TN visa|E-?verify)\b/i,
  w2c2c: /\b(W2|W-2|C2C|Corp[- ]to[- ]Corp|1099)\b/i,
  pakistan: /\b(Pakistan|Lahore|Karachi|Islamabad|Rawalpindi|Faisalabad|Multan|Peshawar|Quetta|Sialkot|Gujranwala|Johar Town|Bahria Town|DHA Lahore|DHA Karachi)\b/i,
  middleEast: /\b(Dubai|Abu Dhabi|UAE|Saudi Arabia|Riyadh|Jeddah|Qatar|Doha|Bahrain|Kuwait|Oman|Muscat)\b/i,
  seAsia: /\b(Singapore|Makati|Manila|Philippines|Jakarta|Indonesia|Bangkok|Thailand|Ho Chi Minh|Ha Noi|Hanoi|Vietnam|Kuala Lumpur|Malaysia)\b/i,
  europe: /\b(London|Berlin|Amsterdam|Paris|Munich|Stockholm|Barcelona|Madrid|Dublin|Zurich|Geneva|Vienna|Prague|Warsaw|Lisbon|Rome|Copenhagen|Helsinki|Oslo|Brussels|Edinburgh|Manchester|Hamburg|Frankfurt)\b/i,
  otherCountries: /\b(Canada|Toronto|Vancouver|Montreal|Calgary|Ottawa|Australia|Sydney|Melbourne|Brisbane|Perth|Adelaide|Auckland|New Zealand|Japan|Tokyo|South Korea|Seoul|Taiwan|Taipei|Hong Kong|China|Shanghai|Beijing|Shenzhen)\b/i,
  nonIndiaDomains: /@\S+\.(pk|bd|ae|uk|ca|au|sg|ph|my|sa|qa|de|fr|nl|se|ch|jp|kr|cn|tw|nz)\b/i,
};
const LOCATION_LABELS: Record<string, string> = {
  usCities: "US city", usStates: "US state", usGeneral: "US-based",
  visa: "visa/work auth required", w2c2c: "US contract type",
  pakistan: "Pakistan-based", middleEast: "Middle East-based",
  seAsia: "Southeast Asia-based", europe: "Europe-based",
  otherCountries: "non-India country", nonIndiaDomains: "non-India email domain",
};
const INDIA_CITIES = /\b(Bangalore|Bengaluru|Mumbai|Pune|Hyderabad|Chennai|Delhi|Noida|Gurgaon|Gurugram|Kolkata|Ahmedabad|Jaipur|Indore|Chandigarh|Mohali|Kochi|Lucknow|Bhopal|Nagpur|Coimbatore|Surat|Visakhapatnam|Thiruvananthapuram|India)\b/i;
const F2F_PATTERN = /\b(walk[- ]?in|face[- ]to[- ]face|F2F|in[- ]person interview)\b/i;
const LOCAL_ONLY_PATTERN = /\b(local candidates? only|only local candidates?|locals only|ONLY .{1,30} LOCAL CANDIDATES|local candidates? can apply|must be (based|from|located|residing) in|currently based in .{1,20} only|only (from|candidates? from) .{1,20}(can apply|only|preferred)|only .{1,15} candidates? (can apply|only))\b/i;
const INTERNSHIP_PATTERN = /\b(interns?\b|internships?|trainees?|apprentices?|stipend|unpaid)\b/i; // HireLoop: plurals added
const JOB_SEEKER_PATTERN = /\b(#OpenToWork|open to work|actively looking|actively seeking|seeking opportunities|looking for .{0,15}(job|role|position|opportunity)|job seeker|hire me|currently unemployed)\b/i;
// HireLoop: widened with recruiter/job-list wording seen in real posts ("HIRING ALERT", "Job Openings",
// "Open Positions", "Apply:"), which the friend's list missed: "Looking for a new opportunity? Here are openings…"
const SEEKER_HIRING_SIGNAL = /\b(hiring alert|now hiring|job openings?|openings|open positions?|vacanc(?:y|ies)|apply\s*(?:here|now|:)|we are hiring|we're hiring|hiring for|open position|urgent hiring|join our team|looking for a .{0,20}(developer|engineer|designer|candidate)|we are (actively )?(looking|searching|seeking) for|we're (actively )?(looking|searching|seeking) for|we're expanding|we are expanding|our team is (looking|growing|hiring))\b/i;
const LOW_SALARY_PATTERN = /\b([1-5]\s*LPA|[1-5]\s*lakhs?\s*(per\s*annum|PA|p\.a\.))\b/i;
const STAFFING_PATTERN = /\b(empanelment|recruitment agency|staffing (company|agency|partner|firm))\b/i;

type RuleHit = { rule: RuleId; reason: string } | null;

/** Port of checkLocation(): first matching rule wins, in the friend's order. */
/** LinkedIn uses curly apostrophes ("We’re hiring"); the ported regexes expect straight ones. */
const straightQuotes = (t: string) => t.replace(/[\u2018\u2019\u02BC]/g, "'");

export function checkRules(rawText: string, disabled: ReadonlySet<string> = new Set()): RuleHit {
  if (!rawText || rawText.trim().length < 10) return null;
  const text = straightQuotes(rawText);
  const on = (r: RuleId) => !disabled.has(r);

  if (on("f2f")) {
    const m = text.match(F2F_PATTERN);
    if (m) return { rule: "f2f", reason: `F2F interview required (${m[0]})` };
  }

  if (on("non_india")) {
    const hits: { key: string; matched: string }[] = [];
    for (const [key, re] of Object.entries(LOCATION_PATTERNS)) {
      const m = text.match(re);
      if (m) hits.push({ key, matched: m[0] });
    }
    if (hits.length) {
      const hasVisa = hits.some((h) => h.key === "visa");
      const hasW2 = hits.some((h) => h.key === "w2c2c");
      const hasRemote = /\b(remote|work from home|WFH|remote.?friendly|fully remote)\b/i.test(text);
      const hasIndiaRemote = /\b(remote.{0,20}india|india.{0,20}remote|PAN India)\b/i.test(text);
      const hasIndiaLocation = INDIA_CITIES.test(text);
      const skip =
        hasIndiaRemote ||
        (hasRemote && !hasVisa && !hasW2 && hits.length === 1) ||
        (hits.length === 1 && hits[0].key === "usGeneral" && hasIndiaLocation && !hasVisa && !hasW2);
      if (!skip) {
        return { rule: "non_india", reason: `Non-India/restricted (${hits.map((h) => `${LOCATION_LABELS[h.key]}: ${h.matched}`).join(", ")})` };
      }
    }
  }

  if (on("local_only")) {
    const m = text.match(LOCAL_ONLY_PATTERN);
    if (m) {
      const at = text.indexOf(m[0]);
      const ctx = text.substring(Math.max(0, at - 20), at + m[0].length + 40);
      if (!/\b(india|indian|pan india|anywhere in india)\b/i.test(ctx)) {
        return { rule: "local_only", reason: `Local candidates only (${m[0].substring(0, 50)})` };
      }
    }
  }

  if (on("internship")) {
    const m = text.match(INTERNSHIP_PATTERN);
    if (m) {
      const word = m[0].toLowerCase();
      if (word === "stipend" || word === "unpaid") return { rule: "internship", reason: `Internship/stipend (${m[0]})` };
      if (!/\b(full[- ]?time|permanent|regular position)\b/i.test(text)) {
        return { rule: "internship", reason: `Internship/stipend (${m[0]})` };
      }
    }
  }

  if (on("job_seeker")) {
    const m = text.match(JOB_SEEKER_PATTERN);
    if (m && !SEEKER_HIRING_SIGNAL.test(text)) {
      return { rule: "job_seeker", reason: `Job seeker, not hiring (${m[0].substring(0, 40)})` };
    }
  }

  if (on("low_salary")) {
    const m = text.match(LOW_SALARY_PATTERN);
    if (m) return { rule: "low_salary", reason: `Low salary (${m[0]})` };
  }

  if (on("staffing")) {
    const m = text.match(STAFFING_PATTERN);
    if (m) return { rule: "staffing", reason: `Staffing/recruitment (${m[0]})` };
  }
  return null;
}

/** Full stage 1: block_authors → hiring signal → ported rules. */
export function prefilter(
  post: { author: string | null; text: string },
  prefs: { block_authors: string[]; disable_rules: string[] },
): PrefilterResult {
  const blockedBy = prefs.block_authors.find((name) => hasPhrase(post.author ?? "", name));
  if (blockedBy) return { pass: false, status: "blocked", rule: "block_authors", reason: `Author matches block list ("${blockedBy}")` };

  if (!HIRING_SIGNAL.test(straightQuotes(post.text)) && !EMAIL_RE.test(post.text)) {
    return { pass: false, status: "rejected_prefilter", rule: "no_hiring_signal", reason: "No hiring signal (hiring, opening, apply, send CV…)" };
  }

  const hit = checkRules(post.text, new Set(prefs.disable_rules));
  if (hit) return { pass: false, status: "rejected_prefilter", rule: hit.rule, reason: hit.reason };
  return { pass: true };
}
