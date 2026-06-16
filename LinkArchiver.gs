/**
 * 80,000 Hours — Archive external links
 *
 * Walks the active doc and replaces every external hyperlink with its
 * Wayback Machine snapshot URL. Looks up the latest snapshot via the
 * public availability API (https://archive.org/wayback/available). When
 * no snapshot exists yet, automatically triggers Save Page Now and uses
 * the freshly-created snapshot. Internal 80k links and existing
 * web.archive.org URLs are skipped.
 *
 * Also handles plain-text markdown-style links: [anchor](url).
 *
 * unarchiveLinks() reverses the operation: finds every web.archive.org
 * link in the doc and rewrites it back to its original URL.
 */

var ARCHIVE_AVAILABILITY_URL = 'https://archive.org/wayback/available';
var ARCHIVE_SAVE_URL = 'https://web.archive.org/save/';
// Far-future timestamp → availability API returns the latest snapshot.
var ARCHIVE_LATEST_TIMESTAMP = '99999999';

function showLinkArchiverSidebar() {
  var html = HtmlService.createTemplateFromFile('LinkArchiverSidebar');
  html.userEmail = Session.getEffectiveUser().getEmail();
  var output = html.evaluate().setTitle('80k Editorial Tools');
  DocumentApp.getUi().showSidebar(output);
}

function transformLinksToArchive() {
  var body = getActiveBody_();
  var paragraphs = body.getParagraphs();
  var replacements = [];
  var keptInternal = [];
  var keptArchived = [];
  var unavailable = [];
  var seenLookups = {};

  function lookup(url) {
    if (seenLookups.hasOwnProperty(url)) return seenLookups[url];
    var snapshotUrl = lookupArchiveUrl_(url);
    var savedNow = false;
    if (!snapshotUrl) {
      var saved = saveToWayback_(url);
      if (saved) { snapshotUrl = saved; savedNow = true; }
    }
    var result = snapshotUrl ? { url: snapshotUrl, savedNow: savedNow } : null;
    seenLookups[url] = result;
    return result;
  }

  for (var pi = 0; pi < paragraphs.length; pi++) {
    var para = paragraphs[pi];
    var text = para.editAsText();
    var content = text.getText();
    if (!content) continue;

    // 1. Native hyperlinks
    var ranges = [];
    var i = 0;
    while (i < content.length) {
      var url = text.getLinkUrl(i);
      if (url) {
        var start = i;
        while (i < content.length && text.getLinkUrl(i) === url) i++;
        ranges.push({ url: url, start: start, end: i, anchor: content.substring(start, i) });
      } else {
        i++;
      }
    }

    for (var r = 0; r < ranges.length; r++) {
      var range = ranges[r];
      var classification = classifyUrl_(range.url);
      if (classification === 'internal') {
        keptInternal.push({ anchor: range.anchor, url: range.url });
        continue;
      }
      if (classification === 'already-archived') {
        keptArchived.push({ anchor: range.anchor, url: range.url });
        continue;
      }
      if (classification !== 'external') continue;

      var snap = lookup(range.url);
      if (snap) {
        text.setLinkUrl(range.start, range.end - 1, snap.url);
        replacements.push({
          anchor: range.anchor,
          originalUrl: range.url,
          snapshotUrl: snap.url,
          savedNow: snap.savedNow
        });
      } else {
        unavailable.push({ anchor: range.anchor, url: range.url });
      }
    }

    // 2. Markdown-style links: [anchor](url) — pure text replacement.
    content = text.getText();
    var mdRegex = /\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g;
    var match;
    var mdReplacements = [];
    while ((match = mdRegex.exec(content)) !== null) {
      var mdAnchor = match[1];
      var mdUrl = match[2];
      var classMd = classifyUrl_(mdUrl);
      if (classMd === 'internal') { keptInternal.push({ anchor: mdAnchor, url: mdUrl }); continue; }
      if (classMd === 'already-archived') { keptArchived.push({ anchor: mdAnchor, url: mdUrl }); continue; }
      if (classMd !== 'external') continue;

      var mdSnap = lookup(mdUrl);
      if (!mdSnap) { unavailable.push({ anchor: mdAnchor, url: mdUrl }); continue; }

      mdReplacements.push({
        urlStart: match.index + match[1].length + 3, // after `[anchor](`
        urlEnd: match.index + match[0].length - 1,   // before final `)`
        oldUrl: mdUrl,
        newUrl: mdSnap.url,
        anchor: mdAnchor,
        savedNow: mdSnap.savedNow
      });
    }

    // Apply replacements right-to-left so earlier indices stay valid.
    mdReplacements.sort(function(a, b) { return b.urlStart - a.urlStart; });
    for (var m = 0; m < mdReplacements.length; m++) {
      var rep = mdReplacements[m];
      text.deleteText(rep.urlStart, rep.urlEnd - 1);
      text.insertText(rep.urlStart, rep.newUrl);
      replacements.push({
        anchor: rep.anchor,
        originalUrl: rep.oldUrl,
        snapshotUrl: rep.newUrl,
        savedNow: rep.savedNow
      });
    }
  }

  // Dedupe unavailable by URL, keeping first occurrence (preserves anchor).
  var seen = {};
  var unavailableList = [];
  for (var u = 0; u < unavailable.length; u++) {
    var uu = unavailable[u];
    if (!seen[uu.url]) { seen[uu.url] = true; unavailableList.push(uu); }
  }

  return {
    replacements: replacements,
    keptInternal: keptInternal,
    keptArchived: keptArchived,
    unavailable: unavailableList
  };
}

