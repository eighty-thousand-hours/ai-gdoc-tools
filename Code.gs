/**
 * 80,000 Hours — Google Docs add-on
 *
 * Editorial tools: style checking, internal link suggestions, research helper,
 * and Substack export.
 */

// ---------------------------------------------------------------------------
// Menu & sidebars
// ---------------------------------------------------------------------------

function onOpen(e) {
  DocumentApp.getUi()
    .createAddonMenu()
    .addItem('📝  Check against style & shortcode guide', 'showStyleSidebar')
    .addItem('✅  Test and fact-check links', 'showLinkVerificationSidebar')
    .addItem('🏛️  Archive external links', 'showLinkArchiverSidebar')
    .addItem('🔗  Suggest internal links', 'showLinksSidebar')
    .addItem('Ⓦ  Prepare for WordPress', 'showMarkdownSidebar')
    .addItem('📅  Flag stale claims', 'showRecencyCheckSidebar')
    .addItem('🗞️  Prepare for Substack', 'showCreateSubstackTabDialog')
    .addToUi();
}

function onInstall(e) {
  onOpen(e);
}

function authorize() {
  Logger.log('Document: ' + DocumentApp.getActiveDocument().getName());
  Logger.log('Scopes authorized.');
}

function showStyleSidebar() {
  var html = HtmlService.createTemplateFromFile('Sidebar');
  html.userEmail = Session.getEffectiveUser().getEmail();
  var output = html.evaluate().setTitle('80k Editorial Tools');
  DocumentApp.getUi().showSidebar(output);
}

function showSidebar() {
  showStyleSidebar();
}

function showLinksSidebar() {
  var html = HtmlService.createTemplateFromFile('LinksSidebar');
  html.userEmail = Session.getEffectiveUser().getEmail();
  var output = html.evaluate().setTitle('80k Editorial Tools');
  DocumentApp.getUi().showSidebar(output);
}

function showLinkVerificationSidebar() {
  var html = HtmlService.createTemplateFromFile('ResearchSidebar');
  html.userEmail = Session.getEffectiveUser().getEmail();
  html.tool = 'links';
  var output = html.evaluate().setTitle('80k Editorial Tools');
  DocumentApp.getUi().showSidebar(output);
}

function showRecencyCheckSidebar() {
  var html = HtmlService.createTemplateFromFile('ResearchSidebar');
  html.userEmail = Session.getEffectiveUser().getEmail();
  html.tool = 'recency';
  var output = html.evaluate().setTitle('80k Editorial Tools');
  DocumentApp.getUi().showSidebar(output);
}

function checkAuth() {
  return true;
}


// ---------------------------------------------------------------------------
// Document reading
// ---------------------------------------------------------------------------

/**
 * Return the body of the *active tab* rather than the whole document.
 *
 * Google Docs now supports multiple tabs in a single document, but the legacy
 * Document.getBody() always returns the first tab's body. Every editorial tool
 * here should operate on whichever tab the editor is currently looking at, so
 * we route all document reads/writes through this helper. Falls back to the
 * plain document body on older Docs that don't expose the tabs API yet.
 */
function getActiveBody_() {
  var doc = DocumentApp.getActiveDocument();
  try {
    var tab = doc.getActiveTab();
    if (tab) return tab.asDocumentTab().getBody();
  } catch (e) {
    // Tabs API unavailable — fall through to the legacy body.
  }
  return doc.getBody();
}

function getDocumentParagraphs() {
  var body = getActiveBody_();
  var paragraphs = body.getParagraphs();
  var result = [];
  for (var i = 0; i < paragraphs.length; i++) {
    var text = paragraphs[i].getText();
    if (text.trim() === '') continue;
    result.push({ text: text, paragraphIndex: i });
  }
  return result;
}

function getDocumentText() {
  return getActiveBody_().getText();
}

// ---------------------------------------------------------------------------
// Text normalization (shared by excerpt/claim matching)
// ---------------------------------------------------------------------------

/**
 * Normalize a string for fuzzy substring matching while keeping a map back to
 * the original character offsets. The LLM (and ASCII-cleaning) frequently
 * returns text with straight quotes, hyphens, and collapsed whitespace where
 * the document has smart quotes, en/em dashes, ellipsis characters, or
 * non-breaking spaces — so an exact indexOf fails even though the text is
 * "the same". This normalizes both sides to a common form.
 *
 * Returns { norm, map } where map[i] is the original index of norm.charAt(i),
 * so a hit in `norm` can be translated back to a precise document range.
 */
