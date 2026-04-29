/**
 * Epoch AI — Metadata generation
 *
 * Finds the metadata table in the active document (typically in a dedicated
 * "Metadata" tab) and auto-fills empty fields: Tags, HTML title, HTML meta.
 * Per the 2026-04-24 meeting with Elliot, the workflow is hybrid: humans fill
 * in fields that matter; the automation fills the rest as sensible defaults
 * that can be overridden.
 */

// Field labels we know how to populate. Keys are canonical names; values are
// regex fragments matched against the label cell's first line (case-insensitive).
// Patterns end at a word boundary so labels like "Tags (any number of tags)"
// or "Meta description (optional for authors; ops can fill this in)" still
// resolve to the canonical field — the parenthetical is treated as a hint to
// authors, not part of the field name.
var METADATA_FIELDS = {
  tags: /^(tags?|topics?)\b/i,
  htmlTitle: /^(html\s*title|seo\s*title|title\s*\(html\)|title\s*tag)\b/i,
  htmlMeta: /^(html\s*meta|meta\s*description|seo\s*description|description\s*\(html\)|meta)\b/i
};

// ---------------------------------------------------------------------------
// Locating the metadata table
// ---------------------------------------------------------------------------

/**
 * Search all tabs (and top-level body) for a table whose rows look like
 * metadata rows. Returns { tabId, tabName, tableIndex, rows } or { error }.
 *
 * rows is an array of { rowIndex, field, label, currentValue }.
 */
function findMetadataTable_() {
  var doc = DocumentApp.getActiveDocument();
  var candidates = [];

  // Collect (body, tabId, tabName) triples to search.
  if (doc.getTabs) {
    var tabs = doc.getTabs();
    if (tabs && tabs.length) {
      for (var i = 0; i < tabs.length; i++) {
        var tab = tabs[i];
        var docTab = tab.asDocumentTab && tab.asDocumentTab();
        if (docTab) {
          candidates.push({ tabId: tab.getId(), tabName: tab.getTitle(), body: docTab.getBody() });
        }
      }
    }
  }
  if (candidates.length === 0) {
    candidates.push({ tabId: null, tabName: null, body: doc.getBody() });
  }

  // Prefer tabs titled "metadata" (or containing "meta").
  candidates.sort(function(a, b) {
    var score = function(c) {
      if (!c.tabName) return 0;
      if (/^metadata$/i.test(c.tabName)) return 3;
      if (/meta/i.test(c.tabName)) return 2;
      return 1;
    };
    return score(b) - score(a);
  });

  for (var c = 0; c < candidates.length; c++) {
    var cand = candidates[c];
    var tables = cand.body.getTables();
    for (var t = 0; t < tables.length; t++) {
      var rows = matchMetadataRows_(tables[t]);
      if (rows.length >= 2) {
        return {
          tabId: cand.tabId,
          tabName: cand.tabName,
          tableIndex: t,
          rows: rows
        };
      }
    }
  }

  return { error: 'No metadata table found. Expected a table with rows like "Tags", "HTML title", "HTML meta" (typically in a tab called "Metadata").' };
}

function matchMetadataRows_(table) {
  var matched = [];
  var numRows = table.getNumRows();
  for (var r = 0; r < numRows; r++) {
    var row = table.getRow(r);
    if (row.getNumCells() < 2) continue;
    var fullLabel = row.getCell(0).getText().trim();
    if (!fullLabel) continue;
    // Match only against the first line — Epoch's templates put the field
    // name on line 1 and helper text ("Please use available tags…") in
    // subsequent paragraphs of the same cell.
    var firstLine = fullLabel.split(/\n+/)[0].trim();
    var field = null;
    for (var k in METADATA_FIELDS) {
      if (METADATA_FIELDS[k].test(firstLine)) {
        field = k;
        break;
      }
    }
    if (!field) continue;
    matched.push({
      rowIndex: r,
      field: field,
      label: firstLine,
      currentValue: row.getCell(1).getText().trim()
    });
  }
  return matched;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Return the current state of the metadata table (or an error hint if it
 * can't be located).
 */
function getMetadataState() {
  var found = findMetadataTable_();
  if (found.error) return { error: found.error };
  return {
    tabName: found.tabName,
    rows: found.rows.map(function(r) {
      return { field: r.field, label: r.label, currentValue: r.currentValue };
    })
  };
}

/**
 * Generate proposed values for each metadata field from the document text.
 * Returns { proposals: { tags, htmlTitle, htmlMeta } } or { error }.
 */
function generateMetadataProposals() {
  var documentText = getDocumentText();
  var found = findMetadataTable_();
  if (found.error) return { error: found.error };

  var availableTags = getAvailableTags_();
  return runMetadataGeneration(documentText, availableTags, found.rows);
}

/**
 * Write a proposed value into the matching row of the metadata table.
 * overwrite = false means "only write if the cell is empty".
 */
function applyMetadataField(field, value, overwrite) {
  if (!field || value == null) return { error: 'Missing field/value.' };

  var found = findMetadataTable_();
  if (found.error) return { error: found.error };

  var targetRow = null;
  for (var i = 0; i < found.rows.length; i++) {
    if (found.rows[i].field === field) {
      targetRow = found.rows[i];
      break;
    }
  }
  if (!targetRow) return { error: 'Field not present in metadata table: ' + field };

  if (!overwrite && targetRow.currentValue) {
    return { skipped: true, reason: 'Cell is non-empty.' };
  }

  var table = resolveTable_(found);
  if (!table) return { error: 'Could not re-resolve metadata table.' };

  var cell = table.getRow(targetRow.rowIndex).getCell(1);
  cell.clear();
  cell.editAsText().setText(value);
  return { ok: true };
}

function resolveTable_(found) {
  var doc = DocumentApp.getActiveDocument();
  var body;
  if (found.tabId && doc.getTabs) {
    var tabs = doc.getTabs();
    for (var i = 0; i < tabs.length; i++) {
      if (tabs[i].getId() === found.tabId) {
        body = tabs[i].asDocumentTab().getBody();
        break;
      }
    }
  }
  if (!body) body = doc.getBody();
  var tables = body.getTables();
  return tables[found.tableIndex] || null;
}

/**
 * Extract the deduplicated list of tags used across the site catalog, so the
 * LLM can pick only from tags that actually exist on the site.
 */
function getAvailableTags_() {
  var catalog = getCatalog();
  var seen = {};
  var tags = [];
  for (var i = 0; i < catalog.length; i++) {
    if (!catalog[i].tags) continue;
    var parts = catalog[i].tags.split(',');
    for (var j = 0; j < parts.length; j++) {
      var tag = parts[j].trim();
      if (!tag) continue;
      if (!seen[tag]) {
        seen[tag] = true;
        tags.push(tag);
      }
    }
  }
  tags.sort();
  return tags;
}
