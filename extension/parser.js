// Runs inside the LinkedIn page (injected via chrome.scripting.executeScript).
// Best-effort DOM parsing: LinkedIn's markup is unstable and periodically
// changes, so every extraction degrades to a safe default (0 / "" / "text")
// instead of throwing — the popup always shows an editable review before
// anything is submitted, so a bad parse costs a manual fix, not a bad capture.
function radarParseLinkedInPosts() {
  function parseAbbreviatedNumber(raw) {
    if (!raw) return 0;
    const cleaned = raw.replace(/,/g, "").trim();
    const mult = /k$/i.test(cleaned) ? 1000 : /m$/i.test(cleaned) ? 1000000 : 1;
    const num = parseFloat(cleaned) * mult;
    return Number.isFinite(num) ? Math.round(num) : 0;
  }

  function extractCount(text, regex) {
    const m = text.match(regex);
    return m ? parseAbbreviatedNumber(m[1]) : 0;
  }

  function detectMediaType(node) {
    if (node.querySelector("video")) return "video";
    if (node.querySelector('[class*="poll"]')) return "poll";
    if (node.querySelector('[class*="document"]')) return "document";
    if (node.querySelector('[class*="image"] img, img[class*="image"]')) return "image";
    return "text";
  }

  const results = [];
  const seen = new Set();

  // LinkedIn tags each feed/activity card with a data-urn like "urn:li:activity:...".
  const nodes = document.querySelectorAll('[data-urn*="urn:li:activity"]');

  nodes.forEach((node) => {
    try {
      const urn = node.getAttribute("data-urn");
      if (!urn || seen.has(urn)) return;
      seen.add(urn);

      const linkEl = node.querySelector('a[href*="/feed/update/"], a[href*="/posts/"]');
      const postUrl = linkEl ? linkEl.href.split("?")[0] : `https://www.linkedin.com/feed/update/${urn}/`;

      const textEl = node.querySelector('[class*="description"], [class*="update-v2__commentary"]');
      const text = (textEl?.innerText || "").trim();

      const timeEl = node.querySelector("time");
      const postedAt = timeEl?.getAttribute("datetime") || null;

      const socialBar = node.querySelector('[class*="social-counts"], [class*="social-details"]');
      const barText = (socialBar?.innerText || node.innerText || "").replace(/\s+/g, " ");

      const likes =
        extractCount(barText, /([\d,.]+[km]?)\s*(reactions|likes)/i) ||
        extractCount(barText, /^\s*([\d,.]+[km]?)\s/i);
      const comments = extractCount(barText, /([\d,.]+[km]?)\s*comments?/i);
      const reposts = extractCount(barText, /([\d,.]+[km]?)\s*(reposts?|shares?)/i);

      results.push({
        post_url: postUrl,
        text,
        media_type: detectMediaType(node),
        posted_at: postedAt,
        likes,
        comments,
        reposts,
      });
    } catch (err) {
      // Skip a malformed card rather than aborting the whole scan.
      console.warn("Competitor Post Radar: failed to parse a post card", err);
    }
  });

  return results;
}
