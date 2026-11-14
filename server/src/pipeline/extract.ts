// Stage 2: one LLM call per post → structured job fields.
// Privacy: only the post text is sent, with emails and phone numbers masked. No author, no profile.

import { generateJSON } from "../llm/gateway.js";
import { buildExtractPrompt, ExtractionSchema, sanitizeExtraction, SYSTEM_PROMPT } from "./extract-prompt.js";

export * from "./extract-prompt.js";

export async function extractJob(post: { id: number; text: string }) {
  const res = await generateJSON({
    task: "extract",
    system: SYSTEM_PROMPT,
    prompt: buildExtractPrompt(post.text),
    schema: ExtractionSchema,
    postId: post.id,
  });
  return { ...res, data: sanitizeExtraction(res.data, post.text) };
}
