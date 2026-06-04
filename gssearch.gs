// ============================================================
// gssearch.gs — Global Search Controller
// PERF (B3): Builds a compact search index once and caches it
// in CacheService for 5 minutes. On cache hit: 0 sheet reads.
// On cache miss: 5 sheet reads, then cached for next callers.
// Cache is invalidated by _invalidateSearchCache_() in _data.gs
// (called by every mutation controller).
// ============================================================

var SEARCH_CACHE_KEY = 'gs_search_index_v1';
var SEARCH_CACHE_TTL = 300; // 5 minutes
var SEARCH_CACHE_CHUNK_SIZE = 80000;

function _putSearchCache_(idx) {
  try {
    var cache = CacheService.getScriptCache();
    var json = JSON.stringify(idx);
    var chunks = Math.ceil(json.length / SEARCH_CACHE_CHUNK_SIZE);
    var payload = {};
    for (var i = 0; i < chunks; i++) {
      payload[SEARCH_CACHE_KEY + '_part_' + i] = json.substring(i * SEARCH_CACHE_CHUNK_SIZE, (i + 1) * SEARCH_CACHE_CHUNK_SIZE);
    }
    payload[SEARCH_CACHE_KEY + '_meta'] = JSON.stringify({ chunks: chunks });
    cache.putAll(payload, SEARCH_CACHE_TTL);
  } catch(e) { Logger.log('GSIdx cache put failed: ' + e.message); }
}

function _getSearchCache_() {
  try {
    var cache = CacheService.getScriptCache();
    var metaRaw = cache.get(SEARCH_CACHE_KEY + '_meta');
    if (!metaRaw) return null;
    var meta = JSON.parse(metaRaw);
    var chunks = Number(meta.chunks) || 0;
    if (!chunks) return null;
    var keys = [];
    for (var i = 0; i < chunks; i++) keys.push(SEARCH_CACHE_KEY + '_part_' + i);
    var parts = cache.getAll(keys);
    var json = '';
    for (var j = 0; j < keys.length; j++) {
      if (!parts[keys[j]]) return null;
      json += parts[keys[j]];
    }
    return JSON.parse(json);
  } catch(e) {
    Logger.log('GSIdx cache read failed: ' + e.message);
    return null;
  }
}

/**
 * Build a compact search index from all sheets.
 * Returns a plain object suitable for JSON serialisation.
 */
function _buildSearchIndex_() {
  var idx = {
    parties:   [],  // [ [id, name, type, area, mobile] ]
    purchases: [],  // [ [id, partyName, dateRaw, grams, rupees, area] ]
    sales:     [],  // [ [id, partyName, dateRaw, grams, rupees, area] ]
    payments:  [],  // [ [id, partyName, dateRaw, rupeesRcvd, gramsRcvd, area] ]
    estimates: []   // [ [id, partyName, dateRaw] ]
  };

  try {
    var partData = DB.readAll('Parties', 6);
    for (var i = 0; i < partData.length; i++) {
      var r = partData[i];
      if (!r[0] && !r[1]) continue;
      idx.parties.push([String(r[0]||''), String(r[1]||''), String(r[2]||''), String(r[3]||''), String(r[5]||'')]);
    }
  } catch(e) { Logger.log('GSIdx Parties: ' + e.message); }

  try {
    var purData = DB.readAll('Purchase', 8);
    for (var i = 0; i < purData.length; i++) {
      var r = purData[i];
      if (!r[0]) continue;
      idx.purchases.push([String(r[0]||''), String(r[3]||''), DB.formatDateDisplay(r[1]), String(r[5]||''), String(r[6]||''), String(r[4]||'')]);
    }
  } catch(e) { Logger.log('GSIdx Purchase: ' + e.message); }

  try {
    var saleData = DB.readAll('Sales', 8);
    for (var i = 0; i < saleData.length; i++) {
      var r = saleData[i];
      if (!r[0]) continue;
      idx.sales.push([String(r[0]||''), String(r[3]||''), DB.formatDateDisplay(r[1]), String(r[5]||''), String(r[6]||''), String(r[4]||'')]);
    }
  } catch(e) { Logger.log('GSIdx Sales: ' + e.message); }

  try {
    var payData = DB.readAll('Receipts', 7);
    for (var i = 0; i < payData.length; i++) {
      var r = payData[i];
      if (!r[0]) continue;
      idx.payments.push([String(r[0]||''), String(r[3]||''), DB.formatDateDisplay(r[1]), String(r[5]||''), String(r[6]||''), String(r[4]||'')]);
    }
  } catch(e) { Logger.log('GSIdx Payments: ' + e.message); }

  try {
    var estData = DB.readAll('InvoiceMaster', 5);
    for (var i = 0; i < estData.length; i++) {
      var r = estData[i];
      if (!r[0]) continue;
      idx.estimates.push([String(r[0]||''), String(r[3]||''), DB.formatDateDisplay(r[1])]);
    }
  } catch(e) { Logger.log('GSIdx Estimates: ' + e.message); }

  _putSearchCache_(idx);

  return idx;
}

