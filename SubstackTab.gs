/**
 * 80,000 Hours — Substack export
 *
 * Creates a new Google Doc tab with content reformatted for pasting into
 * Substack. Converts footnotes to [fn:N] markers and adds metadata for the
 * 80k Substack Helper Chrome extension.
 */

const SUBSTACK_EXPORT_START = 'SUBSTACK_EXPORT_DATA_START';
const SUBSTACK_EXPORT_END = 'SUBSTACK_EXPORT_DATA_END';
const SUBSTACK_HELPER_NAME = '80k Substack Helper Chrome extension';

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

function showCreateSubstackTabDialog() {
  var html = HtmlService.createHtmlOutputFromFile('SubstackSidebar').setTitle('80k Editorial Tools');
  DocumentApp.getUi().showSidebar(html);
}

// ---------------------------------------------------------------------------
// Tab creation (two-phase: create shell, then fill)
// ---------------------------------------------------------------------------

function createEmptySubstackCopyableTab() {
  const doc = DocumentApp.getActiveDocument();
  const sourceTab = getActiveTab_(doc);

  const dateTimeStr = Utilities.formatDate(
    new Date(),
    Session.getScriptTimeZone(),
    'yyyy-MM-dd HH.mm'
  );

  const tabTitle = getUniqueTabTitle_(
    doc,
    'Substack-copyable version ' + dateTimeStr
  );

  addDocumentTabViaApi_(doc.getId(), tabTitle);

  return {
    docId: doc.getId(),
    tabTitle: tabTitle,
    sourceTabId: sourceTab.getId(),
    sourceTabTitle: getTabTitleSafe_(sourceTab),
    sourceTitle: doc.getName()
  };
}

function fillCreatedSubstackCopyableTab(context) {
  const doc = DocumentApp.openById(context.docId);

  const sourceTab = doc.getTab(context.sourceTabId).asDocumentTab();
  const sourceBody = sourceTab.getBody();

  const targetTab = waitForTabByTitle_(
    context.docId,
    context.tabTitle,
    25,
    1000
  ).asDocumentTab();

  const targetBody = targetTab.getBody();

  clearBody_(targetBody);

  const state = {
    sourceTitle: context.sourceTitle,
    sourceTabTitle: context.sourceTabTitle,
    targetTabTitle: context.tabTitle,
    createdAt: new Date().toISOString(),
    substackTitle: '',
    footnotes: {},
    nextFootnoteNumber: 1,
    warnings: [],
    stats: {
      footnotes: 0,
      tables: 0,
      images: 0,
      possibleInternalLinks: 0
    }
  };

  appendInstructionHeader_(targetBody);
  copyBodyForSubstack_(sourceBody, targetBody, state);
  removeLeadingEmptyParagraph_(targetBody);

  const titleInfo = findTitleHeadingInfo_(targetBody);
  state.substackTitle = titleInfo ? titleInfo.text : '';

  appendMetadataBlock_(targetBody, state);

  try {
    doc.setActiveTab(targetTab.getId());
  } catch (error) {
    // Non-fatal — tab was filled; user can click it manually.
  }

  return {
    tabTitle: context.tabTitle,
    stats: state.stats,
    warnings: state.warnings
  };
}

// ---------------------------------------------------------------------------
// Tab utilities
// ---------------------------------------------------------------------------

function getActiveTab_(doc) {
  try {
    return doc.getActiveTab();
  } catch (error) {
    return doc.getTabs()[0];
  }
}

function getTabTitleSafe_(tab) {
  try {
    return tab.getTitle();
  } catch (error) {
    return '';
  }
}

function getUniqueTabTitle_(doc, baseTitle) {
  const existing = getAllTabs_(doc).map(function(tab) {
    return tab.getTitle();
  });

  if (existing.indexOf(baseTitle) === -1) return baseTitle;

  for (let i = 2; i < 100; i++) {
    const candidate = baseTitle + ' (' + i + ')';
    if (existing.indexOf(candidate) === -1) return candidate;
  }

  return baseTitle + ' (' + new Date().getTime() + ')';
}

function getAllTabs_(doc) {
  const all = [];

  function addTabs(tabs) {
    tabs.forEach(function(tab) {
      all.push(tab);
      const children = tab.getChildTabs();
      if (children && children.length) addTabs(children);
    });
  }

  addTabs(doc.getTabs());
  return all;
}

function addDocumentTabViaApi_(docId, title) {
  const url =
    'https://docs.googleapis.com/v1/documents/' +
    encodeURIComponent(docId) +
    ':batchUpdate';

  const payload = {
    requests: [{ addDocumentTab: { tabProperties: { title: title } } }]
  };

  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const status = response.getResponseCode();
  const body = response.getContentText();

  if (status < 200 || status >= 300) {
    throw new Error('Failed to create Google Doc tab. HTTP ' + status + ':\n\n' + body);
  }

  return JSON.parse(body);
}

