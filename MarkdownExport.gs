/**
 * 80,000 Hours — Markdown export
 *
 * Two flavours:
 *   1. convertDocToMarkdown() — returns the doc as a Markdown string for copying
 *   2. createEmptyMarkdownTab() / fillCreatedMarkdownTab() — creates a new tab
 *      in the same Google Doc with markdown markers added in-place. Heading
 *      paragraphs keep their native HEADING1/2/etc. styling; the title and
 *      subtitle are left untouched (no `#` added).
 *
 * MVP coverage: headings, paragraphs, bold/italic/strikethrough, hyperlinks,
 * bulleted/numbered lists with nesting, basic tables, horizontal rules,
 * native Google Docs footnotes (converted to [fn N]…[/fn] shortcodes), and
 * inline images (uploaded to the WordPress media library if WP_BASE_URL +
 * WP_CREDENTIALS are set in Script Properties; otherwise replaced with a
 * `[image]` placeholder).
 *
 * Reuses tab utilities from SubstackTab.gs (getActiveTab_, getUniqueTabTitle_,
 * addDocumentTabViaApi_, waitForTabByTitle_, clearBody_, removeLeadingEmptyParagraph_).
 */

function showMarkdownSidebar() {
  var html = HtmlService.createTemplateFromFile('MarkdownSidebar');
  html.userEmail = Session.getEffectiveUser().getEmail();
  var output = html.evaluate().setTitle('80k Editorial Tools');
  DocumentApp.getUi().showSidebar(output);
}

// ---------------------------------------------------------------------------
// String output (for the sidebar textarea)
// ---------------------------------------------------------------------------

function convertDocToMarkdown() {
  var body = getActiveBody_();
  var fnState = { nextNumber: 1, definitions: [], warnings: [], imageCount: 0 };
  var pieces = [];
  var n = body.getNumChildren();
  var prevType = null;
  var listGlyphType = null;
  var listCounter = 0;
  var skipIndex = -1;

  for (var i = 0; i < n; i++) {
    if (i === skipIndex) continue;
    var child = body.getChild(i);
    var type = child.getType();
    var content = '';

    if (type === DocumentApp.ElementType.PARAGRAPH) {
      // Image-only paragraph + italic next paragraph = figure with caption
      if (isImageOnlyParagraph_(child)) {
        var nextChild = (i + 1 < n) ? body.getChild(i + 1) : null;
        if (nextChild && nextChild.getType() === DocumentApp.ElementType.PARAGRAPH && isItalicCaption_(nextChild)) {
          content = imageParagraphWithCaptionToFigure_(child, nextChild, fnState) || paragraphToMarkdown_(child, fnState);
          skipIndex = i + 1;
        } else {
          content = paragraphToMarkdown_(child, fnState);
        }
      } else {
        content = paragraphToMarkdown_(child, fnState);
      }
      listCounter = 0;
    } else if (type === DocumentApp.ElementType.LIST_ITEM) {
      var li = listItemToMarkdown_(child, listGlyphType, listCounter, fnState);
      content = li.text;
      listGlyphType = li.glyphType;
      listCounter = li.counter;
    } else if (type === DocumentApp.ElementType.TABLE) {
      content = tableToMarkdown_(child);
      listCounter = 0;
    } else if (type === DocumentApp.ElementType.HORIZONTAL_RULE) {
      content = '---';
      listCounter = 0;
    }

    if (content === '' && type !== DocumentApp.ElementType.PARAGRAPH) continue;

    if (pieces.length > 0) {
      var sep = (prevType === DocumentApp.ElementType.LIST_ITEM && type === DocumentApp.ElementType.LIST_ITEM) ? '\n' : '\n\n';
      pieces.push(sep);
    }
    pieces.push(content);
    prevType = type;
  }

  // Append footnote definitions at the bottom
  for (var f = 0; f < fnState.definitions.length; f++) {
    var d = fnState.definitions[f];
    pieces.push('\n\n[fn ' + d.number + ']\n' + d.contents + '\n[/fn]');
  }

  return pieces.join('').replace(/\n{3,}/g, '\n\n').trim();
}