/**
 * Global search across all entity types.
 * On cache hit: no sheet reads. On miss: builds and caches the index.
 */
function globalSearch(query) {
  try {
    if (!query || query.length < 2) return { success: true, groups: {} };
    var q = String(query).toLowerCase().trim();

    // Try cache first
    var idx = _getSearchCache_();

    // Cache miss: build index (reads all sheets once)
    if (!idx) idx = _buildSearchIndex_();

    var groups = { parties: [], purchases: [], sales: [], payments: [], estimates: [] };
    var MAX = 5;

    for (var i = 0; i < idx.parties.length && groups.parties.length < MAX; i++) {
      var r = idx.parties[i];
      if ((r[0]+r[1]+r[2]+r[3]+r[4]).toLowerCase().indexOf(q) !== -1) {
        groups.parties.push({
          id: r[0], title: r[1] || r[0],
          sub: [r[2], r[3] ? 'Area: ' + r[3] : '', r[4] ? 'Mob: ' + r[4] : ''].filter(Boolean).join(' · ')
        });
      }
    }

    for (var i = 0; i < idx.purchases.length && groups.purchases.length < MAX; i++) {
      var r = idx.purchases[i];
      if ((r[0]+r[1]+r[5]).toLowerCase().indexOf(q) !== -1) {
        groups.purchases.push({
          id: r[0], title: r[0] + (r[1] ? ' — ' + r[1] : ''),
          sub: 'Date: ' + r[2] + ' · ' + r[3] + 'g · ₹' + r[4]
        });
      }
    }

    for (var i = 0; i < idx.sales.length && groups.sales.length < MAX; i++) {
      var r = idx.sales[i];
      if ((r[0]+r[1]+r[5]).toLowerCase().indexOf(q) !== -1) {
        groups.sales.push({
          id: r[0], title: r[0] + (r[1] ? ' — ' + r[1] : ''),
          sub: 'Date: ' + r[2] + ' · ' + r[3] + 'g · ₹' + r[4]
        });
      }
    }

    for (var i = 0; i < idx.payments.length && groups.payments.length < MAX; i++) {
      var r = idx.payments[i];
      if ((r[0]+r[1]+r[5]).toLowerCase().indexOf(q) !== -1) {
        groups.payments.push({
          id: r[0], title: 'Receipt ' + r[0] + (r[1] ? ' — ' + r[1] : ''),
          sub: 'Date: ' + r[2] + ' · ₹' + r[3] + ' · ' + r[4] + 'g'
        });
      }
    }

    for (var i = 0; i < idx.estimates.length && groups.estimates.length < MAX; i++) {
      var r = idx.estimates[i];
      if ((r[0]+r[1]).toLowerCase().indexOf(q) !== -1) {
        groups.estimates.push({
          id: r[0], title: 'Estimate ' + r[0] + (r[1] ? ' — ' + r[1] : ''),
          sub: 'Date: ' + r[2]
        });
      }
    }

    return DB.safeReturn({ success: true, groups: groups });
  } catch (err) {
    return { success: false, message: err.message };
  }
}
