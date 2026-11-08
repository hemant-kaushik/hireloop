import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanText, extractEmails, normalizeForHash, textHash } from "../src/lib/text.ts";

test("normalizeForHash ignores case, spacing, zero-width chars and a trailing …more", () => {
  const a = "We're  Hiring!\nSend CV​ to hr@x.com …more";
  const b = "we're hiring! send cv to HR@X.COM";
  assert.equal(normalizeForHash(a), normalizeForHash(b));
  assert.equal(textHash(a), textHash(b));
  assert.equal(textHash(a).length, 32);
});

test("textHash differs for different text", () => {
  assert.notEqual(textHash("hiring node developer"), textHash("hiring react developer"));
});

test("extractEmails finds literal emails, lowercased and de-duplicated", () => {
  const text = "Send CV to HR.Team@Acme.co.in or hr.team@acme.co.in. Also careers@foo-bar.com.";
  assert.deepEqual(extractEmails(text), ["hr.team@acme.co.in", "careers@foo-bar.com"]);
});

test("extractEmails skips image file names and text without emails", () => {
  assert.deepEqual(extractEmails("logo@2x.png and banner@3x.webp"), []);
  assert.deepEqual(extractEmails("DM me for details, email in comments"), []);
});

test("cleanText keeps paragraphs but collapses noise", () => {
  assert.equal(cleanText("  Hello   world \r\n\r\n\r\n\r\nNext​ line  "), "Hello world\n\nNext line");
});