// ---------------------------------------------------------------------------
// New-tab output (preserves heading styles)
// ---------------------------------------------------------------------------

function createEmptyMarkdownTab() {
  var doc = DocumentApp.getActiveDocument();
  var sourceTab = getActiveTab_(doc);
  var dateTimeStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH.mm');
  var tabTitle = getUniqueTabTitle_(doc, 'WordPress-copyable version ' + dateTimeStr);
  addDocumentTabViaApi_(doc.getId(), tabTitle);
  return {
    docId: doc.getId(),
    tabTitle: tabTitle,
    sourceTabId: sourceTab.getId()
  };
}

function fillCreatedMarkdownTab(context) {
  var doc = DocumentApp.openById(context.docId);
  var sourceTab = doc.getTab(context.sourceTabId).asDocumentTab();
  var sourceBody = sourceTab.getBody();
  var targetTab = waitForTabByTitle_(context.docId, context.tabTitle, 25, 1000).asDocumentTab();
  var targetBody = targetTab.getBody();

  clearBody_(targetBody);
  var fnState = { nextNumber: 1, definitions: [], warnings: [], imageCount: 0 };
  copyBodyAsMarkdown_(sourceBody, targetBody, fnState);
  removeLeadingEmptyParagraph_(targetBody);
  appendFootnoteDefinitions_(targetBody, fnState);

  try { doc.setActiveTab(targetTab.getId()); } catch (e) { /* user can switch manually */ }

  return { tabTitle: context.tabTitle, warnings: fnState.warnings };
}

function copyBodyAsMarkdown_(sourceBody, targetBody, fnState) {
  var n = sourceBody.getNumChildren();
  var listGlyphType = null;
  var listCounter = 0;
  var skipIndex = -1;
  var prevType = null;

  // Markdown needs a BLANK line between block elements for them to render as
  // separate paragraphs / before a list / around a heading. Appending one
  // Google Docs paragraph per block only yields single newlines when pasted,
  // so we emit an empty paragraph between blocks — everywhere a writer would
  // have hit Enter. Consecutive list items are the one exception (they stay
  // tight, matching how lists render).
  function blockSeparator(curType) {
    if (prevType === null) return;
    if (prevType === DocumentApp.ElementType.LIST_ITEM && curType === DocumentApp.ElementType.LIST_ITEM) return;
    var blank = targetBody.appendParagraph('');
    blank.setHeading(DocumentApp.ParagraphHeading.NORMAL);
  }

  for (var i = 0; i < n; i++) {
    if (i === skipIndex) continue;
    var child = sourceBody.getChild(i);
    var type = child.getType();

    if (type === DocumentApp.ElementType.PARAGRAPH) {
      // Image-only paragraph + italic next paragraph = figure with caption
      if (isImageOnlyParagraph_(child)) {
        var nextChild = (i + 1 < n) ? sourceBody.getChild(i + 1) : null;
        if (nextChild && nextChild.getType() === DocumentApp.ElementType.PARAGRAPH && isItalicCaption_(nextChild)) {
          var figure = imageParagraphWithCaptionToFigure_(child, nextChild, fnState);
          if (figure) {
            blockSeparator(type);
            var lines = figure.split('\n');
            for (var fl = 0; fl < lines.length; fl++) {
              var fp = targetBody.appendParagraph(lines[fl]);
              fp.setHeading(DocumentApp.ParagraphHeading.NORMAL);
            }
            skipIndex = i + 1;
            listCounter = 0;
            prevType = type;
            continue;
          }
        }
      }
      blockSeparator(type);
      copyParagraphAsMarkdown_(child, targetBody, fnState);
      listCounter = 0;
      prevType = type;
    } else if (type === DocumentApp.ElementType.LIST_ITEM) {
      blockSeparator(type);
      var li = listItemToMarkdown_(child, listGlyphType, listCounter, fnState);
      var p = targetBody.appendParagraph(li.text);
      p.setHeading(DocumentApp.ParagraphHeading.NORMAL);
      listGlyphType = li.glyphType;
      listCounter = li.counter;
      prevType = type;
    } else if (type === DocumentApp.ElementType.TABLE) {
      blockSeparator(type);
      var rows = tableRowsToMarkdown_(child);
      for (var r = 0; r < rows.length; r++) {
        var rp = targetBody.appendParagraph(rows[r]);
        rp.setHeading(DocumentApp.ParagraphHeading.NORMAL);
      }
      listCounter = 0;
      prevType = type;
    } else if (type === DocumentApp.ElementType.HORIZONTAL_RULE) {
      blockSeparator(type);
      var hr = targetBody.appendParagraph('---');
      hr.setHeading(DocumentApp.ParagraphHeading.NORMAL);
      listCounter = 0;
      prevType = type;
    }
  }
}

