/**
 * Epoch AI — Image tools
 *
 * Enumerates images in the active document and generates HTML alt descriptions
 * via Claude. Intended to support audio narrations, which rely on alt text to
 * describe charts and figures that are otherwise unintelligible to a listener.
 */

// ---------------------------------------------------------------------------
// Image enumeration
// ---------------------------------------------------------------------------

/**
 * Return a flat list of every inline image in the document, with enough
 * context for the LLM to produce a useful alt description.
 *
 * Each entry includes:
 *   - index: 1-based position in the document's image list (also used to
 *     identify the image in applyAltText and generateAltText)
 *   - altDescription: current alt text (may be empty)
 *   - contentType: image MIME type (e.g. "image/png")
 *   - width/height: pixel dimensions as reported by the image element
 *   - surroundingText: nearby paragraphs joined with newlines, for context
 *   - caption: the paragraph immediately following the image, if any
 */
function getDocumentImages() {
  var body = DocumentApp.getActiveDocument().getBody();
  var images = body.getImages();
  var paragraphs = body.getParagraphs();

  var results = [];
  for (var i = 0; i < images.length; i++) {
    var image = images[i];

    var parentIndex = -1;
    try {
      var parent = findImageParagraph_(image);
      parentIndex = parent ? paragraphs.indexOf(parent) : -1;
    } catch (e) {
      parentIndex = -1;
    }

    var surrounding = [];
    if (parentIndex >= 0) {
      var from = Math.max(0, parentIndex - 3);
      var to = Math.min(paragraphs.length - 1, parentIndex + 3);
      for (var k = from; k <= to; k++) {
        var t = paragraphs[k].getText().trim();
        if (t) surrounding.push(t);
      }
    }

    var caption = '';
    if (parentIndex >= 0 && parentIndex + 1 < paragraphs.length) {
      var nextText = paragraphs[parentIndex + 1].getText().trim();
      if (nextText && /^(figure|fig\.|source|note|chart|graph|image)\b/i.test(nextText)) {
        caption = nextText;
      }
    }

    // Each metadata accessor can throw "Invalid argument: imageId" for
    // non-blob-backed images (linked charts, drawings, etc). Degrade
    // gracefully so one bad image doesn't kill the scan.
    var altDescription = '';
    var contentType = '';
    var width = null;
    var height = null;
    var unavailable = false;
    var unavailableReason = '';

    try {
      altDescription = image.getAltDescription() || '';
    } catch (e) {
      unavailable = true;
      unavailableReason = e.message;
    }
    try {
      contentType = image.getBlob().getContentType();
    } catch (e) {
      unavailable = true;
      unavailableReason = e.message;
    }
    try {
      width = image.getWidth();
    } catch (e) {}
    try {
      height = image.getHeight();
    } catch (e) {}

    results.push({
      index: i,
      altDescription: altDescription,
      contentType: contentType,
      width: width,
      height: height,
      surroundingText: surrounding.join('\n'),
      caption: caption,
      unavailable: unavailable,
      unavailableReason: unavailableReason
    });
  }
  return results;
}

/**
 * Walk the image's ancestor chain and return the enclosing Paragraph element,
 * or null if the image is nested in something other than a paragraph
 * (e.g. a table cell — handled by falling through).
 */
function findImageParagraph_(image) {
  var el = image.getParent();
  while (el) {
    if (el.getType && el.getType() === DocumentApp.ElementType.PARAGRAPH) {
      return el;
    }
    if (!el.getParent) return null;
    el = el.getParent();
  }
  return null;
}

// ---------------------------------------------------------------------------
// Alt-text generation + application
// ---------------------------------------------------------------------------

/**
 * Generate an alt description for a single image, identified by its index in
 * getDocumentImages(). Returns { altDescription, error? }.
 */
function generateAltTextForImage(index) {
  var body = DocumentApp.getActiveDocument().getBody();
  var images = body.getImages();
  if (index < 0 || index >= images.length) {
    return { error: 'Image index out of range: ' + index };
  }

  var image = images[index];
  var meta = getDocumentImages()[index];
  if (meta && meta.unavailable) {
    return { error: 'This image is a linked chart or drawing and cannot be processed: ' + (meta.unavailableReason || 'unknown reason') };
  }

  var blob;
  try {
    blob = image.getBlob();
  } catch (e) {
    return { error: 'Could not read image bytes: ' + e.message };
  }
  return runAltTextGeneration(blob, meta.surroundingText, meta.caption);
}

/**
 * Apply an alt description to a single image. Writes the alt text in two
 * places:
 *
 *   1. As a bracketed paragraph immediately below the image — this is what
 *      Epoch's publication automation reads when converting docs to web
 *      content. Replaces an existing bracketed paragraph if one is already
 *      there (idempotent across repeated Apply clicks).
 *   2. As the image's alt-description metadata — invisible in the doc but
 *      kept in sync for accessibility.
 */
function applyAltTextToImage(index, altDescription) {
  var body = DocumentApp.getActiveDocument().getBody();
  var images = body.getImages();
  if (index < 0 || index >= images.length) return false;

  var alt = (altDescription || '').trim();
  if (!alt) return false;

  var image = images[index];

  // Capture the previous alt text BEFORE overwriting it — we use it below to
  // identify (and replace) a bracketed paragraph we wrote on a prior Apply,
  // without risking clobber of an unrelated bracketed line the user wrote.
  var previousAlt = '';
  try {
    previousAlt = (image.getAltDescription() || '').trim();
  } catch (e) {}

  try {
    image.setAltDescription(alt);
  } catch (e) {
    // Linked drawings/charts may not support setAltDescription; ignore so the
    // bracketed-paragraph write below still runs.
  }

  return writeBracketedAltBelowImage_(image, alt, previousAlt);
}

/**
 * Insert (or update) a paragraph reading "[alt text]" directly below the
 * paragraph that contains the image. We replace an existing paragraph only if
 * its contents match "[<previousAlt>]" — that way repeated Apply clicks stay
 * idempotent without accidentally overwriting unrelated bracketed text the
 * user might have placed there manually (e.g. "[citation needed]").
 */
function writeBracketedAltBelowImage_(image, alt, previousAlt) {
  var paragraph = findImageParagraph_(image);
  if (!paragraph) return false;

  var container = paragraph.getParent();
  if (!container || typeof container.getChildIndex !== 'function' ||
      typeof container.insertParagraph !== 'function') {
    return false;
  }

  var pos = container.getChildIndex(paragraph);
  var bracketed = '[' + alt + ']';

  var nextChild = (pos + 1 < container.getNumChildren()) ? container.getChild(pos + 1) : null;
  if (nextChild && nextChild.getType() === DocumentApp.ElementType.PARAGRAPH) {
    var nextPara = nextChild.asParagraph();
    var nextText = nextPara.getText().trim();
    var prevBracketed = previousAlt ? ('[' + previousAlt + ']') : null;
    if ((prevBracketed && nextText === prevBracketed) || nextText === bracketed) {
      nextPara.clear();
      nextPara.appendText(bracketed);
      return true;
    }
  }

  container.insertParagraph(pos + 1, bracketed);
  return true;
}

/**
 * Select and scroll to an image. Used by the sidebar so the user can see the
 * image they're reviewing.
 */
function navigateToImage(index) {
  var doc = DocumentApp.getActiveDocument();
  var body = doc.getBody();
  var images = body.getImages();
  if (index < 0 || index >= images.length) return false;

  var image = images[index];
  var parent = findImageParagraph_(image);
  if (!parent) return false;

  var range = doc.newRange().addElement(parent).build();
  doc.setSelection(range);
  return true;
}
