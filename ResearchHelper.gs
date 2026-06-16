/**
 * 80,000 Hours — Research helper
 *
 * Two related features:
 *   1. Link verification — for each external hyperlink in the doc, fetch the
 *      target page and ask Claude whether it actually attests to the claim in
 *      the surrounding sentence. Catches link rot, drift, and references that
 *      no longer support the claim they're attached to.
 *   2. Recency check — ask Claude (with the web_search tool) to look for
 *      recent developments that would contradict or update claims in the doc.
 *      Designed to catch "this was true when the draft was written two weeks
 *      ago, but isn't anymore" situations.
 */

// Skip these hosts during link verification — they're either internal or
// don't make sense to verify in this workflow.
var SKIP_LINK_HOSTS = {
  '80000hours.org': true,
  'www.80000hours.org': true,
  'docs.google.com': true,
  'drive.google.com': true,
  'accounts.google.com': true
};

var MAX_FETCHED_CHARS = 40000;
var MAX_CONTEXT_CHARS = 600;

// HTTP statuses that mean "we can't read this page" rather than "the page is
// gone": auth walls, anti-bot blocks, rate limits, generic forbiddens. The
// link is probably fine; we just couldn't verify it.
var UNVERIFIABLE_HTTP_STATUSES = {
  401: true,
  402: true,
  403: true,
  407: true,
  429: true,
  451: true
};

// ---------------------------------------------------------------------------
// Link enumeration
// ---------------------------------------------------------------------------

/**
 * Return every external, verifiable hyperlink in the document with the
 * sentence-ish context around it. Internal/Epoch links and non-HTTP schemes
 * are skipped.
 */
function getDocumentExternalLinks() {
  var body = getActiveBody_();
  var paragraphs = body.getParagraphs();
  var links = [];
  var seen = {};

  for (var pi = 0; pi < paragraphs.length; pi++) {
    var para = paragraphs[pi];
    var text = para.editAsText();
    var content = text.getText();
    if (!content) continue;

    // 1. Native Google Docs hyperlinks
    var i = 0;
    while (i < content.length) {
      var url = text.getLinkUrl(i);
      if (url) {
        var start = i;
        while (i < content.length && text.getLinkUrl(i) === url) i++;
        var anchor = content.substring(start, i);
        if (shouldVerifyLink_(url)) {
          var key = url + ':' + pi + ':' + start;
          if (!seen[key]) {
            seen[key] = true;
            links.push({
              index: links.length,
              url: url,
              anchorText: anchor,
              paragraphIndex: pi,
              anchorStart: start,
              anchorEnd: i,
              paragraphText: content,
              context: extractContext_(content, start, i)
            });
          }
        }
      } else {
        i++;
      }
    }

    // 2. Markdown-format links: [anchor](url) — catches links written as
    //    plain markdown text, including those produced by the link
    //    suggester's "Apply" action. Dedupe against native hyperlinks
    //    above so we don't verify the same URL twice.
    var mdRegex = /\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g;
    var match;
    while ((match = mdRegex.exec(content)) !== null) {
      var mdUrl = match[2];
      var mdAnchor = match[1];
      var mdStart = match.index;
      var mdEnd = mdStart + match[0].length;
      if (!shouldVerifyLink_(mdUrl)) continue;

      // Skip if anything inside this span is already a native hyperlink to
      // the same URL — the applyLink helper produces this exact pattern.
      var alreadyLinked = false;
      for (var p = mdStart; p < mdEnd && p < content.length; p++) {
        if (text.getLinkUrl(p) === mdUrl) { alreadyLinked = true; break; }
      }
      if (alreadyLinked) continue;

      var mdKey = mdUrl + ':' + pi + ':' + mdStart;
      if (seen[mdKey]) continue;
      seen[mdKey] = true;
      links.push({
        index: links.length,
        url: mdUrl,
        anchorText: mdAnchor,
        paragraphIndex: pi,
        anchorStart: mdStart,
        anchorEnd: mdEnd,
        paragraphText: content,
        context: extractContext_(content, mdStart, mdEnd)
      });
    }
  }

  return links;
}