function copyParagraphAsMarkdown_(sourceParagraph, targetBody, fnState) {
  var heading = sourceParagraph.getHeading();
  var prefix = headingPrefix_(heading);
  var innerText = elementChildrenToMarkdown_(sourceParagraph, fnState);
  var fullText = prefix + innerText;

  var p = targetBody.appendParagraph(fullText);
  try { p.setHeading(heading); } catch (e) { /* unsupported heading — leave as default */ }
}

function appendFootnoteDefinitions_(targetBody, fnState) {
  if (!fnState || fnState.definitions.length === 0) return;

  var blank = targetBody.appendParagraph('');
  blank.setHeading(DocumentApp.ParagraphHeading.NORMAL);

  for (var i = 0; i < fnState.definitions.length; i++) {
    var fn = fnState.definitions[i];
    var openP = targetBody.appendParagraph('[fn ' + fn.number + ']');
    openP.setHeading(DocumentApp.ParagraphHeading.NORMAL);

    var blocks = fn.contents.split('\n\n');
    for (var b = 0; b < blocks.length; b++) {
      if (blocks[b].trim() === '') continue;
      var bp = targetBody.appendParagraph(blocks[b]);
      bp.setHeading(DocumentApp.ParagraphHeading.NORMAL);
    }

    var closeP = targetBody.appendParagraph('[/fn]');
    closeP.setHeading(DocumentApp.ParagraphHeading.NORMAL);
  }
}

// ---------------------------------------------------------------------------
// Element converters
// ---------------------------------------------------------------------------

function paragraphToMarkdown_(paragraph, fnState) {
  var heading = paragraph.getHeading();
  var prefix = headingPrefix_(heading);
  var inner = elementChildrenToMarkdown_(paragraph, fnState);
  if (!inner && !prefix) return '';
  return prefix + inner;
}

function headingPrefix_(heading) {
  // TITLE and SUBTITLE are left untouched — no markdown `#` prefix needed
  if (heading === DocumentApp.ParagraphHeading.HEADING1) return '# ';
  if (heading === DocumentApp.ParagraphHeading.HEADING2) return '## ';
  if (heading === DocumentApp.ParagraphHeading.HEADING3) return '### ';
  if (heading === DocumentApp.ParagraphHeading.HEADING4) return '#### ';
  if (heading === DocumentApp.ParagraphHeading.HEADING5) return '##### ';
  if (heading === DocumentApp.ParagraphHeading.HEADING6) return '###### ';
  return '';
}

/**
 * Walk the children of a Paragraph or ListItem element, converting TEXT
 * children to markdown markers and FOOTNOTE children to [fn N] markers
 * (whose contents get accumulated in fnState.definitions).
 */
