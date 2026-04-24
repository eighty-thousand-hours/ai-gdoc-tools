/**
 * Epoch AI — Research helper
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
  'epoch.ai': true,
  'www.epoch.ai': true,
  'epochai.org': true,
  'www.epochai.org': true,
  'docs.google.com': true,
  'drive.google.com': true,
  'accounts.google.com': true
};

var MAX_FETCHED_CHARS = 20000;
var MAX_CONTEXT_CHARS = 600;

// ---------------------------------------------------------------------------
// Link enumeration
// ---------------------------------------------------------------------------

/**
 * Return every external, verifiable hyperlink in the document with the
 * sentence-ish context around it. Internal/Epoch links and non-HTTP schemes
 * are skipped.
 */
function getDocumentExternalLinks() {
  var body = DocumentApp.getActiveDocument().getBody();
  var paragraphs = body.getParagraphs();
  var links = [];

  for (var pi = 0; pi < paragraphs.length; pi++) {
    var para = paragraphs[pi];
    var text = para.editAsText();
    var content = text.getText();
    if (!content) continue;

    var i = 0;
    while (i < content.length) {
      var url = text.getLinkUrl(i);
      if (url) {
        var start = i;
        while (i < content.length && text.getLinkUrl(i) === url) i++;
        var anchor = content.substring(start, i);
        if (shouldVerifyLink_(url)) {
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
      } else {
        i++;
      }
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
 *   - "ok"        — target clearly supports the claim
 *   - "partial"   — target is related but doesn't clearly support the claim
 *   - "mismatch"  — target does not support (or contradicts) the claim
 *   - "broken"    — fetch failed (404, timeout, 403, etc.)
 *   - "unknown"   — Claude couldn't tell from the fetched content
 *   - "error"     — internal error (bad config, API failure)
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
      status: 'broken',
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
 * refers to. Uses the stored anchorStart position rather than indexOf so we
 * hit the right occurrence even when the anchor word appears elsewhere in
 * the paragraph.
 */
function navigateToLink(index) {
  var links = getDocumentExternalLinks();
  if (index < 0 || index >= links.length) return false;
  var link = links[index];
  var doc = DocumentApp.getActiveDocument();
  var body = doc.getBody();
  var paragraphs = body.getParagraphs();
  if (link.paragraphIndex >= paragraphs.length) return false;

  var paragraph = paragraphs[link.paragraphIndex];
  var textElement = paragraph.editAsText();
  var content = textElement.getText();

  var start = link.anchorStart;
  var end = link.anchorEnd;
  // Guard against the document having shifted since enumeration.
  if (start == null || end == null ||
      start < 0 || end > content.length ||
      content.substring(start, end) !== link.anchorText) {
    start = content.indexOf(link.anchorText);
    if (start === -1) return false;
    end = start + link.anchorText.length;
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
      return { error: 'HTTP ' + status, statusCode: status };
    }

    var contentType = response.getHeaders()['Content-Type'] || response.getHeaders()['content-type'] || '';
    if (contentType && !/text|html|xml|json/i.test(contentType)) {
      return { error: 'Non-text content: ' + contentType, statusCode: status };
    }

    var html = response.getContentText();
    var title = extractTitle_(html);
    var text = stripHtml_(html);
    if (text.length > MAX_FETCHED_CHARS) {
      text = text.substring(0, MAX_FETCHED_CHARS) + '…';
    }
    return { statusCode: status, title: title, text: text };
  } catch (e) {
    return { error: 'Fetch failed: ' + e.message };
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