function shouldVerifyLink_(url) {
  if (!url) return false;
  if (!/^https?:\/\//i.test(url)) return false;
  var m = url.match(/^https?:\/\/([^\/]+)/i);
  if (!m) return false;
  var host = m[1].toLowerCase();
  if (SKIP_LINK_HOSTS[host]) return false;
  return true;
}

function extractContext_(paragraphText, start, end) {
  var ctxStart = Math.max(0, start - MAX_CONTEXT_CHARS / 2);
  var ctxEnd = Math.min(paragraphText.length, end + MAX_CONTEXT_CHARS / 2);

  // Expand to sentence-ish boundaries
  var pre = paragraphText.substring(ctxStart, start);
  var preMatch = pre.match(/[.!?]\s[^.!?]*$/);
  if (preMatch) ctxStart = ctxStart + preMatch.index + 2;

  var post = paragraphText.substring(end, ctxEnd);
  var postMatch = post.match(/^[^.!?]*[.!?]/);
  if (postMatch) ctxEnd = end + postMatch[0].length;

  return paragraphText.substring(ctxStart, ctxEnd).trim();
}

// ---------------------------------------------------------------------------
// Link verification
// ---------------------------------------------------------------------------

/**
 * Fetch the target URL and use Claude to decide whether the page actually
 * attests to the claim made in the surrounding doc text. Returns
 * { status, explanation, fetchedStatus, fetchedTitle, url, anchorText }.
 *
 * status values:
 *   - "ok"            — target clearly supports the claim
 *   - "partial"       — target is related but doesn't clearly support the claim
 *   - "mismatch"      — target does not support (or contradicts) the claim
 *   - "broken"        — fetch failed (404, timeout, 5xx, network error)
 *   - "unverifiable"  — fetch was blocked (paywall, anti-bot 403, 429, etc.)
 *                       — link is probably fine, we just can't read it
 *   - "unknown"       — Claude couldn't tell from the fetched content
 *   - "error"         — internal error (bad config, API failure)
 */
function verifyLink(index) {
  var links = getDocumentExternalLinks();
  if (index < 0 || index >= links.length) {
    return { status: 'error', explanation: 'Link index out of range.' };
  }
  var link = links[index];

  var fetched = fetchUrlText_(link.url);
  if (fetched.error) {
    return {
      status: fetched.unverifiable ? 'unverifiable' : 'broken',
      explanation: fetched.error,
      fetchedStatus: fetched.statusCode || null,
      url: link.url,
      anchorText: link.anchorText
    };
  }

  var llm = runLinkVerificationLLM(link, fetched);
  return Object.assign({
    url: link.url,
    anchorText: link.anchorText,
    fetchedStatus: fetched.statusCode,
    fetchedTitle: fetched.title
  }, llm);
}

/**
 * Select the anchor text in the doc so the user can see which link this card
 * refers to. Takes the position directly from the sidebar (which stored it
 * at enumeration time) so we can skip a full re-enumeration — that round-trip
 * alone costs ~10-20s on a long document.
 */
function navigateToLink(paragraphIndex, anchorStart, anchorEnd, anchorText) {
  var doc = DocumentApp.getActiveDocument();
  var body = getActiveBody_();
  var paragraphs = body.getParagraphs();
  if (paragraphIndex == null || paragraphIndex >= paragraphs.length) return false;

  var paragraph = paragraphs[paragraphIndex];
  var textElement = paragraph.editAsText();
  var content = textElement.getText();

  var start = anchorStart;
  var end = anchorEnd;
  // Fall back to anchorText search if the position no longer lines up (the
  // doc may have shifted since enumeration).
  if (start == null || end == null ||
      start < 0 || end > content.length ||
      content.substring(start, end) !== anchorText) {
    if (!anchorText) return false;
    start = content.indexOf(anchorText);
    if (start === -1) return false;
    end = start + anchorText.length;
  }

  var range = doc.newRange()
    .addElement(textElement, start, end - 1)
    .build();
  doc.setSelection(range);
  return true;
}

// ---------------------------------------------------------------------------
// URL fetching + HTML text extraction
// ---------------------------------------------------------------------------

function fetchUrlText_(url) {
  try {
    var response = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      followRedirects: true,
      validateHttpsCertificates: true,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; EpochAI-Addon/1.0; +https://epoch.ai)'
      }
    });
    var status = response.getResponseCode();
    if (status >= 400) {
      return {
        error: 'HTTP ' + status,
        statusCode: status,
        unverifiable: !!UNVERIFIABLE_HTTP_STATUSES[status]
      };
    }

    var contentType = response.getHeaders()['Content-Type'] || response.getHeaders()['content-type'] || '';
    if (contentType && !/text|html|xml|json/i.test(contentType)) {
      return { error: 'Non-text content: ' + contentType, statusCode: status, unverifiable: true };
    }

    var html = response.getContentText();
    var title = extractTitle_(html);
    var text = stripHtml_(html);
    var truncated = false;
    if (text.length > MAX_FETCHED_CHARS) {
      text = text.substring(0, MAX_FETCHED_CHARS) + '…';
      truncated = true;
    }
    return { statusCode: status, title: title, text: text, truncated: truncated };
  } catch (e) {
    // Network errors (DNS, TLS, timeout) are also recoverable for the human
    // reader — flag them as unverifiable rather than broken.
    return { error: 'Fetch failed: ' + e.message, unverifiable: true };
  }
}