function elementChildrenToMarkdown_(element, fnState) {
  var pieces = [];
  var n = element.getNumChildren();
  for (var i = 0; i < n; i++) {
    var child = element.getChild(i);
    var type = child.getType();

    if (type === DocumentApp.ElementType.TEXT) {
      pieces.push(textElementToMarkdown_(child.asText()));
    } else if (type === DocumentApp.ElementType.FOOTNOTE) {
      pieces.push(footnoteToMarker_(child.asFootnote(), fnState));
    } else if (type === DocumentApp.ElementType.INLINE_IMAGE) {
      pieces.push(inlineImageToMarkdown_(child.asInlineImage(), fnState));
    }
    // EQUATION, INLINE_DRAWING, PAGE_BREAK — skipped for MVP
  }
  return pieces.join('');
}

// ---------------------------------------------------------------------------
// Image handling — uploads to WordPress media library if configured
// ---------------------------------------------------------------------------

var IMAGE_SIZE_WARN_BYTES = 3 * 1024 * 1024; // 3 MB
var IMAGE_DIM_WARN_PX = 5000;

function inlineImageToMarkdown_(image, state) {
  var alt = '';
  try { alt = image.getAltDescription() || image.getAltTitle() || ''; } catch (e) {}
  alt = alt.replace(/\]/g, '');

  var blob = image.getBlob();
  var bytes = blob.getBytes();

  // Flag oversized images so the user can swap them out before publishing.
  if (state && state.warnings) {
    state.imageCount = (state.imageCount || 0) + 1;
    var notes = [];
    if (bytes.length > IMAGE_SIZE_WARN_BYTES) {
      notes.push((bytes.length / (1024 * 1024)).toFixed(1) + ' MB');
    }
    var dims = getImageDimensions_(bytes);
    if (dims && (dims.width > IMAGE_DIM_WARN_PX || dims.height > IMAGE_DIM_WARN_PX)) {
      notes.push(dims.width + '×' + dims.height + ' px');
    }
    if (notes.length > 0) {
      var label = 'Image ' + state.imageCount + ': ' + notes.join(', ');
      if (alt) label += ' (alt: "' + alt + '")';
      state.warnings.push(label);
    }
  }

  var result;
  try {
    result = uploadImageToWordPress_(blob);
  } catch (e) {
    Logger.log('Image upload failed: ' + e.message);
    result = { url: '', error: e.message };
  }

  if (result && result.url) return '![' + alt + '](' + result.url + ')';
  var errMsg = result && result.error ? result.error : 'unknown';
  return '[image — upload failed: ' + errMsg + (alt ? ' — alt: ' + alt : '') + ']';
}

/**
 * Best-effort dimension parsing from raw image bytes. Handles PNG, JPEG,
 * and GIF — covers ~99% of doc images. Returns null for other formats.
 */
function getImageDimensions_(bytes) {
  if (!bytes || bytes.length < 24) return null;
  function u(i) { return bytes[i] & 0xff; }

  // PNG: 89 50 4E 47 ... IHDR width@16-19, height@20-23 (BE u32)
  if (u(0) === 0x89 && u(1) === 0x50 && u(2) === 0x4E && u(3) === 0x47) {
    var w = (u(16) << 24) | (u(17) << 16) | (u(18) << 8) | u(19);
    var h = (u(20) << 24) | (u(21) << 16) | (u(22) << 8) | u(23);
    return { width: w, height: h };
  }

  // GIF: 'GIF87a'/'GIF89a' then width@6-7, height@8-9 (LE u16)
  if (u(0) === 0x47 && u(1) === 0x49 && u(2) === 0x46) {
    return { width: u(6) | (u(7) << 8), height: u(8) | (u(9) << 8) };
  }

  // JPEG: FF D8 ... walk markers until SOFn (C0-C3, C5-C7, C9-CB, CD-CF)
  if (u(0) === 0xFF && u(1) === 0xD8) {
    var i = 2;
    while (i < bytes.length - 8) {
      if (u(i) !== 0xFF) { i++; continue; }
      var marker = u(i + 1);
      i += 2;
      if ((marker & 0xF0) === 0xC0 && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
        // segLen u16 BE @ i, precision @ i+2, height u16 BE @ i+3, width u16 BE @ i+5
        return {
          width: (u(i + 5) << 8) | u(i + 6),
          height: (u(i + 3) << 8) | u(i + 4)
        };
      }
      var segLen = (u(i) << 8) | u(i + 1);
      if (segLen < 2) return null;
      i += segLen;
    }
  }

  return null;
}