function waitForTabByTitle_(docId, title, maxAttempts, delayMs) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const doc = DocumentApp.openById(docId);
    const tabs = getAllTabs_(doc);
    for (let i = 0; i < tabs.length; i++) {
      if (tabs[i].getTitle() === title) return tabs[i];
    }
    Utilities.sleep(delayMs);
  }

  throw new Error(
    'Created a tab named "' + title + '", but Apps Script could not access it yet. ' +
    'Reload the Google Doc and check whether the tab exists. If it exists but is empty, rerun the tool.'
  );
}

// ---------------------------------------------------------------------------
// Body manipulation
// ---------------------------------------------------------------------------

function clearBody_(body) {
  while (body.getNumChildren() > 1) {
    body.removeChild(body.getChild(0));
  }

  const lastChild = body.getChild(0);
  if (lastChild.getType() === DocumentApp.ElementType.PARAGRAPH) {
    lastChild.asParagraph().clear();
    return;
  }

  body.appendParagraph('');
  body.removeChild(lastChild);
}

function removeLeadingEmptyParagraph_(body) {
  while (body.getNumChildren() > 1) {
    const firstChild = body.getChild(0);
    if (firstChild.getType() !== DocumentApp.ElementType.PARAGRAPH) return;

    const p = firstChild.asParagraph();
    const hasNoText = p.getText().trim() === '';
    const hasOnlyEmptyText =
      p.getNumChildren() === 0 ||
      (p.getNumChildren() === 1 &&
        p.getChild(0).getType() === DocumentApp.ElementType.TEXT &&
        p.getChild(0).asText().getText() === '');

    if (!hasNoText || !hasOnlyEmptyText) return;
    body.removeChild(firstChild);
  }
}

function appendInstructionHeader_(body) {
  const header = body.getParent().getHeader() || body.getParent().addHeader();
  header.clear();
  const p = header.appendParagraph(
    'Instructions: copy this whole tab, paste it into the Substack editor, then run the 80k Substack Helper Chrome extension'
  );
  p.setBold(false);
  p.setBackgroundColor('#fafa5f');
}

// ---------------------------------------------------------------------------
// Content copying
// ---------------------------------------------------------------------------

function copyBodyForSubstack_(sourceBody, targetBody, state) {
  const childCount = sourceBody.getNumChildren();

  for (let i = 0; i < childCount; i++) {
    const child = sourceBody.getChild(i);
    const type = child.getType();

    if (type === DocumentApp.ElementType.PARAGRAPH) {
      copyParagraphLikeElement_(child.asParagraph(), targetBody, state, 'paragraph');
    } else if (type === DocumentApp.ElementType.LIST_ITEM) {
      copyParagraphLikeElement_(child.asListItem(), targetBody, state, 'listItem');
    } else if (type === DocumentApp.ElementType.TABLE) {
      state.stats.tables += 1;
      state.warnings.push('Table copied. Check whether it pasted cleanly into Substack or needs Datawrapper.');
      targetBody.appendTable(child.asTable().copy());
    } else if (type === DocumentApp.ElementType.HORIZONTAL_RULE) {
      targetBody.appendHorizontalRule();
    } else if (type === DocumentApp.ElementType.PAGE_BREAK) {
      targetBody.appendPageBreak();
    } else {
      state.warnings.push('Skipped unsupported top-level element: ' + type);
    }
  }
}

function copyParagraphLikeElement_(source, targetBody, state, mode) {
  const target =
    mode === 'listItem'
      ? targetBody.appendListItem('')
      : targetBody.appendParagraph('');

  copyParagraphStyle_(source, target, mode);

  try {
    if (
      target.getNumChildren() === 1 &&
      target.getChild(0).getType() === DocumentApp.ElementType.TEXT &&
      target.getChild(0).asText().getText() === ''
    ) {
      target.removeChild(target.getChild(0));
    }
  } catch (error) {}

  const count = source.getNumChildren();
  for (let i = 0; i < count; i++) {
    const child = source.getChild(i);
    const type = child.getType();

    if (type === DocumentApp.ElementType.TEXT) {
      appendStyledText_(target, child.asText(), state);
    } else if (type === DocumentApp.ElementType.FOOTNOTE) {
      target.appendText(convertFootnoteToMarker_(child.asFootnote(), state));
    } else if (type === DocumentApp.ElementType.INLINE_IMAGE) {
      state.stats.images += 1;
      target.appendInlineImage(child.asInlineImage().copy());
    } else {
      state.warnings.push('Skipped unsupported inline element: ' + type);
    }
  }
}

