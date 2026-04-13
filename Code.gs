/**
 * Epoch AI — Google Docs add-on
 *
 * Provides editorial style checking and internal link suggestions.
 */

// ---------------------------------------------------------------------------
// Menu & sidebars
// ---------------------------------------------------------------------------

function onOpen() {
  DocumentApp.getUi()
    .createMenu('Epoch AI')
    .addItem('Check style', 'showStyleSidebar')
    .addItem('Suggest links', 'showLinksSidebar')
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
  var output = html.evaluate().setTitle('Epoch AI — Style checker');
  DocumentApp.getUi().showSidebar(output);
}

function showSidebar() {
  showStyleSidebar();
}

function showLinksSidebar() {
  var html = HtmlService.createTemplateFromFile('LinksSidebar');
  html.userEmail = Session.getEffectiveUser().getEmail();
  var output = html.evaluate().setTitle('Epoch AI — Internal links');
  DocumentApp.getUi().showSidebar(output);
}

function checkAuth() {
  return true;
}


// ---------------------------------------------------------------------------
// Document reading
// ---------------------------------------------------------------------------

function getDocumentParagraphs() {
  var body = DocumentApp.getActiveDocument().getBody();
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
  return DocumentApp.getActiveDocument().getBody().getText();
}

// ---------------------------------------------------------------------------
// Main checking pipeline
// ---------------------------------------------------------------------------

function runChecks(options) {
  options = options || {};
  var paragraphs = getDocumentParagraphs();
  var issues = [];

  for (var i = 0; i < paragraphs.length; i++) {
    var p = paragraphs[i];
    var ruleIssues = checkParagraph(p.text, p.paragraphIndex);
    issues = issues.concat(ruleIssues);
  }

  if (options.useLLM) {
    var llmIssues = runLLMCheck(getDocumentText());
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

function applyFix(paragraphIndex, original, replacement) {
  var body = DocumentApp.getActiveDocument().getBody();
  var paragraphs = body.getParagraphs();
  if (paragraphIndex >= paragraphs.length) return false;

  var paragraph = paragraphs[paragraphIndex];
  var text = paragraph.getText();
  var idx = text.indexOf(original);
  if (idx === -1) return false;

  var textElement = paragraph.editAsText();
  textElement.deleteText(idx, idx + original.length - 1);
  textElement.insertText(idx, replacement);
  return true;
}

function highlightText(paragraphIndex, original, color) {
  var body = DocumentApp.getActiveDocument().getBody();
  var paragraphs = body.getParagraphs();
  if (paragraphIndex >= paragraphs.length) return false;

  var paragraph = paragraphs[paragraphIndex];
  var text = paragraph.getText();
  var idx = text.indexOf(original);
  if (idx === -1) return false;

  paragraph.editAsText().setBackgroundColor(idx, idx + original.length - 1, color);
  return true;
}

function removeHighlight(paragraphIndex, original) {
  return highlightText(paragraphIndex, original, '#ffffff');
}

/**
 * Highlight text with a background color and select it to scroll into view.
 */
function highlightAndSelect(paragraphIndex, original) {
  highlightText(paragraphIndex, original, '#F4CCCC');
  return selectText(paragraphIndex, original);
}

/**
 * Clear previous highlight + highlight and scroll to new issue in a single server call.
 */
function navigateToIssue(prevParagraphIndex, prevOriginal, newParagraphIndex, newOriginal) {
  if (prevOriginal) {
    highlightText(prevParagraphIndex, prevOriginal, '#ffffff');
  }
  highlightText(newParagraphIndex, newOriginal, '#F4CCCC');
  return selectText(newParagraphIndex, newOriginal);
}

/**
 * Select the matched text in the document, scrolling the viewport to it.
 */
function selectText(paragraphIndex, original) {
  var doc = DocumentApp.getActiveDocument();
  var body = doc.getBody();
  var paragraphs = body.getParagraphs();
  if (paragraphIndex >= paragraphs.length) return false;

  var paragraph = paragraphs[paragraphIndex];
  var text = paragraph.getText();
  var idx = text.indexOf(original);
  if (idx === -1) return false;

  var textElement = paragraph.editAsText();
  var range = doc.newRange()
    .addElement(textElement, idx, idx + original.length - 1)
    .build();
  doc.setSelection(range);
  return true;
}

// ---------------------------------------------------------------------------
// LLM check (called separately from sidebar for async loading)
// ---------------------------------------------------------------------------

function runLLMCheckFromSidebar() {
  return runLLMCheck(getDocumentText());
}

// ---------------------------------------------------------------------------
// Internal link suggestions
// ---------------------------------------------------------------------------

/**
 * Get all existing links in the document, so the LLM can avoid re-suggesting them.
 */
function getExistingLinks() {
  var body = DocumentApp.getActiveDocument().getBody();
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
 * Wrap a text span in a hyperlink.
 */
function applyLink(paragraphIndex, linkText, url) {
  var body = DocumentApp.getActiveDocument().getBody();
  var paragraphs = body.getParagraphs();
  if (paragraphIndex >= paragraphs.length) return false;

  var paragraph = paragraphs[paragraphIndex];
  var text = paragraph.getText();
  var idx = text.indexOf(linkText);
  if (idx === -1) return false;

  paragraph.editAsText().setLinkUrl(idx, idx + linkText.length - 1, url);
  return true;
}

/**
 * Clear previous highlight + highlight and scroll to new link suggestion.
 */
function navigateToSuggestion(prevParagraphIndex, prevOriginal, newParagraphIndex, newOriginal) {
  if (prevOriginal) {
    highlightText(prevParagraphIndex, prevOriginal, '#ffffff');
  }
  highlightText(newParagraphIndex, newOriginal, '#D4EDDA');
  return selectText(newParagraphIndex, newOriginal);
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
  var body = DocumentApp.getActiveDocument().getBody();
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

