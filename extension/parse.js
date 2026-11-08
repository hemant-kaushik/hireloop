// Turns a LinkedIn post element into a plain object. Pure DOM reading, no side effects,
// so it can be tested on saved HTML (see test/run.html). Selectors come from selectors.js.

(() => {
  const S = globalThis.HL_SELECTORS;
  const ROOT_SELECTOR = S.postRoots.join(", ");

  const first = (root, sels) => {
    for (const s of sels) {
      const el = root.querySelector(s);
      if (el) return el;
    }
    return null;
  };

  const clean = (s) =>
    (s || "")
      .replace(/[​-‍⁠﻿]/g, "")
      .replace(/\r\n?/g, "\n")
      .replace(/[ \t ]+/g, " ")
      .replace(/ *\n */g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

  /** Visible text of an element, without UI noise, keeping line breaks. */
  function elementText(el, noise = S.textNoise) {
    const c = el.cloneNode(true);
    if (noise.length) c.querySelectorAll(noise.join(", ")).forEach((n) => n.remove());
    c.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
    c.querySelectorAll("p, li, div").forEach((b) => b.append("\n"));
    return clean(c.textContent.replace(/\bhashtag\s*(?=#)/gi, ""));
  }

  /** Text of a line element, without aria-hidden duplicates ("Full Stack Engineer" shown twice). */
  const lineText = (el) => elementText(el, ['[aria-hidden="true"]']).replace(/\n+/g, " ");

  /** All post elements in a document, outermost only (a reshared post inside a post is part of it). */
  function findPostRoots(doc) {
    let roots = [...doc.querySelectorAll(ROOT_SELECTOR)];
    if (roots.length === 0) {
      // Backup: climb from each text box to its container.
      const set = new Set();
      doc.querySelectorAll(S.textBoxForRootBackup).forEach((tb) => {
        const r = tb.closest(S.rootBackupAncestor);
        if (r) set.add(r);
      });
      roots = [...set];
      return roots.filter((el) => !roots.some((o) => o !== el && o.contains(el)));
    }
    return roots.filter((el) => !el.parentElement || !el.parentElement.closest(ROOT_SELECTOR));
  }

  function findKey(root) {
    const ck = root.getAttribute(S.sduiKeyAttr);
    const m = ck && ck.match(S.sduiKeyPattern);
    if (m) return { key: `ck:${m[1]}`, dom: "sdui" };
    for (const a of S.urnAttrs) {
      const u = (root.getAttribute(a) || "").match(S.urnPattern);
      if (u) return { key: u[0], dom: "classic" };
    }
    // A URN anywhere inside (data attribute or link)
    const inner = root.querySelector(S.urnAttrs.map((a) => `[${a}*="urn:li:"]`).join(", ") + ', a[href*="urn:li:"]');
    if (inner) {
      const src = S.urnAttrs.map((a) => inner.getAttribute(a)).find(Boolean) || inner.getAttribute("href") || "";
      const u = decodeURIComponent(src).match(S.urnPattern);
      if (u) return { key: u[0], dom: "classic" };
    }
    return { key: null, dom: root.matches('[role="listitem"]') ? "sdui" : "unknown" };
  }

  /** Longest text-only block in the post: a backup when no text selector matches. */
  function longestTextBlock(root) {
    let best = null;
    let bestLen = 30;
    root.querySelectorAll("p, span, div").forEach((el) => {
      if (el.querySelector("button, img, figure, video, a[href*='/in/']")) return;
      const len = el.textContent.trim().length;
      if (len > bestLen) {
        best = el;
        bestLen = len;
      }
    });
    return best;
  }

  function extractText(root) {
    const box = first(root, S.text);
    if (box) {
      const text = elementText(box);
      if (text) return { text, quality: "ok", box };
    }
    const block = longestTextBlock(root);
    if (block) return { text: elementText(block), quality: "fallback", box: block };
    return { text: "", quality: "raw", box: null };
  }

  function authorInfo(root) {
    const out = { author: null, authorHeadline: null, authorUrl: null, postedLabel: null };

    // sdui: the profile/company link that contains <p> lines
    const metaLink = [...root.querySelectorAll(S.authorMetaLink)].find((a) => a.querySelector("p"));
    if (metaLink) {
      const lines = [...metaLink.querySelectorAll("p")].map(lineText).filter(Boolean);
      out.author = lines[0] || null;
      const posted = lines.find((l) => S.postedLabelPattern.test(l));
      if (posted) out.postedLabel = posted.match(S.postedLabelPattern)[0];
      out.authorHeadline =
        lines.slice(1).find((l) => l !== posted && !S.authorLineNoise.test(l) && !S.postedLabelPattern.test(l)) || null;
      out.authorUrl = metaLink.href || null;
    }

    // classic
    if (!out.author) {
      const n = first(root, S.classicAuthorName);
      if (n) out.author = lineText(n) || null;
    }
    if (!out.authorHeadline) {
      const h = first(root, S.classicAuthorHeadline);
      if (h) out.authorHeadline = lineText(h) || null;
    }
    if (!out.authorUrl) {
      const l = first(root, S.classicAuthorLink);
      if (l) out.authorUrl = l.href || null;
    }
    if (!out.postedLabel) {
      const p = first(root, S.classicPostedLabel);
      const m = p && lineText(p).match(S.postedLabelPattern);
      if (m) out.postedLabel = m[0];
    }

    // Backups for the name: "View X’s profile" labels, then the Follow button
    if (!out.author) {
      for (const attr of S.authorLabelAttrs) {
        for (const el of root.querySelectorAll(`[${attr}]`)) {
          const m = (el.getAttribute(attr) || "").match(S.authorLabelPattern);
          if (m) {
            out.author = m[1].trim();
            break;
          }
        }
        if (out.author) break;
      }
    }
    if (!out.author) {
      const f = root.querySelector(S.followButton);
      if (f) out.author = f.getAttribute("aria-label").replace(/^Follow\s+/, "").trim() || null;
    }
    if (!out.authorUrl) {
      const a = root.querySelector(S.authorMetaLink);
      if (a) out.authorUrl = a.href || null;
    }
    return out;
  }

  function isPromoted(root, info) {
    if (first(root, S.promoted)) return true;
    return S.promotedText.test(info.postedLabel || "") || S.promotedText.test(info.authorHeadline || "");
  }

  function sourceOf(pathname) {
    if (pathname.startsWith("/feed")) return "feed";
    if (pathname.startsWith("/search")) return "search";
    if (/^\/(in|company|school)\//.test(pathname)) return "profile";
    return "other";
  }

  /** Main entry: one post element → object for /api/ingest (or null if it isn't a usable post). */
  function parsePost(root, loc = globalThis.location) {
    const { key, dom } = findKey(root);
    const info = authorInfo(root);
    if (isPromoted(root, info)) return { promoted: true };

    const { text, quality, box } = extractText(root);
    const hasMore = !!(box && first(box, S.moreButton)) || !!first(root, S.moreButton);
    const looksCut = /(…|\.\.\.)$/.test(text);
    const parseQuality = quality === "ok" && hasMore && looksCut ? "truncated" : quality;
    const rawText = parseQuality === "ok" ? "" : clean(root.innerText || root.textContent).slice(0, 8000);

    const jobLink = root.querySelector(S.jobLink);
    return {
      key,
      dom,
      author: info.author,
      authorHeadline: info.authorHeadline,
      authorUrl: info.authorUrl,
      text,
      rawText,
      url: key && key.startsWith("urn:") ? `https://www.linkedin.com/feed/update/${key}/` : null,
      postedLabel: info.postedLabel,
      pageUrl: loc ? loc.origin + loc.pathname : null,
      parseQuality,
      hasMore,
      jobUrl: jobLink ? jobLink.href : null,
      source: loc ? sourceOf(loc.pathname) : "other",
    };
  }

  globalThis.HL_PARSE = { findPostRoots, parsePost, elementText };
})();