function buildNormalizedIndex_(orig) {
  var norm = '';
  var map = [];
  var prevSpace = false;
  for (var i = 0; i < orig.length; i++) {
    var c = orig.charAt(i);
    var rep;
    if (c === '‘' || c === '’' || c === '‚' || c === '‛') rep = "'";
    else if (c === '“' || c === '”' || c === '„' || c === '‟') rep = '"';
    else if (c === '–' || c === '—') rep = '-';
    else if (c === '…') rep = '...';
    else if (c === ' ') rep = ' ';
    else if (/\s/.test(c)) rep = ' ';
    else rep = c;

    if (rep === ' ') {
      if (prevSpace) continue; // collapse runs of whitespace
      prevSpace = true;
      norm += ' ';
      map.push(i);
    } else {
      prevSpace = false;
      for (var k = 0; k < rep.length; k++) {
        norm += rep.charAt(k);
        map.push(i);
      }
    }
  }
  return { norm: norm, map: map };
}

function normalizeString_(s) {
  return s ? buildNormalizedIndex_(s).norm : '';
}

// ---------------------------------------------------------------------------
// Main checking pipeline
// ---------------------------------------------------------------------------

function runChecks(options) {
  options = options || {};
  var variant = normalizeStyleVariant_(options.styleVariant);
  var body = getActiveBody_();
  var paragraphs = body.getParagraphs();
  var issues = [];

  for (var i = 0; i < paragraphs.length; i++) {
    var paragraph = paragraphs[i];
    var text = paragraph.getText();
    if (text.trim() === '') continue;
    var ruleIssues = checkParagraph(text, i, paragraph, variant);
    issues = issues.concat(ruleIssues);
  }

  if (options.useLLM) {
    var llmIssues = runLLMCheck(getDocumentText(), variant);
    issues = issues.concat(llmIssues);
  }

  issues.sort(function(a, b) {
    if (a.paragraphIndex !== b.paragraphIndex) return a.paragraphIndex - b.paragraphIndex;
    return (a.matchStart || 0) - (b.matchStart || 0);
  });

  // Deduplicate: if multiple rules flag the same text span, keep the highest-severity one
  var severityRank = { error: 3, warning: 2, info: 1 };
  var seen = {};
  var deduped = [];
  for (var j = 0; j < issues.length; j++) {
    var issue = issues[j];
    var key = issue.paragraphIndex + ':' + issue.matchStart + ':' + issue.matchEnd;
    if (seen[key]) {
      // Replace if higher severity
      if ((severityRank[issue.severity] || 0) > (severityRank[seen[key].severity] || 0)) {
        deduped[seen[key]._idx] = issue;
      }
    } else {
      issue._idx = deduped.length;
      seen[key] = issue;
      deduped.push(issue);
    }
  }

  return deduped;
}

// ---------------------------------------------------------------------------
// Applying fixes
// ---------------------------------------------------------------------------

/**
 * Resolve the character range of an issue in a paragraph. Prefers the stored
 * matchStart/matchEnd (captured at check time) so we always hit the right
 * occurrence even when the same string appears multiple times in the
 * paragraph. Falls back to indexOf(original) only if the stored range no
 * longer matches — that covers the case where the user has edited the doc
 * since the check ran.
 */
function resolveRange_(paragraph, original, matchStart, matchEnd) {
  var text = paragraph.getText();
  if (matchStart != null && matchEnd != null &&
      matchStart >= 0 && matchEnd <= text.length &&
      text.substring(matchStart, matchEnd) === original) {
    return { start: matchStart, end: matchEnd };
  }
  if (!original) return null;
  var idx = text.indexOf(original);
  if (idx === -1) return null;
  return { start: idx, end: idx + original.length };
}

/**
 * Replace a span of text in a paragraph with the replacement string, while
 * preserving footnotes, hyperlinks, and text formatting on the parts that
 * didn't actually change. Works by computing the longest common prefix and
 * suffix between original and replacement and only editing the delta in the
 * middle. Most editorial fixes (add comma, change symbol, drop periods)
 * touch only a few characters, so the surrounding links/footnotes survive.
 */
