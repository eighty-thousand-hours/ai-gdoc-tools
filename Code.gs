/**
 * Epoch editorial checker — Google Docs add-on
 */

// ---------------------------------------------------------------------------
// Menu & sidebar
// ---------------------------------------------------------------------------

function onOpen() {
  DocumentApp.getUi()
    .createMenu('Editorial checker')
    .addItem('Check document', 'showSidebar')
    .addToUi();
}

function onInstall(e) {
  onOpen(e);
}

function authorize() {
  Logger.log('Document: ' + DocumentApp.getActiveDocument().getName());
  Logger.log('Scopes authorized.');
}

function showSidebar() {
  var html = HtmlService.createTemplateFromFile('Sidebar');
  html.userEmail = Session.getEffectiveUser().getEmail();
  var output = html.evaluate().setTitle('Epoch editorial checker');
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
// Admin settings — see configureLLM() in ClaudeAPI.gs
// ---------------------------------------------------------------------------