/**
 * Upload an image blob to WordPress media library, returning its public URL.
 * Caches the hash→URL mapping in ScriptProperties so once an image is
 * uploaded, it's never uploaded again (even months later, across users).
 * Returns empty string if not configured or on error.
 *
 * Script Properties required:
 *   WP_BASE_URL      — e.g. https://80000hours.org
 *   WP_CREDENTIALS  — username:application_password
 */
function uploadImageToWordPress_(blob) {
  var props = PropertiesService.getScriptProperties();
  var baseUrl = (props.getProperty('WP_BASE_URL') || '').replace(/\/$/, '');
  var credentials = (props.getProperty('WP_CREDENTIALS') || '').trim();
  if (!baseUrl) return { url: '', error: 'WP_BASE_URL not set in Script Properties' };
  if (!credentials) return { url: '', error: 'WP_CREDENTIALS not set in Script Properties' };

  var bytes = blob.getBytes();
  var contentType = blob.getContentType() || 'image/png';
  var hash = bytesMd5Hex_(bytes);
  var propKey = 'wp_image_' + hash;

  var cached = props.getProperty(propKey);
  if (cached) return { url: cached };

  var ext = '.png';
  if (contentType.indexOf('jpeg') !== -1 || contentType.indexOf('jpg') !== -1) ext = '.jpg';
  else if (contentType.indexOf('gif') !== -1) ext = '.gif';
  else if (contentType.indexOf('webp') !== -1) ext = '.webp';
  else if (contentType.indexOf('svg') !== -1) ext = '.svg';
  var name = 'gdoc-image-' + hash.substring(0, 12) + ext;

  var endpoint = baseUrl + '/wp-json/wp/v2/media';

  try {
    var response = UrlFetchApp.fetch(endpoint, {
      method: 'post',
      contentType: contentType,
      headers: {
        'Authorization': 'Basic ' + Utilities.base64Encode(credentials),
        'Content-Disposition': 'attachment; filename="' + name + '"',
        'User-Agent': 'curl/7.64.1',
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip, deflate'
      },
      payload: bytes,
      muteHttpExceptions: true
    });
    var code = response.getResponseCode();
    if (code !== 201 && code !== 200) {
      Logger.log('WP image upload failed: HTTP ' + code + ' — ' + response.getContentText().substring(0, 300));
      return { url: '', error: 'HTTP ' + code };
    }
    var body = JSON.parse(response.getContentText());
    var url = body.source_url || (body.guid && body.guid.rendered) || '';
    if (url) cacheImageUrl_(propKey, url);
    return { url: url };
  } catch (e) {
    Logger.log('WP image upload exception: ' + e.message);
    return { url: '', error: e.message.substring(0, 100) };
  }
}

/**
 * Set an image cache entry, auto-clearing all wp_image_* entries if we hit the
 * ScriptProperties 500KB quota. Future exports of previously-cached images
 * will then re-upload (creating duplicate files in WordPress) — acceptable
 * tradeoff for not having to manually maintain the cache.
 */
function cacheImageUrl_(propKey, url) {
  var props = PropertiesService.getScriptProperties();
  try {
    props.setProperty(propKey, url);
    return;
  } catch (e) {
    if (!/quota|limit|exceed|too large/i.test(e.message || '')) {
      Logger.log('Image cache write failed (non-quota): ' + e.message);
      return;
    }
    Logger.log('Image cache full — auto-clearing and retrying. ' + e.message);
  }

  clearImageUploadCache();
  try {
    props.setProperty(propKey, url);
  } catch (e2) {
    Logger.log('Image cache write still failing after auto-clear: ' + e2.message);
  }
}

/**
 * Clear all cached image upload mappings. Run from the script editor if
 * media URLs change or you want to force re-upload.
 */
