// npm run llm:check -w server            → free: list models per provider, confirm the configured one exists
// npm run llm:check -w server -- --call  → also ONE real extraction call per provider on a DUMMY post
//                                          (costs one call each; OpenAI is paid). Nothing is written to the DB.

import { config } from "../config.js";
import { ALL_PROVIDERS } from "../llm/providers.js";
import { buildExtractPrompt, ExtractionSchema, SYSTEM_PROMPT } from "../pipeline/extract-prompt.js";

const doCall = process.argv.includes("--call");

const HINT: Record<string, RegExp> = {
  gemini: /flash/i,
  groq: /llama|gpt-oss|qwen|kimi/i,
  openai: /^(gpt-4\.1|gpt-4o|gpt-5)(?!.*(audio|realtime|search|transcribe|tts|image|codex))/i,
  ollama: /./,
};

// Dummy post (no real person): exercises role, experience, location, stack, masking.
const DUMMY_POST = `🚀 We're hiring! Full Stack Developer (MERN) at Example Labs
Experience: 2-4 years | Location: Noida (Hybrid)
Must have: React, Node.js, Express, MongoDB, TypeScript. Nice to have: AWS, Docker.
Also hiring a QA Engineer (1-3 yrs).
Send your CV to careers@example-labs.test or call +91 98765 43210.
Apply: https://example-labs.test/careers/fsd-42`;

let problems = 0;
for (const name of config.llm.order) {
  const p = ALL_PROVIDERS[name];
  if (!p) {
    console.log(`✗ ${name}: unknown provider in LLM_ORDER`);
    problems++;
    continue;
  }
  if (!p.configured()) {
    console.log(`- ${name}: not configured (${name === "ollama" ? "set OLLAMA_MODEL" : `set ${name.toUpperCase()}_API_KEY`} in server/.env)`);
    continue;
  }
  try {
    const models = await p.listModels();
    const ok = models.includes(p.model);
    if (!ok) problems++;
    console.log(`${ok ? "✓" : "✗"} ${name}: configured model "${p.model}" ${ok ? "is available" : "is NOT available for this key"}`);
    const suggestions = models.filter((m) => HINT[name].test(m)).sort();
    console.log(`  available (${models.length} total, showing likely candidates): ${suggestions.slice(0, 25).join(", ")}`);
    if (!ok || !doCall) continue;

    const t0 = Date.now();
    const raw = await p.call({ system: SYSTEM_PROMPT, prompt: buildExtractPrompt(DUMMY_POST) });
    const ms = Date.now() - t0;
    let parsed;
    try {
      parsed = ExtractionSchema.safeParse(JSON.parse(raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, "")));
    } catch {
      parsed = null;
    }
    if (!parsed || !parsed.success) {
      problems++;
      console.log(`  ✗ live call (${ms} ms): reply did not pass the schema: ${raw.slice(0, 200)}`);
      continue;
    }
    const e = parsed.data;
    console.log(
      `  ✓ live call (${ms} ms): job=${e.is_job_post} title="${e.title}" also=[${e.other_titles.join(", ")}] exp=${e.exp_min}–${e.exp_max} ` +
        `location="${e.location}" mode=${e.work_mode} stack=[${e.tech_stack.join(", ")}] apply=${e.apply_url}`,
    );
  } catch (err) {
    problems++;
    console.log(`✗ ${name}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
if (!doCall) console.log("\nTip: add `-- --call` to also make one real extraction call per provider on a dummy post.");
process.exitCode = problems ? 1 : 0;