function copyParagraphStyle_(source, target, mode) {
  try { target.setAttributes(source.getAttributes()); } catch (e) {}
  try { target.setHeading(source.getHeading()); } catch (e) {}
  try { target.setAlignment(source.getAlignment()); } catch (e) {}
  if (mode === 'listItem') {
    try { target.setGlyphType(source.getGlyphType()); } catch (e) {}
    try { target.setNestingLevel(source.getNestingLevel()); } catch (e) {}
  }
}

function appendStyledText_(target, sourceText, state) {
  const text = sourceText.getText();
  if (!text) return;

  const appended = target.appendText(text);
  const indices = sourceText.getTextAttributeIndices();

  for (let i = 0; i < indices.length; i++) {
    const start = indices[i];
    const end = i + 1 < indices.length ? indices[i + 1] - 1 : text.length - 1;
    const attrs = sourceText.getAttributes(start);

    try { appended.setAttributes(start, end, attrs); } catch (e) {}

    const url = attrs[DocumentApp.Attribute.LINK_URL];
    if (url && isPossibleInternalSectionLink_(url)) {
      state.stats.possibleInternalLinks += 1;
      state.warnings.push('Possible internal section link detected: ' + url + '. Check after pasting into Substack.');
    }
  }
}

function isPossibleInternalSectionLink_(url) {
  return /#/.test(url) || /heading=/.test(url) || /bookmark=/i.test(url);
}

// ---------------------------------------------------------------------------
// Footnotes
// ---------------------------------------------------------------------------

function convertFootnoteToMarker_(footnote, state) {
  const number = state.nextFootnoteNumber++;
  const marker = '[fn:' + number + ']';
  state.footnotes[String(number)] = extractFootnoteText_(footnote);
  state.stats.footnotes += 1;
  return marker;
}

function extractFootnoteText_(footnote) {
  try {
    const text = footnote.getFootnoteContents().getText().trim();
    return text || '[Empty footnote]';
  } catch (error) {
    return '[Could not extract footnote text: ' + error.message + ']';
  }
}

// ---------------------------------------------------------------------------
// Title detection
// ---------------------------------------------------------------------------

function findTitleHeadingInfo_(body) {
  const headings = [];

  for (let i = 0; i < body.getNumChildren(); i++) {
    const child = body.getChild(i);
    if (child.getType() !== DocumentApp.ElementType.PARAGRAPH) continue;

    const paragraph = child.asParagraph();
    const text = paragraph.getText().trim();
    if (!text) continue;

    const rank = getHeadingRank_(paragraph.getHeading());
    if (rank === null) continue;

    headings.push({ index: i, rank: rank, text: text });
  }

  if (!headings.length) return null;

  const first = headings[0];
  const isTopLevel = headings.slice(1).every(function(h) { return first.rank < h.rank; });
  return isTopLevel ? first : null;
}

function getHeadingRank_(heading) {
  if (heading === DocumentApp.ParagraphHeading.TITLE) return 0;
  if (heading === DocumentApp.ParagraphHeading.HEADING1) return 1;
  if (heading === DocumentApp.ParagraphHeading.HEADING2) return 2;
  if (heading === DocumentApp.ParagraphHeading.HEADING3) return 3;
  if (heading === DocumentApp.ParagraphHeading.HEADING4) return 4;
  if (heading === DocumentApp.ParagraphHeading.HEADING5) return 5;
  if (heading === DocumentApp.ParagraphHeading.HEADING6) return 6;
  return null;
}

// ---------------------------------------------------------------------------
// Metadata block
// ---------------------------------------------------------------------------

function appendMetadataBlock_(body, state) {
  const metadata = {
    version: 1,
    source: 'google_doc_tab',
    sourceTitle: state.sourceTitle,
    sourceTabTitle: state.sourceTabTitle,
    targetTabTitle: state.targetTabTitle,
    createdAt: state.createdAt,
    substackTitle: state.substackTitle || '',
    footnotes: state.footnotes,
    warnings: state.warnings,
    stats: state.stats
  };

  body.appendParagraph(SUBSTACK_EXPORT_START);
  body.appendParagraph(JSON.stringify(metadata, null, 2));
  body.appendParagraph(SUBSTACK_EXPORT_END);

  if (state.warnings.length) {
    const warningsHeading = body.appendParagraph('QA warnings');
    warningsHeading.setHeading(DocumentApp.ParagraphHeading.HEADING2);
    state.warnings.forEach(function(warning) {
      body.appendListItem(warning);
    });
  }
}
