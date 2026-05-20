/**
 * 80,000 Hours article catalog — fetched dynamically from the public WordPress REST API.
 * Cached for 6 hours. No authentication required (public content only).
 *
 * Script Properties (optional):
 *   CATALOG_BASE_URL — defaults to https://80000hours.org
 */

var CATALOG_CACHE_KEY = '80k_catalog_v3';

function getCatalog() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get(CATALOG_CACHE_KEY);
  if (cached) {
    try { return JSON.parse(cached); } catch (e) {}
  }
  return fetchCatalog_();
}

function fetchCatalog_() {
  var base = (PropertiesService.getScriptProperties().getProperty('CATALOG_BASE_URL') || 'https://80000hours.org').replace(/\/$/, '');
  var items = [];
  var fields = '_fields=title,link,content.protected';
  // Post types found via 80000hours.org/sitemap_index.xml. The REST endpoint
  // slug usually matches the post type name; Yoast pluralises built-ins
  // (pages/posts) but custom post types stay singular.
  var types = [
    'pages',
    'posts',
    'career_profile',
    'case_study',
    'career_report',
    'article',
    'skill_set',
    'careerguidepage',
    'ai_career_guide_page',
    'problem_profile',
    'podcast',
    'podcast_after_hours',
    'video'
  ];
  var perType = {};

  for (var t = 0; t < types.length; t++) {
    var typeCount = 0;
    var typeExample = null;
    var page = 1;
    while (page <= 20) { // safety cap: max 2,000 items per type
      try {
        var url = base + '/wp-json/wp/v2/' + types[t] + '?' + fields + '&per_page=100&status=publish&page=' + page;
        var response = UrlFetchApp.fetch(url, {
          headers: { 'User-Agent': 'curl/7.64.1' },
          muteHttpExceptions: true
        });
        if (response.getResponseCode() !== 200) break;
        var data = JSON.parse(response.getContentText());
        if (!Array.isArray(data) || data.length === 0) break;
        for (var i = 0; i < data.length; i++) {
          var link = (data[i].link || '').replace(/\/$/, '');
          var path = link.replace(base, '') || '/';
          var title = data[i].title && data[i].title.rendered ? data[i].title.rendered : '';
          var isProtected = data[i].content && data[i].content.protected;
          if (path && title && !isProtected) {
            items.push({ path: path, title: title });
            typeCount++;
            if (!typeExample) typeExample = { path: path, title: title };
          }
        }
        if (data.length < 100) break;
        page++;
      } catch (e) {
        Logger.log('Catalog fetch error (type=' + types[t] + ', page=' + page + '): ' + e.message);
        break;
      }
    }
    perType[types[t]] = { count: typeCount, example: typeExample };
  }
  Logger.log('Catalog per-type: ' + JSON.stringify(perType));
  try { CacheService.getScriptCache().put(CATALOG_CACHE_KEY + '_types', JSON.stringify(perType), 21600); } catch (e) {}

  if (items.length > 0) {
    try {
      var json = JSON.stringify(items);
      if (json.length <= 100000) {
        CacheService.getScriptCache().put(CATALOG_CACHE_KEY, json, 21600);
      } else {
        // Trim to fit within CacheService's 100KB limit
        var keep = Math.floor(items.length * 95000 / json.length);
        CacheService.getScriptCache().put(CATALOG_CACHE_KEY, JSON.stringify(items.slice(0, keep)), 21600);
        Logger.log('Catalog trimmed to ' + keep + ' of ' + items.length + ' items to fit cache limit.');
      }
    } catch (cacheErr) {
      Logger.log('Catalog cache write error: ' + cacheErr.message);
    }
  }

  Logger.log('Catalog fetched: ' + items.length + ' items from ' + base);
  return items;
}

/**
 * Force-refresh the catalog. Run from the script editor to bust the cache.
 */
function refreshCatalog() {
  CacheService.getScriptCache().remove(CATALOG_CACHE_KEY);
  var items = fetchCatalog_();
  Logger.log('Catalog refreshed: ' + items.length + ' items.');
  return items.length;
}

/**
 * Debug helper called from the links sidebar.
 * Returns { count, cached, sample, error }.
 */
function getCatalogDebug() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get(CATALOG_CACHE_KEY);
  var perTypeRaw = cache.get(CATALOG_CACHE_KEY + '_types');
  var perType = null;
  try { perType = perTypeRaw ? JSON.parse(perTypeRaw) : null; } catch (e) {}

  if (cached) {
    try {
      var items = JSON.parse(cached);
      return { count: items.length, cached: true, perType: perType };
    } catch (e) {
      // fall through to fresh fetch
    }
  }

  try {
    var items = fetchCatalog_();
    perTypeRaw = cache.get(CATALOG_CACHE_KEY + '_types');
    try { perType = perTypeRaw ? JSON.parse(perTypeRaw) : null; } catch (e) {}
    if (items.length === 0) return { count: 0, cached: false, error: 'Fetch returned 0 items — check that 80000hours.org/wp-json/wp/v2/pages is reachable.', perType: perType };
    return { count: items.length, cached: false, perType: perType };
  } catch (e) {
    return { count: 0, cached: false, error: e.message };
  }
}