function clearImageUploadCache() {
  var props = PropertiesService.getScriptProperties();
  var all = props.getProperties();
  var deleted = 0;
  for (var key in all) {
    if (key.indexOf('wp_image_') === 0) {
      props.deleteProperty(key);
      deleted++;
    }
  }
  Logger.log('Cleared ' + deleted + ' cached image URL(s).');
  return deleted;
}

function bytesMd5Hex_(bytes) {
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, bytes);
  var hex = '';
  for (var i = 0; i < digest.length; i++) {
    var b = digest[i] & 0xff;
    hex += (b < 16 ? '0' : '') + b.toString(16);
  }
  return hex;
}

/**
 * Debug helper for the sidebar — checks whether the WordPress media endpoint
 * accepts our credentials by making a GET request.
 */
function getWordPressUploadDebug() {
  var props = PropertiesService.getScriptProperties();
  var baseUrl = (props.getProperty('WP_BASE_URL') || '').replace(/\/$/, '');
  var credentials = (props.getProperty('WP_CREDENTIALS') || '').trim();
  if (!baseUrl) return { ok: false, error: 'WP_BASE_URL not set in Script Properties.' };
  if (!credentials) return { ok: false, error: 'WP_CREDENTIALS not set in Script Properties.' };

  // Sanity-check credentials format without revealing the password
  if (credentials.indexOf(':') === -1) {
    return { ok: false, error: 'WP_CREDENTIALS missing colon. Format should be: username:password' };
  }
  var colonIdx = credentials.indexOf(':');
  var usernamePart = credentials.substring(0, colonIdx);
  var passwordPart = credentials.substring(colonIdx + 1);
  var info = {
    baseUrl: baseUrl,
    username: usernamePart,
    passwordLength: passwordPart.length,
    passwordSpaces: (passwordPart.match(/ /g) || []).length,
    passwordPreview: passwordPart.substring(0, 4) + '…' + passwordPart.substring(passwordPart.length - 4)
  };

  // Hit /users/me — smaller payload than /media, returns user info on success
  try {
    var response = UrlFetchApp.fetch(baseUrl + '/wp-json/wp/v2/users/me', {
      method: 'get',
      headers: {
        'Authorization': 'Basic ' + Utilities.base64Encode(credentials),
        'User-Agent': 'curl/7.64.1',
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip, deflate'
      },
      muteHttpExceptions: true
    });
    var code = response.getResponseCode();
    var body = response.getContentText();
    var headers = {};
    try { headers = response.getAllHeaders(); } catch (e) {}

    // Pick out interesting headers that might reveal which plugin is intercepting
    var interesting = {};
    var keys = Object.keys(headers);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i].toLowerCase();
      if (k.indexOf('x-') === 0 || k === 'server' || k === 'set-cookie' || k === 'www-authenticate') {
        interesting[keys[i]] = (typeof headers[keys[i]] === 'string')
          ? headers[keys[i]].substring(0, 120)
          : JSON.stringify(headers[keys[i]]).substring(0, 120);
      }
    }

    if (code === 200) {
      var user;
      try { user = JSON.parse(body); } catch (e) {}
      return {
        ok: true,
        message: 'Auth OK — logged in as ' + (user && user.name ? user.name : 'unknown'),
        info: info,
        responseHeaders: interesting
      };
    }

    return {
      ok: false,
      error: 'HTTP ' + code,
      body: body.substring(0, 600),
      info: info,
      responseHeaders: interesting
    };
  } catch (e) {
    return { ok: false, error: e.message, info: info };
  }
}

function footnoteToMarker_(footnote, fnState) {
  if (!fnState) return '';
  var number = fnState.nextNumber++;
  var contents = '';
  try {
    contents = footnoteContentsToMarkdown_(footnote.getFootnoteContents());
  } catch (e) {
    Logger.log('Footnote contents error: ' + e.message);
  }
  fnState.definitions.push({ number: number, contents: contents });
  return '[fn ' + number + ']';
}

