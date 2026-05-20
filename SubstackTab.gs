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
  const html = HtmlService.createHtmlOutput(`
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: 'Google Sans', Roboto, Arial, sans-serif; font-size: 13px; color: #202124; padding: 16px; background: #fff; display: flex; flex-direction: column; min-height: 100vh; }
      .header { margin-bottom: 16px; }
      .header h2 { font-size: 16px; font-weight: 500; margin-bottom: 4px; }
      .header .subtitle { font-size: 12px; color: #5f6368; line-height: 1.4; }
      .note { font-size: 12px; font-style: italic; background: #fff8df; padding: 8px 10px; border-radius: 4px; margin-bottom: 12px; color: #5f6368; }
      .controls { display: flex; gap: 8px; margin-bottom: 12px; }
      .btn { padding: 8px 14px; border-radius: 4px; font-size: 13px; font-weight: 500; cursor: pointer; border: none; }
      .btn-primary { background: #1a73e8; color: #fff; }
      .btn-primary:hover { background: #1557b0; }
      .btn-primary:disabled { background: #dadce0; color: #80868b; cursor: default; }
      .status { padding: 8px 12px; border-radius: 4px; font-size: 12px; margin-bottom: 12px; display: none; white-space: pre-line; line-height: 1.5; }
      .status.visible { display: block; }
      .status.running { background: #e8f0fe; color: #1967d2; }
      .status.done { background: #e6f4ea; color: #137333; }
      .status.error { background: #fce8e6; color: #c5221f; }
      .steps { display: none; padding-left: 4px; margin-bottom: 12px; }
      .steps.visible { display: block; }
      .step { font-size: 12px; padding: 4px 0; color: #5f6368; }
      .step.done { color: #137333; }
      .step.running { color: #1967d2; }
      .step.error { color: #c5221f; }
      .footer { margin-top: auto; padding-top: 14px; border-top: 1px solid #dadce0; font-size: 11px; color: #5f6368; text-align: center; line-height: 1.7; }
      .badge { display: inline-block; background: #fef7e0; color: #b06000; font-weight: 600; font-size: 9px; letter-spacing: 0.6px; text-transform: uppercase; padding: 2px 8px; border-radius: 10px; margin-right: 4px; vertical-align: 1px; }
      .footer a { color: #1a73e8; text-decoration: none; }
      pre { white-space: pre-wrap; word-break: break-word; font-size: 11px; background: #fce8e6; color: #c5221f; padding: 8px; border-radius: 4px; }
    </style>
    <div class="header">
      <h2>Prepare for Substack</h2>
      <div class="subtitle">Click this when your draft is ready to post on Substack. Creates a copy in a new tab that you can paste straight into a Substack draft. Once pasted, use the 80k Substack Helper Chrome extension to finish the conversion. <a href="https://docs.google.com/document/d/1u_CIJ0YLvQU1qcJ8z-7dQZ0U-4T9ceP-ytwoTq-6zcQ/edit?tab=t.0#heading=h.j9cvfvsu9lg" target="_blank">Download the extension + full instructions →</a></div>
    </div>

    <div class="note">This tool treats all suggestions in the original tab as accepted.</div>

    <div class="controls">
      <button id="startBtn" class="btn btn-primary" onclick="startSubstack()">Create Substack-ready tab</button>
    </div>

    <div id="status" class="status"></div>

    <div id="steps" class="steps">
      <div class="step" id="step-create">○ Creating new Google Doc tab</div>
      <div class="step" id="step-wait">○ Waiting for Google Docs to register the tab</div>
      <div class="step" id="step-fill">○ Copying article content, converting footnotes, and adding metadata</div>
    </div>

    <div id="result" style="font-size: 12px;"></div>

    <div class="footer">
      <span class="badge">Beta</span>
      Send bugs and ideas to Valerie
    </div>

    <script>
      function setStep(id, state) {
        var el = document.getElementById(id);
        if (!el) return;
        var icons = { running: '◐', done: '✓', error: '✕', pending: '○' };
        var label = el.textContent.replace(/^[◐✓✕○○⬜⏳✅❌] /, '');
        el.textContent = icons[state] + ' ' + label;
        el.className = 'step ' + (state === 'pending' ? '' : state);
      }

      function showStatus(type, msg) {
        var el = document.getElementById('status');
        el.className = 'status visible ' + type;
        el.textContent = msg;
      }

      function setResult(html) {
        document.getElementById('result').innerHTML = html;
      }

      function escapeHtml(value) {
        return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      }

      function startSubstack() {
        var btn = document.getElementById('startBtn');
        btn.disabled = true;
        btn.textContent = 'Working…';
        document.getElementById('steps').className = 'steps visible';
        setStep('step-create', 'running');

        google.script.run
          .withSuccessHandler(function(result) {
            setStep('step-create', 'done');
            setStep('step-wait', 'running');

            setTimeout(function() {
              setStep('step-wait', 'done');
              setStep('step-fill', 'running');

              google.script.run
                .withSuccessHandler(function(finalResult) {
                  setStep('step-fill', 'done');
                  btn.disabled = false;
                  btn.textContent = 'Create another';
                  showStatus('done', 'Done — "' + finalResult.tabTitle + '" created.\n\nOpen it, copy the whole tab, paste into Substack, then run the 80k Substack Helper Chrome extension.');
                  setResult('');
                })
                .withFailureHandler(function(error) {
                  setStep('step-fill', 'error');
                  btn.disabled = false;
                  btn.textContent = 'Try again';
                  showStatus('error', 'Error: ' + (error.message || error));
                  setResult('<pre>' + escapeHtml(error.message) + '</pre>');
                })
                .fillCreatedSubstackCopyableTab(result);
            }, 3000);
          })
          .withFailureHandler(function(error) {
            setStep('step-create', 'error');
            btn.disabled = false;
            btn.textContent = 'Try again';
            showStatus('error', 'Error: ' + (error.message || error));
            setResult('<pre>' + escapeHtml(error.message) + '</pre>');
          })
          .createEmptySubstackCopyableTab();
      }
    </script>
  `).setTitle('80k Editorial Tools');

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