function unarchiveLinks() {
  var body = getActiveBody_();
  var paragraphs = body.getParagraphs();
  var restored = [];
  // Matches https://web.archive.org/web/<timestamp>[flag]/<original-url>
  var archiveRegex = /^https?:\/\/web\.archive\.org\/web\/[^\/]+\/(https?:\/\/.+)$/i;

  for (var pi = 0; pi < paragraphs.length; pi++) {
    var para = paragraphs[pi];
    var text = para.editAsText();
    var content = text.getText();
    if (!content) continue;

    // 1. Native hyperlinks
    var ranges = [];
    var i = 0;
    while (i < content.length) {
      var url = text.getLinkUrl(i);
      if (url) {
        var start = i;
        while (i < content.length && text.getLinkUrl(i) === url) i++;
        ranges.push({ url: url, start: start, end: i, anchor: content.substring(start, i) });
      } else {
        i++;
      }
    }

    for (var r = 0; r < ranges.length; r++) {
      var range = ranges[r];
      var m = range.url.match(archiveRegex);
      if (!m) continue;
      var original = m[1];
      text.setLinkUrl(range.start, range.end - 1, original);
      restored.push({ anchor: range.anchor, archiveUrl: range.url, originalUrl: original });
    }

    // 2. Markdown-style links: [anchor](https://web.archive.org/...)
    content = text.getText();
    var mdRegex = /\[([^\]\n]+)\]\((https?:\/\/web\.archive\.org\/web\/[^\/]+\/https?:\/\/[^)\s]+)\)/g;
    var match;
    var mdReps = [];
    while ((match = mdRegex.exec(content)) !== null) {
      var fullArchive = match[2];
      var mm = fullArchive.match(archiveRegex);
      if (!mm) continue;
      mdReps.push({
        urlStart: match.index + match[1].length + 3,
        urlEnd: match.index + match[0].length - 1,
        oldUrl: fullArchive,
        newUrl: mm[1],
        anchor: match[1]
      });
    }

    mdReps.sort(function(a, b) { return b.urlStart - a.urlStart; });
    for (var k = 0; k < mdReps.length; k++) {
      var rr = mdReps[k];
      text.deleteText(rr.urlStart, rr.urlEnd - 1);
      text.insertText(rr.urlStart, rr.newUrl);
      restored.push({ anchor: rr.anchor, archiveUrl: rr.oldUrl, originalUrl: rr.newUrl });
    }
  }

  return { restored: restored };
}

function classifyUrl_(url) {
  if (!url || !/^https?:\/\//i.test(url)) return 'other';
  var match = url.match(/^https?:\/\/([^\/]+)/i);
  if (!match) return 'other';
  var host = match[1].toLowerCase();
  if (host === '80000hours.org' || host === 'www.80000hours.org') return 'internal';
  if (host === 'web.archive.org' || host === 'archive.org' || host === 'www.archive.org') return 'already-archived';
  return 'external';
}

function lookupArchiveUrl_(originalUrl) {
  try {
    var availUrl = ARCHIVE_AVAILABILITY_URL +
                   '?url=' + encodeURIComponent(originalUrl) +
                   '&timestamp=' + ARCHIVE_LATEST_TIMESTAMP;
    var response = UrlFetchApp.fetch(availUrl, {
      muteHttpExceptions: true,
      headers: { 'User-Agent': '80k-editorial-tools/1.0' }
    });
    if (response.getResponseCode() !== 200) return null;
    var data;
    try { data = JSON.parse(response.getContentText()); } catch (e) { return null; }
    if (!data.archived_snapshots || !data.archived_snapshots.closest) return null;
    var closest = data.archived_snapshots.closest;
    if (!closest.available) return null;
    var snapshotUrl = closest.url || '';
    if (!snapshotUrl) return null;
    return snapshotUrl.replace(/^http:/, 'https:');
  } catch (e) {
    Logger.log('Wayback availability lookup failed for ' + originalUrl + ': ' + e.message);
    return null;
  }
}

function saveToWayback_(originalUrl) {
  try {
    var response = UrlFetchApp.fetch(ARCHIVE_SAVE_URL + originalUrl, {
      muteHttpExceptions: true,
      followRedirects: false,
      headers: { 'User-Agent': '80k-editorial-tools/1.0' }
    });
    var headers = response.getAllHeaders() || {};

    function header(name) {
      var lc = name.toLowerCase();
      for (var k in headers) if (k.toLowerCase() === lc) return headers[k];
      return null;
    }

    var location = header('Location');
    if (location && location.indexOf('/web/') !== -1) {
      var full = location.indexOf('http') === 0 ? location : ('https://web.archive.org' + location);
      return full.replace(/^http:/, 'https:');
    }
    var contentLoc = header('Content-Location');
    if (contentLoc && contentLoc.indexOf('/web/') !== -1) {
      return 'https://web.archive.org' + contentLoc;
    }
    if (response.getResponseCode() === 200) {
      var body = response.getContentText() || '';
      var m = body.match(/\/web\/\d+\w*\/https?:\/\/[^"'\s)<]+/);
      if (m) return ('https://web.archive.org' + m[0]).replace(/^http:/, 'https:');
    }
    // SPN often queues without an immediate URL — wait briefly, then re-poll.
    Utilities.sleep(2000);
    return lookupArchiveUrl_(originalUrl);
  } catch (e) {
    Logger.log('SPN failed for ' + originalUrl + ': ' + e.message);
    return null;
  }
}