function footnoteContentsToMarkdown_(section) {
  if (!section) return '';
  var n = section.getNumChildren();
  var pieces = [];
  // Footnotes can't contain footnotes, so a dummy state is fine here
  var dummyState = { nextNumber: 999, definitions: [] };
  var listGlyphType = null;
  var listCounter = 0;

  for (var i = 0; i < n; i++) {
    var child = section.getChild(i);
    var type = child.getType();
    if (type === DocumentApp.ElementType.PARAGRAPH) {
      var p = paragraphToMarkdown_(child, dummyState);
      if (p) pieces.push(p);
      listCounter = 0;
    } else if (type === DocumentApp.ElementType.LIST_ITEM) {
      var li = listItemToMarkdown_(child, listGlyphType, listCounter, dummyState);
      if (li.text) pieces.push(li.text);
      listGlyphType = li.glyphType;
      listCounter = li.counter;
    }
  }
  return pieces.join('\n\n').trim();
}

function textElementToMarkdown_(textElement) {
  var text = textElement.getText();
  if (!text) return '';

  var indices;
  try {
    indices = textElement.getTextAttributeIndices();
  } catch (e) {
    return text;
  }
  if (!indices || indices.length === 0) indices = [0];
  indices.push(text.length);

  var pieces = [];
  for (var i = 0; i < indices.length - 1; i++) {
    var start = indices[i];
    var end = indices[i + 1];
    if (end <= start) continue;

    var raw = text.substring(start, end);
    if (raw === '') continue;

    var attrs;
    try { attrs = textElement.getAttributes(start); } catch (e) { attrs = {}; }

    var bold = attrs[DocumentApp.Attribute.BOLD];
    var italic = attrs[DocumentApp.Attribute.ITALIC];
    var strikethrough = attrs[DocumentApp.Attribute.STRIKETHROUGH];
    var url = attrs[DocumentApp.Attribute.LINK_URL];

    // Wrap markers around the visible portion only — Markdown won't render
    // `** word**` so leading/trailing whitespace must stay outside the wrappers.
    var match = raw.match(/^(\s*)(.*?)(\s*)$/);
    var lead = match ? match[1] : '';
    var core = match ? match[2] : raw;
    var trail = match ? match[3] : '';

    if (core) {
      if (strikethrough) core = '~~' + core + '~~';
      if (bold && italic) core = '***' + core + '***';
      else if (bold) core = '**' + core + '**';
      else if (italic) core = '*' + core + '*';
      if (url) core = '[' + core + '](' + url + ')';
    }

    pieces.push(lead + core + trail);
  }

  return pieces.join('');
}

function listItemToMarkdown_(item, prevGlyphType, prevCounter, fnState) {
  var glyphType = item.getGlyphType();
  var nestingLevel = item.getNestingLevel() || 0;
  var indent = '';
  for (var n = 0; n < nestingLevel; n++) indent += '  ';

  var counter = prevCounter || 0;
  var prefix;

  var isNumbered = (
    glyphType === DocumentApp.GlyphType.NUMBER ||
    glyphType === DocumentApp.GlyphType.LATIN_UPPER ||
    glyphType === DocumentApp.GlyphType.LATIN_LOWER ||
    glyphType === DocumentApp.GlyphType.ROMAN_UPPER ||
    glyphType === DocumentApp.GlyphType.ROMAN_LOWER
  );

  if (isNumbered) {
    counter = (glyphType === prevGlyphType && nestingLevel === 0) ? counter + 1 : 1;
    prefix = counter + '. ';
  } else {
    prefix = '* ';
    counter = 0;
  }

  return {
    text: indent + prefix + elementChildrenToMarkdown_(item, fnState),
    glyphType: glyphType,
    counter: counter
  };
}

function tableToMarkdown_(table) {
  return tableRowsToMarkdown_(table).join('\n');
}