function applyFix(paragraphIndex, original, replacement, matchStart, matchEnd) {
  var body = getActiveBody_();
  var paragraphs = body.getParagraphs();
  if (paragraphIndex >= paragraphs.length) return false;

  var paragraph = paragraphs[paragraphIndex];
  var range = resolveRange_(paragraph, original, matchStart, matchEnd);
  if (!range) return false;

  // Longest common prefix
  var pre = 0;
  var maxPre = Math.min(original.length, replacement.length);
  while (pre < maxPre && original.charAt(pre) === replacement.charAt(pre)) pre++;

  // Longest common suffix (not overlapping the prefix we already found)
  var suf = 0;
  var maxSuf = Math.min(original.length - pre, replacement.length - pre);
  while (suf < maxSuf &&
         original.charAt(original.length - 1 - suf) === replacement.charAt(replacement.length - 1 - suf)) {
    suf++;
  }

  var deltaStart = range.start + pre;
  var deltaEnd = range.end - suf; // exclusive
  var insertion = replacement.substring(pre, replacement.length - suf);

  // Safety net for misaligned suggestions: when the replacement shares no
  // common prefix with the original, it may restate text that already sits
  // immediately before the edit point (e.g. an Oxford-comma fix whose excerpt
  // covered only the list's tail but whose suggestion repeated the whole
  // list). Inserting it verbatim would duplicate that leading text, so strip
  // any leading run of the insertion that's already present right before it.
  if (pre === 0 && insertion) {
    var paraText = paragraph.getText();
    var k = Math.min(deltaStart, insertion.length);
    while (k > 0 && paraText.substring(deltaStart - k, deltaStart) !== insertion.substring(0, k)) k--;
    if (k > 0) insertion = insertion.substring(k);
  }

  var textElement = paragraph.editAsText();
  // Remember attributes at the character just before the delta so the
  // inserted text inherits them (style matches the surrounding run).
  var attrAnchor = deltaStart > 0 ? deltaStart - 1 : null;
  var inheritedUrl = attrAnchor != null ? textElement.getLinkUrl(attrAnchor) : null;

  if (deltaEnd > deltaStart) {
    textElement.deleteText(deltaStart, deltaEnd - 1);
  }
  if (insertion) {
    textElement.insertText(deltaStart, insertion);
    if (inheritedUrl) {
      textElement.setLinkUrl(deltaStart, deltaStart + insertion.length - 1, inheritedUrl);
    }
  }
  return true;
}

function highlightText(paragraphIndex, original, color, matchStart, matchEnd) {
  var body = getActiveBody_();
  var paragraphs = body.getParagraphs();
  if (paragraphIndex >= paragraphs.length) return false;

  var paragraph = paragraphs[paragraphIndex];
  var range = resolveRange_(paragraph, original, matchStart, matchEnd);
  if (!range) return false;

  paragraph.editAsText().setBackgroundColor(range.start, range.end - 1, color);
  return true;
}

function removeHighlight(paragraphIndex, original, matchStart, matchEnd) {
  return highlightText(paragraphIndex, original, '#ffffff', matchStart, matchEnd);
}

/**
 * Highlight text with a background color and select it to scroll into view.
 */
function highlightAndSelect(paragraphIndex, original, matchStart, matchEnd) {
  highlightText(paragraphIndex, original, '#F4CCCC', matchStart, matchEnd);
  return selectText(paragraphIndex, original, matchStart, matchEnd);
}

/**
 * Scroll to an issue by selecting it in the document. We deliberately rely on
 * the native selection (cursor) highlight rather than painting a red
 * background: the background lingered after Apply/Dismiss and editors found it
 * noisy. The selection alone shows exactly where the issue is. `prev` is kept
 * for signature compatibility with the sidebar (no longer needs clearing).
 */
function navigateToIssue(prev, next) {
  if (!next) return false;
  return selectText(next.paragraphIndex, next.original, next.matchStart, next.matchEnd);
}

/**
 * Select the matched text in the document, scrolling the viewport to it.
 */
function selectText(paragraphIndex, original, matchStart, matchEnd) {
  var doc = DocumentApp.getActiveDocument();
  var body = getActiveBody_();
  var paragraphs = body.getParagraphs();
  if (paragraphIndex >= paragraphs.length) return false;

  var paragraph = paragraphs[paragraphIndex];
  var range = resolveRange_(paragraph, original, matchStart, matchEnd);
  if (!range) return false;

  var textElement = paragraph.editAsText();
  var docRange = doc.newRange()
    .addElement(textElement, range.start, range.end - 1)
    .build();
  doc.setSelection(docRange);
  return true;
}

// ---------------------------------------------------------------------------
// LLM check (called separately from sidebar for async loading)
// ---------------------------------------------------------------------------

function runLLMCheckFromSidebar(styleVariant) {
  return runLLMCheck(getDocumentText(), normalizeStyleVariant_(styleVariant));
}

// ---------------------------------------------------------------------------
// Internal link suggestions
// ---------------------------------------------------------------------------

/**
 * Get all existing links in the document, so the LLM can avoid re-suggesting them.
 */
