import { createHash } from "node:crypto";

const ZERO_WIDTH = /[​-‍⁠﻿]/g;

/** Normalized form used only for hashing: same post text → same hash, regardless of formatting noise. */
export function normalizeForHash(text: string): string {
  return text
    .normalize("NFKC")
    .replace(ZERO_WIDTH, "")
    .toLowerCase()
    .replace(/(…|\.\.\.)\s*(see\s+)?more\s*$/u, "") // trailing "…more" toggle text
    .replace(/\s+/g, " ")
    .trim();
}

export function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export function textHash(text: string): string {
  return sha256(normalizeForHash(text)).slice(0, 32);
}

/** Tidies captured text for storage and display (keeps line breaks). */
export function cleanText(text: string): string {
  return text
    .replace(ZERO_WIDTH, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,24}/g;
const NOT_EMAIL_TLD = /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i;

/** Emails that literally appear in the text. Lowercased, de-duplicated, in order of appearance. */
export function extractEmails(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.normalize("NFKC").matchAll(EMAIL_RE)) {
    const email = m[0].replace(/^[._%+-]+/, "").replace(/[.-]+$/, "").toLowerCase();
    if (NOT_EMAIL_TLD.test(email) || !email.includes("@")) continue;
    out.add(email);
  }
  return [...out];
}
