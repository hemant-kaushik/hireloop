// ALL LinkedIn DOM selectors live in this file (CLAUDE.md rule). When LinkedIn changes its
// HTML, this is the only file to fix. Each list is tried in order; the first match wins.
//
// LinkedIn serves two DOM generations:
//  - "sdui": new server-driven UI (seen 2026). Hashed class names, no data-urn, no permalinks.
//    Only stable hooks are used: role, data-testid, componentkey, aria-label, href.
//  - "classic": older feed markup with data-urn="urn:li:activity:…" and update-components-* classes.
//
// Never rely on hashed class names like "c127c4d1": they change on every LinkedIn deploy.

globalThis.HL_SELECTORS = {
  // ---- finding posts ----
  // sdui: the container's componentkey prefix changes between LinkedIn releases
  // ("expanded<hash>…" in April 2026, "update-card-focus<hash>…" in November 2026),
  // but it always ends in "FeedType_…". Match on that instead of the prefix.
  postRoots: [
    '[role="listitem"][componentkey*="FeedType_"]', // sdui (any prefix)
    '[role="listitem"][componentkey^="update-card-focus"]', // sdui, Nov 2026
    '[role="listitem"][componentkey^="expanded"]', // sdui, Apr 2026
    '[data-urn^="urn:li:activity:"]', // classic
    '[data-id^="urn:li:activity:"]',
    '[data-urn^="urn:li:ugcPost:"]',
  ],
  // Backup when no root matches: climb from a text box to its post container.
  textBoxForRootBackup: '[data-testid="expandable-text-box"]',
  rootBackupAncestor: '[role="listitem"], [componentkey*="FeedType_"], article',

  // ---- post id ----
  // sdui: componentkey="<any-prefix><hash>FeedType_MAIN_FEED" → <hash>. The hash is 43 chars
  // of base64url and identifies the post; the same hash also appears on an inner element as a
  // bare componentkey="<hash>" (backup).
  sduiKeyAttr: "componentkey",
  // Tried after the exact inner-element match (parse.js), in this order:
  sduiKeyPatterns: [
    /^(?:expanded|update-card-focus)([A-Za-z0-9_-]{16,128}?)(?:FeedType_.*)?$/, // known prefixes
    /([A-Za-z0-9_-]{43})FeedType_/, // unknown prefix: the 43 chars before FeedType_
  ],
  sduiInnerKeyPattern: /^[A-Za-z0-9_-]{43}$/,
  // classic: attributes that hold a URN, then any link/attr containing one
  urnAttrs: ["data-urn", "data-id"],
  urnPattern: /urn:li:(activity|ugcPost|share):\d{5,25}/,

  // ---- post text ----
  text: [
    '[data-testid="expandable-text-box"]', // sdui
    ".update-components-text", // classic
    ".feed-shared-inline-show-more-text",
    ".feed-shared-update-v2__description",
    '[dir="ltr"].break-words',
  ],
  // Elements inside the text box that are UI, not post text ("…more" toggle).
  textNoise: [
    '[data-testid="expandable-text-button"]',
    ".feed-shared-inline-show-more-text__see-more-less-toggle",
    "button",
  ],
  // Lines in the author header that are not the headline.
  authorLineNoise: /^(?:[•·]|(?:Verified|Premium|Following|Follow|Promoted|Sponsored|\d+(?:st|nd|rd|th)\+?)\b)/i,
  // Present while the post text is collapsed behind "…more".
  moreButton: [
    '[data-testid="expandable-text-button"]',
    ".feed-shared-inline-show-more-text__see-more-less-toggle",
  ],

  // ---- author ----
  // sdui: the profile/company link whose <p> lines start with the author name. Its header
  // (the link plus siblings, up to but excluding the post text) holds the lines
  // name, "• 3rd+", headline, "19h •". Apr 2026: all inside the link; Nov 2026: headline
  // and time are siblings of the link.
  authorMetaLink: 'a[href*="/in/"], a[href*="/company/"], a[href*="/school/"]',
  classicAuthorName: [
    ".update-components-actor__title span[aria-hidden='true']",
    ".update-components-actor__name span[aria-hidden='true']",
    ".update-components-actor__title",
    ".update-components-actor__name",
  ],
  classicAuthorHeadline: [
    ".update-components-actor__description span[aria-hidden='true']",
    ".update-components-actor__description",
  ],
  classicAuthorLink: [
    "a.update-components-actor__meta-link",
    ".update-components-actor__container a[href*='/in/']",
    ".update-components-actor__container a[href*='/company/']",
  ],
  classicPostedLabel: [
    ".update-components-actor__sub-description span[aria-hidden='true']",
    ".update-components-actor__sub-description",
  ],
  // Accessible labels that carry the author name: "View Abhijit Kadam’s profile"
  authorLabelAttrs: ["alt", "aria-label"],
  authorLabelPattern: /^View\s+(.+?)[’'`]s\s+(profile|page)/i,
  followButton: 'button[aria-label^="Follow "]',

  // ---- extras ----
  jobLink: 'a[href*="/jobs/view/"]',
  // Promoted posts are skipped.
  promoted: ['[aria-label="Why am I seeing this ad?"]', 'a[href*="/ad/"]'],
  promotedText: /^(Promoted|Sponsored)\b/m,

  // Relative time labels: 19h, 3d, 2w, 1mo, 1yr, 5m, now
  postedLabelPattern: /^(\d+\s?(s|m|h|d|w|mo|y|yr)|now|just now)\b/i,
};