function tableRowsToMarkdown_(table) {
  var numRows = table.getNumRows();
  if (numRows === 0) return [];

  var rows = [];
  for (var r = 0; r < numRows; r++) {
    var row = table.getRow(r);
    var cells = [];
    for (var c = 0; c < row.getNumCells(); c++) {
      var cellText = row.getCell(c).getText().replace(/\|/g, '\\|').replace(/\n+/g, ' ').trim();
      cells.push(cellText);
    }
    rows.push('| ' + cells.join(' | ') + ' |');
    if (r === 0) {
      var sep = [];
      for (var s = 0; s < cells.length; s++) sep.push('---');
      rows.push('| ' + sep.join(' | ') + ' |');
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Image + caption (figure HTML)
// ---------------------------------------------------------------------------

function isImageOnlyParagraph_(paragraph) {
  if (paragraph.getNumChildren() === 0) return false;
  var hasImage = false;
  var n = paragraph.getNumChildren();
  for (var i = 0; i < n; i++) {
    var child = paragraph.getChild(i);
    var type = child.getType();
    if (type === DocumentApp.ElementType.INLINE_IMAGE) {
      hasImage = true;
    } else if (type === DocumentApp.ElementType.TEXT) {
      var t = child.asText().getText();
      if (t && t.trim() !== '') return false;
    }
  }
  return hasImage;
}

function isItalicCaption_(paragraph) {
  var heading = paragraph.getHeading();
  if (heading && heading !== DocumentApp.ParagraphHeading.NORMAL) return false;
  var text = paragraph.editAsText();
  var content = text.getText();
  if (!content || content.trim() === '') return false;
  var sawItalic = false;
  for (var i = 0; i < content.length; i++) {
    if (content.charAt(i).match(/\S/)) {
      try {
        if (!text.isItalic(i)) return false;
      } catch (e) { return false; }
      sawItalic = true;
    }
  }
  return sawItalic;
}

function imageParagraphWithCaptionToFigure_(imgPara, capPara, state) {
  var image = null;
  var n = imgPara.getNumChildren();
  for (var i = 0; i < n; i++) {
    var child = imgPara.getChild(i);
    if (child.getType() === DocumentApp.ElementType.INLINE_IMAGE) {
      image = child.asInlineImage();
      break;
    }
  }
  if (!image) return null;

  var alt = '';
  try { alt = image.getAltDescription() || image.getAltTitle() || ''; } catch (e) {}

  var blob = image.getBlob();
  var bytes = blob.getBytes();

  var caption = capPara.getText().trim();

  if (state && state.warnings) {
    state.imageCount = (state.imageCount || 0) + 1;
    var notes = [];
    if (bytes.length > IMAGE_SIZE_WARN_BYTES) notes.push((bytes.length / (1024 * 1024)).toFixed(1) + ' MB');
    var dims = getImageDimensions_(bytes);
    if (dims && (dims.width > IMAGE_DIM_WARN_PX || dims.height > IMAGE_DIM_WARN_PX)) {
      notes.push(dims.width + '×' + dims.height + ' px');
    }
    if (notes.length > 0) {
      var label = 'Image ' + state.imageCount + ': ' + notes.join(', ');
      if (caption) label += ' — caption: "' + caption.substring(0, 80) + (caption.length > 80 ? '…' : '') + '"';
      else if (alt) label += ' (alt: "' + alt + '")';
      state.warnings.push(label);
    }
  }

  var result;
  try { result = uploadImageToWordPress_(blob); } catch (e) { result = { url: '', error: e.message }; }

  if (result && result.url) {
    return [
      '<figure class="wp-caption">',
      '<img src="' + result.url + '" alt="' + escAttr_(alt) + '">',
      '<figcaption>' + escHtml_(caption) + '</figcaption>',
      '</figure>'
    ].join('\n');
  }
  var errMsg = result && result.error ? result.error : 'unknown';
  return '[image — upload failed: ' + errMsg + ']\n_' + caption + '_';
}

function escHtml_(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escAttr_(s) {
  return escHtml_(s).replace(/"/g, '&quot;');
}
