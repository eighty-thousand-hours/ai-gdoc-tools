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

// A realistic desktop-browser User-Agent. Many sites return 403 to anything
// that looks like a bot/script; sending a normal browser UA clears a chunk of
// those. (It won't get past genuine anti-bot or paywall systems — those are
// reported as "unverifiable" so the editor can check by hand.)
var FETCH_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// Hosts we know block automated fetches outright (login-walled, JS-only, or
// aggressive anti-bot). Don't bother fetching — tell the editor to check the
// link by hand instead of surfacing a confusing 403.
var BLOCKED_FETCH_HOSTS = {
  'x.com': 'X (Twitter)',
  'www.x.com': 'X (Twitter)',
  'twitter.com': 'X (Twitter)',
  'www.twitter.com': 'X (Twitter)',
  'mobile.twitter.com': 'X (Twitter)'
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
  // A generic anchor placed after the claim's full stop ("... signed it.
  // (Source)") would otherwise get a context with no claim in it, so reach
  // back one more sentence when the anchor's own sentence has no lead-in.
  if (preMatch && wordCount_(pre.substring(preMatch.index + 2)) < 4) {
    preMatch = pre.match(/[.!?]\s[^.!?]*[.!?]\s[^.!?]*$/);
  }
  if (preMatch) ctxStart = ctxStart + preMatch.index + 2;

  var post = paragraphText.substring(end, ctxEnd);
  var postMatch = post.match(/^[^.!?]*[.!?]/);
  if (postMatch) ctxEnd = end + postMatch[0].length;

  return paragraphText.substring(ctxStart, ctxEnd).trim();
}

function wordCount_(s) {
  return s.split(/\s+/).filter(function(w) { return /\w/.test(w); }).length;
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
  // Sites that block automated access entirely (X/Twitter, etc.) — skip the
  // fetch and tell the editor to verify manually.
  var hostMatch = url.match(/^https?:\/\/([^\/]+)/i);
  var host = hostMatch ? hostMatch[1].toLowerCase() : '';
  var embedded = fetchOEmbedText_(url, host);
  if (embedded) return embedded;
  if (BLOCKED_FETCH_HOSTS[host]) {
    return {
      error: BLOCKED_FETCH_HOSTS[host] + ' blocks automated link checks — open the link to verify it manually',
      statusCode: null,
      unverifiable: true
    };
  }

  try {
    var response = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      followRedirects: true,
      validateHttpsCertificates: true,
      headers: {
        'User-Agent': FETCH_USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });
    var status = response.getResponseCode();
    if (status >= 400) {
      var unverifiable = !!UNVERIFIABLE_HTTP_STATUSES[status];
      return {
        error: unverifiable
          ? ('Blocked or paywalled (HTTP ' + status + ') — open the link to verify it manually')
          : ('HTTP ' + status),
        statusCode: status,
        unverifiable: unverifiable
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

// X posts and YouTube videos can't be read from their pages (login wall /
// JS-only), but both expose an oEmbed endpoint that returns the post text or
// the video title. Returns null when the URL isn't one of these or the
// endpoint fails, so the caller falls back to its normal handling.
var OEMBED_HOSTS = {
  'x.com': 'x', 'www.x.com': 'x', 'twitter.com': 'x', 'www.twitter.com': 'x', 'mobile.twitter.com': 'x',
  'youtube.com': 'youtube', 'www.youtube.com': 'youtube', 'm.youtube.com': 'youtube', 'youtu.be': 'youtube'
};

function fetchOEmbedText_(url, host) {
  var kind = OEMBED_HOSTS[host];
  if (!kind) return null;
  if (kind === 'x' && !/\/status\/\d+/.test(url)) return null;

  var endpoint = kind === 'x'
    ? 'https://publish.twitter.com/oembed?omit_script=true&url='
    : 'https://www.youtube.com/oembed?format=json&url=';
  try {
    var response = UrlFetchApp.fetch(endpoint + encodeURIComponent(url), {
      muteHttpExceptions: true,
      followRedirects: true
    });
    if (response.getResponseCode() !== 200) return null;
    var data = JSON.parse(response.getContentText());
    if (kind === 'x') {
      return {
        statusCode: 200,
        title: 'Post on X by ' + (data.author_name || 'unknown author'),
        text: stripHtml_(data.html || ''),
        truncated: false
      };
    }
    return {
      statusCode: 200,
      title: data.title || '',
      text: 'YouTube video "' + (data.title || '') + '" from the channel ' + (data.author_name || 'unknown') +
        '. Only the title and channel are available, not the transcript: judge whether this is plausibly the right video, and return "unknown" if the claim depends on what is said in it.',
      truncated: false
    };
  } catch (e) {
    Logger.log('oEmbed fetch failed for ' + url + ': ' + e.message);
    return null;
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
 * Find and select the given claim text in the document.
 *
 * Claude is told to quote the draft verbatim, but two things still break a
 * naive indexOf: (1) the JSON is ASCII-cleaned, so smart quotes, en/em
 * dashes, ellipses, and non-breaking spaces in the draft no longer match;
 * (2) the model sometimes trims or lightly paraphrases. We handle (1) by
 * matching on a normalized form of both the claim and each paragraph (with a
 * map back to real offsets so the selection is precise), and (2) by falling
 * back to progressively shorter leading word-runs of the claim.
 */
function navigateToClaim(claimText) {
  if (!claimText) return false;
  var doc = DocumentApp.getActiveDocument();
  var body = getActiveBody_();
  var paragraphs = body.getParagraphs();

  var needleFull = normalizeString_(claimText).trim();
  if (needleFull.length < 12) return false;

  // Try the whole claim first, then shorter leading word-runs so a paraphrased
  // tail still locates the start of the sentence.
  var words = needleFull.split(' ');
  var needles = [needleFull];
  [14, 10, 7, 5].forEach(function(count) {
    if (words.length > count) needles.push(words.slice(0, count).join(' '));
  });

  for (var p = 0; p < paragraphs.length; p++) {
    var textElement = paragraphs[p].editAsText();
    var content = textElement.getText();
    if (!content) continue;
    var idx = buildNormalizedIndex_(content);

    for (var a = 0; a < needles.length; a++) {
      var needle = needles[a];
      if (needle.length < 12) continue;
      var nPos = idx.norm.indexOf(needle);
      if (nPos === -1) continue;
      var startOrig = idx.map[nPos];
      var endOrig = idx.map[nPos + needle.length - 1] + 1;
      var range = doc.newRange()
        .addElement(textElement, startOrig, endOrig - 1)
        .build();
      doc.setSelection(range);
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
function runRecencyCheckFromSidebar(sinceDate) {
  var documentText = getDocumentText();
  return runRecencyCheck(documentText, sinceDate);
}