function getExistingLinks() {
  var body = getActiveBody_();
  var links = [];
  var numChildren = body.getNumChildren();

  for (var i = 0; i < numChildren; i++) {
    var child = body.getChild(i);
    if (child.getType() !== DocumentApp.ElementType.PARAGRAPH) continue;

    var text = child.editAsText();
    var content = text.getText();
    if (!content) continue;

    var j = 0;
    while (j < content.length) {
      var url = text.getLinkUrl(j);
      if (url) {
        var start = j;
        while (j < content.length && text.getLinkUrl(j) === url) j++;
        links.push({ url: url, text: content.substring(start, j) });
      } else {
        j++;
      }
    }
  }
  return links;
}

function suggestLinks() {
  var documentText = getDocumentText();
  var existingLinks = getExistingLinks();
  return runLinkSuggestion(documentText, existingLinks);
}

/**
 * Wrap a text span in [text](url) markdown syntax AND apply the actual
 * hyperlink to the text portion. The doc shows `[anchor](https://…)` with
 * "anchor" being a real clickable link, so the markdown is preserved if the
 * doc is later exported as plain text or converted to markdown.
 *
 * Uses the stored matchStart/matchEnd so we target the right occurrence even
 * when the excerpt appears multiple times.
 */
function applyLink(paragraphIndex, linkText, url, matchStart, matchEnd) {
  var body = getActiveBody_();
  var paragraphs = body.getParagraphs();
  if (paragraphIndex >= paragraphs.length) return false;

  var paragraph = paragraphs[paragraphIndex];
  var range = resolveRange_(paragraph, linkText, matchStart, matchEnd);
  if (!range) return false;

  var text = paragraph.editAsText();
  // Insert the markdown brackets around the original text.
  text.insertText(range.start, '[');
  text.insertText(range.end + 1, '](' + url + ')');
  // Apply the hyperlink to just the text portion (between the brackets).
  text.setLinkUrl(range.start + 1, range.end, url);
  return true;
}

/**
 * Clear previous highlight + highlight and scroll to new link suggestion.
 */
function navigateToSuggestion(prev, next) {
  if (prev && prev.original) {
    highlightText(prev.paragraphIndex, prev.original, '#ffffff', prev.matchStart, prev.matchEnd);
  }
  if (!next) return false;
  highlightText(next.paragraphIndex, next.original, '#D4EDDA', next.matchStart, next.matchEnd);
  return selectText(next.paragraphIndex, next.original, next.matchStart, next.matchEnd);
}

// ---------------------------------------------------------------------------
// Related work suggestions
// ---------------------------------------------------------------------------

function suggestRelatedWork() {
  var documentText = getDocumentText();
  return runRelatedWorkSuggestion(documentText);
}

/**
 * Insert a relatedWork path into the frontmatter section of the document.
 * Looks for "relatedWork:" in the first 30 paragraphs. If found, appends
 * "  - /path" on the next line. If not found, appends "relatedWork:\n  - /path"
 * after the last frontmatter field.
 */
function applyRelatedWork(path) {
  var body = getActiveBody_();
  var paragraphs = body.getParagraphs();
  var limit = Math.min(paragraphs.length, 30);
  var NORMAL = DocumentApp.ParagraphHeading.NORMAL;

  // Find existing relatedWork field
  for (var i = 0; i < limit; i++) {
    var text = paragraphs[i].getText();
    if (text.match(/^relatedWork\s*:/)) {
      // Find the last "  - ..." entry after relatedWork:
      var insertAfter = i;
      for (var j = i + 1; j < limit; j++) {
        var nextText = paragraphs[j].getText();
        if (nextText.match(/^\s+-\s/)) {
          insertAfter = j;
        } else {
          break;
        }
      }
      var p = body.insertParagraph(insertAfter + 1, '  - ' + path);
      p.setHeading(NORMAL);
      p.editAsText().setFontSize(10);
      return true;
    }
  }

  // relatedWork field not found — create it after the last metadata-looking line
  var lastMetaLine = -1;
  for (var k = 0; k < limit; k++) {
    var kText = paragraphs[k].getText();
    if (kText.match(/^\w[\w\s]*:/) || kText.match(/^\s+-\s/)) {
      lastMetaLine = k;
    } else if (lastMetaLine > 0 && kText.trim() === '') {
      break; // end of frontmatter block
    }
  }

  if (lastMetaLine >= 0) {
    var p2 = body.insertParagraph(lastMetaLine + 1, '  - ' + path);
    p2.setHeading(NORMAL);
    p2.editAsText().setFontSize(10);
    var p1 = body.insertParagraph(lastMetaLine + 1, 'relatedWork:');
    p1.setHeading(NORMAL);
    p1.editAsText().setFontSize(10);
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Admin settings — see configureLLM() in ClaudeAPI.gs
// ---------------------------------------------------------------------------