function extractTitle_(html) {
  var m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m) return '';
  return decodeHtmlEntities_(m[1].replace(/\s+/g, ' ').trim());
}

function stripHtml_(html) {
  // Remove script/style/nav/footer blocks entirely
  var cleaned = html.replace(/<(script|style|noscript|nav|footer|header|aside)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  // Drop all remaining tags
  cleaned = cleaned.replace(/<[^>]+>/g, ' ');
  cleaned = decodeHtmlEntities_(cleaned);
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  return cleaned;
}

function decodeHtmlEntities_(s) {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, function(_, n) { return String.fromCharCode(parseInt(n, 10)); })
    .replace(/&#x([0-9a-f]+);/gi, function(_, h) { return String.fromCharCode(parseInt(h, 16)); });
}

// ---------------------------------------------------------------------------
// Navigate to a recency-check claim
// ---------------------------------------------------------------------------

/**
 * Find and select the given claim text in the document. Claude is told to
 * quote from the draft but may paraphrase, so we fall back through
 * progressively looser matches: full string → first 40 chars → first 20.
 */
function navigateToClaim(claimText) {
  if (!claimText) return false;
  var body = DocumentApp.getActiveDocument().getBody();
  var paragraphs = body.getParagraphs();

  var attempts = [
    claimText,
    claimText.substring(0, 60),
    claimText.substring(0, 40),
    claimText.substring(0, 25)
  ];

  for (var a = 0; a < attempts.length; a++) {
    var needle = attempts[a].trim();
    if (needle.length < 12) continue;
    for (var p = 0; p < paragraphs.length; p++) {
      var textElement = paragraphs[p].editAsText();
      var content = textElement.getText();
      var idx = content.indexOf(needle);
      if (idx === -1) continue;
      var range = DocumentApp.getActiveDocument().newRange()
        .addElement(textElement, idx, idx + needle.length - 1)
        .build();
      DocumentApp.getActiveDocument().setSelection(range);
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Recency check
// ---------------------------------------------------------------------------

/**
 * Ask Claude (with the web_search tool enabled) whether any recent
 * developments would contradict or update claims in the document. Returns an
 * array of findings.
 */
function runRecencyCheckFromSidebar() {
  var documentText = getDocumentText();
  return runRecencyCheck(documentText);
}
