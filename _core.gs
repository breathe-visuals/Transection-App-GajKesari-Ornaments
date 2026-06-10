// ============================================================
// _config.gs — Configuration, Auth & App Metadata
// Extracted from gstemplate.gs for clean separation.
// ============================================================

// ── Spreadsheet Helpers ──────────────────────────────────────

function getSpreadsheet() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function getSheet(name) {
  var ss = getSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) throw new Error('Sheet "' + name + '" not found.');
  return sh;
}

// ── Config Reader ─────────────────────────────────────────────
/**
 * Reads all key-value pairs from the Config sheet.
 * Expected layout: Column A = Key, Column B = Value (starting row 2).
 * Cached for 60 seconds to reduce Sheets API calls on every page load.
 */
function getConfig() {
  try {
    var cache = CacheService.getScriptCache();
    var cached = cache.get('gajkesari_config');
    if (cached) {
      try { return JSON.parse(cached); } catch (e) { }
    }
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName('Config');
    if (!sh) {
      sh = ss.insertSheet('Config');
      sh.getRange(1, 1, 1, 2).setValues([['Key', 'Value']]);
      sh.getRange(2, 1, 14, 2).setValues([
        ['AppName', 'GajKesari Ornaments'],
        ['business_name', 'GajKesari Ornaments'],
        ['businessSub', 'Silver Wholesaler'],
        ['business_logo_url', ''],
        ['PageSize', 25],
        ['Version', '1.0.0'],
        ['EditMode', 'OFF'],
        ['Admin Password', '1464'],
        ['primaryColor', '#0d9488'],
        ['SidebarColor', '#0f1117'],
        ['PrimaryFont', 'Roboto'],
        ['SecondaryFont', 'sans-serif'],
        ['BorderRadius', '8px'],
        ['CurrencySymbol', '\u20b9'],
        ['PrintDisclaimer', 'All sales are final']
      ]);
    }
    var data = sh.getDataRange().getValues();
    var cfg = {};
    for (var i = 1; i < data.length; i++) {
      var key = String(data[i][0]).trim();
      var val = data[i][1];
      if (key) cfg[key] = val;
    }
    try { cache.put('gajkesari_config', JSON.stringify(cfg), 60); } catch (e) { }
    return cfg;
  } catch (err) {
    Logger.log('getConfig error: ' + err.message);
    return {};
  }
}

// ── Edit Mode ─────────────────────────────────────────────────

function getEditMode() {
  var cfg = getConfig();
  var rawValue = String(cfg['EditMode'] || 'OFF').trim().toUpperCase();
  return { editMode: rawValue === 'ON' };
}

function toggleEditMode() {
  try {
    var sh = getSheet('Config');
    var data = sh.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]).trim() === 'EditMode') {
        var current = String(data[i][1]).trim().toUpperCase();
        sh.getRange(i + 1, 2).setValue(current === 'ON' ? 'OFF' : 'ON');
        try { CacheService.getScriptCache().remove('gajkesari_config'); } catch (e) { }
        return { success: true, editMode: current !== 'ON' };
      }
    }
    var lastRow = sh.getLastRow();
    sh.getRange(lastRow + 1, 1).setValue('EditMode');
    sh.getRange(lastRow + 1, 2).setValue('ON');
    try { CacheService.getScriptCache().remove('gajkesari_config'); } catch (e) { }
    return { success: true, editMode: true };
  } catch (err) {
    Logger.log('toggleEditMode error: ' + err.message);
    return { success: false, message: err.message };
  }
}

// ── Drive URL Converter ───────────────────────────────────────
/**
 * Converts a Google Drive share URL to a direct embeddable image URL.
 * Input:  https://drive.google.com/file/d/FILE_ID/view
 * Output: https://lh3.googleusercontent.com/d/FILE_ID
 */
function convertDriveUrl_(url) {
  if (!url) return '';
  var url_s = String(url).trim();
  var m = url_s.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (m) return 'https://lh3.googleusercontent.com/d/' + m[1];
  return url_s;
}

// ── App Meta ──────────────────────────────────────────────────

function getAppMeta() {
  try {
    var em = getEditMode();
    var cfg = getConfig();

    // Combine PrimaryFont + SecondaryFont into a CSS font-family string
    var pf = String(cfg['PrimaryFont'] || 'Roboto').replace(/['";]/g, '').trim();
    var sf = String(cfg['SecondaryFont'] || 'sans-serif').replace(/['";]/g, '').trim();
    var fontFamily = "'" + pf + "', " + sf;

    return {
      success: true,
      editMode: em.editMode,
      appName: String(cfg['AppName'] || 'GajKesari Ornaments'),
      businessName: String(cfg['business_name'] || cfg['AppName'] || 'GajKesari Ornaments'),
      businessSub: String(cfg['businessSub'] || 'Silver Wholesaler'),
      businessLogoUrl: convertDriveUrl_(cfg['business_logo_url'] || ''),
      version: String(cfg['Version'] || '1.0.0'),
      primaryColor: String(cfg['primaryColor'] || '#0d9488'),
      sidebarColor: String(cfg['SidebarColor'] || '#0f1117'),
      fontFamily: fontFamily,
      borderRadius: String(cfg['BorderRadius'] || '8px'),
      currencySymbol: String(cfg['CurrencySymbol'] || '\u20b9'),
      printDisclaimer: String(cfg['PrintDisclaimer'] || 'All sales are final')
    };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ── Admin Password Verification ───────────────────────────────

// ── Admin Password Verification ──────────────────────────────────

/**
 * Verify the admin password.
 * Reads DIRECTLY from the Config sheet every time so that changing
 * the "Admin Password" row in the sheet takes effect immediately.
 * The cache is bypassed for password reads for security.
 */
function verifyAdminPassword(inputPassword) {
  try {
    var input = String(inputPassword || '').trim();
    if (!input) return { success: false, message: 'Password is required.' };

    // Always read directly from sheet (bypass 60-second cache) for freshness
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName('Config');
    if (!sh) return { success: false, message: 'Config sheet not found.' };

    var data = sh.getDataRange().getValues();
    var stored = null;
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]).trim() === 'Admin Password') {
        stored = String(data[i][1]).trim();
        break;
      }
    }

    if (!stored || stored === '[set via setAdminPassword()]') {
      return { success: false, message: 'Admin password not set in Config sheet.' };
    }

    // Direct comparison — password is stored as plaintext in Config sheet
    var match = (input === stored);
    return { success: true, match: match };
  } catch (err) {
    Logger.log('verifyAdminPassword error: ' + err.message);
    return { success: false, message: 'Verification error. Please try again.' };
  }
}

/**
 * Helper: hash a password with SHA-256 (kept for legacy compatibility).
 */
function hashPassword_(pw) {
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(pw || ''),
    Utilities.Charset.UTF_8
  );
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

// ── Page Size Helper ──────────────────────────────────────────

function getPageSize_() {
  try {
    var cfg = getConfig();
    var ps = parseInt(cfg['PageSize'] || cfg['Page Size'] || '25', 10);
    return (ps > 0 && ps <= 500) ? ps : 25;
  } catch (e) { return 25; }
}
// ============================================================
// _data.gs — Data Access Layer (DAL)
// ALL Google Sheets reads/writes go through this file.
// Zero business logic. Shared utilities for every module.
// ============================================================

var DB = {};

// ── Spreadsheet access (cached within a single execution) ────

DB._ss = null;

DB.ss = function () {
  if (!DB._ss) DB._ss = SpreadsheetApp.getActiveSpreadsheet();
  return DB._ss;
};

/**
 * Get a sheet by name. Throws if it doesn't exist.
 */
DB.sheet = function (name) {
  var sh = DB.ss().getSheetByName(name);
  if (!sh) throw new Error('Sheet "' + name + '" not found.');
  return sh;
};

/**
 * Get a sheet by name — auto-create with headers if missing.
 * Also ensures column count and header row.
 */
DB.ensureSheet = function (name, headers) {
  var sh = DB.ss().getSheetByName(name);
  if (!sh) {
    sh = DB.ss().insertSheet(name);
    if (headers && headers.length) {
      sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    }
    return sh;
  }
  if (headers) {
    var maxCols = sh.getMaxColumns();
    if (maxCols < headers.length) sh.insertColumnsAfter(maxCols, headers.length - maxCols);
    if (sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    }
  }
  return sh;
};

// ── Internal ──────────────────────────────────────────────────

DB.ensureCols_ = function (sh, colCount) {
  var maxCols = sh.getMaxColumns();
  if (maxCols < colCount) sh.insertColumnsAfter(maxCols, colCount - maxCols);
};

// ── Read operations ──────────────────────────────────────────

/**
 * Read all data rows (excludes header row 1).
 * Returns raw 2D array — caller decides how to filter.
 */
DB.readAll = function (name, colCount) {
  var sh = DB.sheet(name);
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return [];
  DB.ensureCols_(sh, colCount);
  return sh.getRange(2, 1, lastRow - 1, colCount).getValues();
};

/**
 * Read a single page of rows from the sheet.
 * Returns { rows: 2D array, total: int, offset: int }.
 */
DB.readPage = function (name, colCount, offset, count) {
  var sh = DB.sheet(name);
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return { rows: [], total: 0, offset: 0 };
  var total = lastRow - 1;
  DB.ensureCols_(sh, colCount);
  if (offset >= total) return { rows: [], total: total, offset: offset };
  var actualCount = Math.min(count, total - offset);
  if (actualCount <= 0) return { rows: [], total: total, offset: offset };
  return {
    rows: sh.getRange(2 + offset, 1, actualCount, colCount).getValues(),
    total: total,
    offset: offset
  };
};

/**
 * Read a single row by 1-indexed sheet row number.
 */
DB.getRow = function (name, rowNum, colCount) {
  var sh = DB.sheet(name);
  DB.ensureCols_(sh, colCount);
  return sh.getRange(rowNum, 1, 1, colCount).getValues()[0];
};

/**
 * Get the last row number for a sheet.
 */
DB.lastRow = function (name) {
  return DB.sheet(name).getLastRow();
};

/**
 * Find a row by ID in column A using TextFinder (server-side, scales to 100k+ rows).
 * Returns the 1-indexed sheet row number, or -1 if not found.
 */
DB.findRowById = function (name, id) {
  var sh = DB.sheet(name);
  if (sh.getLastRow() < 2) return -1;
  var idStr = String(id).trim();
  // Restrict search to column A only, starting from row 2
  var colA = sh.getRange(2, 1, sh.getLastRow() - 1, 1);
  var found = colA.createTextFinder(idStr)
    .matchEntireCell(true)
    .findNext();
  return found ? found.getRow() : -1;
};

// ── Write operations ─────────────────────────────────────────

/**
 * Append a single row. Returns the 1-indexed row number of the new row.
 */
DB.appendRow = function (name, colCount, values) {
  var sh = DB.sheet(name);
  DB.ensureCols_(sh, colCount);
  var nextRow = sh.getLastRow() + 1;
  sh.getRange(nextRow, 1, 1, colCount).setValues([values]);
  return nextRow;
};

/**
 * Overwrite a single row at the given 1-indexed row number.
 */
DB.updateRow = function (name, rowNum, colCount, values) {
  var sh = DB.sheet(name);
  DB.ensureCols_(sh, colCount);
  sh.getRange(rowNum, 1, 1, colCount).setValues([values]);
};

/**
 * Delete a single row by 1-indexed row number.
 */
DB.deleteRow = function (name, rowNum) {
  DB.sheet(name).deleteRow(rowNum);
};

/**
 * Delete multiple rows. Sorts descending automatically so indices stay valid.
 */
DB.deleteRowsDesc = function (name, rowNums) {
  var sh = DB.sheet(name);
  rowNums.sort(function (a, b) { return b - a; });
  for (var i = 0; i < rowNums.length; i++) sh.deleteRow(rowNums[i]);
};

/**
 * PERF (B6): Bulk delete via read-filter-compact-rewrite.
 * Ideal for deleting 10+ rows — reduces N deleteRow() calls to 3 API calls:
 *   1. getValues (read all)  2. clearContent (wipe data rows)  3. setValues (rewrite kept rows)
 * Does NOT reverse outstanding — caller must handle that before calling this.
 * @param {string}   name       - Sheet name
 * @param {number}   colCount   - Number of columns to read/write
 * @param {string[]} idsToDelete - Array of IDs (column A) to remove
 * @returns {number} Number of rows actually deleted
 */
DB.bulkDeleteAndRewrite = function (name, colCount, idsToDelete) {
  var idSet = {};
  for (var i = 0; i < idsToDelete.length; i++) idSet[String(idsToDelete[i]).trim()] = true;
  var sh = DB.sheet(name);
  DB.ensureCols_(sh, colCount);
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return 0;
  var all = sh.getRange(2, 1, lastRow - 1, colCount).getValues();
  var kept = [];
  for (var j = 0; j < all.length; j++) {
    if (!idSet[String(all[j][0]).trim()]) kept.push(all[j]);
  }
  var deleted = all.length - kept.length;
  // Clear existing data rows
  sh.getRange(2, 1, lastRow - 1, colCount).clearContent();
  // Rewrite kept rows in one call
  if (kept.length > 0) sh.getRange(2, 1, kept.length, colCount).setValues(kept);
  return deleted;
};

/**
 * Write values to specific cells. values2d is a 2D array.
 * Example: DB.setCells('Parties', 5, 10, [[100, 50]]) → writes 100 to J5, 50 to K5
 */
DB.setCells = function (name, row, col, values2d) {
  DB.sheet(name).getRange(row, col, values2d.length, values2d[0].length).setValues(values2d);
};

/**
 * Set a cell's number format to dd/mm/yyyy (used after writing a Date value).
 */
DB.setDateFormat = function (name, row, col) {
  DB.sheet(name).getRange(row, col).setNumberFormat('dd/mm/yyyy');
};

/**
 * Run a multi-step mutation under a document lock.
 * Prevents concurrent users from creating duplicate IDs or drifting balances.
 */
DB.withWriteLock = function (context, fn) {
  var lock = LockService.getDocumentLock() || LockService.getScriptLock();
  try {
    if (!lock) {
      return { success: false, message: 'Unable to acquire write lock. Please try again.' };
    }
    if (!lock.tryLock(30000)) {
      return { success: false, message: 'System is busy. Please try again in a few seconds.' };
    }
    return fn();
  } catch (e) {
    return DB.safeError(e, context || 'DB.withWriteLock');
  } finally {
    try { lock.releaseLock(); } catch (releaseErr) { }
  }
};

DB.locked = function (context, fn) {
  return function () {
    var args = arguments;
    return DB.withWriteLock(context, function () {
      return fn.apply(null, args);
    });
  };
};

// ── Formatting utilities ─────────────────────────────────────

/** Format date → dd/MM/yyyy display string. Uses script timezone (L3 fix). */
DB.formatDate = function (val) {
  if (!val || val === '') return '';
  try {
    var d = (val instanceof Date) ? val : new Date(val);
    if (isNaN(d.getTime())) return String(val);
    return Utilities.formatDate(d, Session.getScriptTimeZone(), 'dd/MM/yyyy');
  } catch (e) { return String(val); }
};

/** Format date → YYYY-MM-DD raw string using script timezone (H2+L3 fix). */
DB.dateRaw = function (val) {
  if (!val || val === '') return '';
  try {
    var d = (val instanceof Date) ? val : new Date(val);
    if (isNaN(d.getTime())) return '';
    return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  } catch (e) { return ''; }
};

/** Format date for search results (e.g., "30 May 2026"). */
DB.formatDateDisplay = function (val) {
  if (!val) return '';
  try {
    var d = (val instanceof Date) ? val : new Date(val);
    if (isNaN(d.getTime())) return String(val);
    return Utilities.formatDate(d, Session.getScriptTimeZone(), 'dd MMM yyyy');
  } catch (e) { return String(val); }
};

/**
 * Parse a YYYY-MM-DD string as local date, avoiding UTC midnight offset (H2 fix).
 * Returns a Date object or '' if invalid.
 */
DB.parseDate = function (dateStr) {
  if (!dateStr) return '';
  var m = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isNaN(d.getTime()) ? '' : d;
};

/** Returns true if dateStr is a valid YYYY-MM-DD date (M4 fix). */
DB.isValidDate = function (dateStr) {
  return DB.parseDate(dateStr) !== '';
};

// ── Number utilities ─────────────────────────────────────────

/** Safe number parse — NaN/undefined/Infinity → 0. */
DB.num = function (v) {
  var n = parseFloat(v);
  return (isNaN(n) || !isFinite(n)) ? 0 : n;
};

/** Returns parsed value if > 0, else null (M4 fix). */
DB.positiveNum = function (v) {
  var n = parseFloat(v);
  return (!isNaN(n) && isFinite(n) && n > 0) ? n : null;
};

/** Returns parsed value if >= 0, else null. */
DB.nonNegNum = function (v) {
  var n = parseFloat(v);
  return (!isNaN(n) && isFinite(n) && n >= 0) ? n : null;
};

// ── Serialization ────────────────────────────────────────────

/**
 * Recursively sanitize an object for google.script.run transport.
 * Converts Date objects to ISO strings to avoid serialization issues.
 */
DB.safeReturn = function (obj) {
  if (obj === null || obj === undefined) return obj;
  if (obj instanceof Date) {
    try {
      return Utilities.formatDate(obj, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    } catch (e) { return String(obj); }
  }
  if (Array.isArray(obj)) {
    var arr = [];
    for (var i = 0; i < obj.length; i++) arr.push(DB.safeReturn(obj[i]));
    return arr;
  }
  if (typeof obj === 'object') {
    var newObj = {};
    for (var k in obj) {
      if (obj.hasOwnProperty(k)) newObj[k] = DB.safeReturn(obj[k]);
    }
    return newObj;
  }
  return obj;
};

// ── Text sanitization ────────────────────────────────────────

/**
 * Sanitize a text value for sheet storage (C3 fix):
 *  - Trims whitespace
 *  - Truncates to maxLen characters
 *  - Prefixes formula characters (=+-@) with apostrophe to prevent
 *    spreadsheet formula injection
 */
DB.sanitizeText = function (v, maxLen) {
  var s = String(v || '').trim();
  if (maxLen && s.length > maxLen) s = s.substring(0, maxLen);
  if (s.length > 0 && '=+-@'.indexOf(s[0]) !== -1) s = "'" + s;
  return s;
};

/** Truncate a string to maxLen characters. */
DB.truncate = function (v, maxLen) {
  return String(v || '').substring(0, maxLen || 255);
};

DB.getPartiesForDropdown = function (includeOutstanding) {
  var cacheKey = includeOutstanding ? 'parties_dropdown_outstanding_v1' : 'parties_dropdown_basic_v1';
  try {
    var cached = CacheService.getScriptCache().get(cacheKey);
    if (cached) return JSON.parse(cached);
  } catch (e) { }

  var rows = DB.readAll('Parties', includeOutstanding ? 11 : 4);
  var result = [];
  for (var i = 0; i < rows.length; i++) {
    if (!String(rows[i][0]).trim()) continue;
    var item = {
      partyId: rows[i][0],
      partyName: rows[i][1],
      partyType: rows[i][2],
      area: rows[i][3]
    };
    if (includeOutstanding) {
      item.outstandingRupees = rows[i][9] || 0;
      item.outstandingGrams = rows[i][10] || 0;
    }
    result.push(item);
  }
  try { CacheService.getScriptCache().put(cacheKey, JSON.stringify(result), 300); } catch (e2) { }
  return result;
};

/**
 * Log error to Apps Script Logger AND to a hidden ErrorLog sheet.
 * Returns a safe generic message to the browser (no sheet-structure leaks).
 */
DB.safeError = function (e, context) {
  var msg = (e && e.message) ? e.message : String(e);
  var stack = (e && e.stack) ? e.stack : "";
  Logger.log("[ERROR] " + context + ": " + msg + "\n" + stack);
  try {
    var logSheet = DB.ss().getSheetByName("ErrorLog");
    if (!logSheet) {
      logSheet = DB.ss().insertSheet("ErrorLog");
      logSheet.getRange(1, 1, 1, 5).setValues([["Timestamp", "Context", "Message", "Stack", "User"]]);
      logSheet.hideSheet();
    }
    var user = "";
    try { user = Session.getActiveUser().getEmail(); } catch (ue) { }
    logSheet.appendRow([new Date(), context, msg, stack, user]);
  } catch (le) { Logger.log("ErrorLog append failed: " + le.message); }
  return { success: false, message: "An unexpected error occurred. Please try again." };
};

function safeReturn_(obj) { return DB.safeReturn(obj); }

// ── Global cache-invalidation helpers ────────────────────────
// Called by every mutation controller (Add/Update/Delete) to keep
// CacheService entries in sync after writes.

/** Invalidate the dashboard summary cache. */
function _invalidateDashCache_() {
  try { CacheService.getScriptCache().removeAll(['dash_summary_v1', 'dash_summary_v2']); } catch (e) { }
}

/** Invalidate reference data caches used by dropdowns/forms. */
function _invalidateRefCache_() {
  try {
    CacheService.getScriptCache().removeAll([
      'gajkesari_config',
      'parties_dropdown_basic_v1',
      'parties_dropdown_outstanding_v1'
    ]);
  } catch (e) { }
}

/** Invalidate the global search index cache. */
function _invalidateSearchCache_() {
  try {
    var keys = ['gs_search_index_v1', 'gs_search_index_v1_meta'];
    for (var i = 0; i < 20; i++) keys.push('gs_search_index_v1_part_' + i);
    CacheService.getScriptCache().removeAll(keys);
  } catch (e) { }
}
// ============================================================
// _svcCalc.gs — Calculation Service
// Pure business math: rates, profits, rounding.
// No sheet access — works only on values passed in.
// ============================================================

var CalcSvc = {};

/** Round to 2 decimal places (for ₹). */
CalcSvc.round2 = function (v) { return Math.round(v * 100) / 100; };

/** Round to 3 decimal places (for grams). */
CalcSvc.round3 = function (v) { return Math.round(v * 1000) / 1000; };

/**
 * Calculate rate per 10 grams.
 * Works for both individual purchase rows AND weighted averages.
 */
CalcSvc.purchaseRate = function (grams, rupees) {
  return grams > 0 ? CalcSvc.round2((rupees / grams) * 10) : 0;
};

/**
 * Calculate sale profit breakdown.
 * @param {number} grams   - Grams sold
 * @param {number} rupees  - Sale amount in ₹
 * @param {number} avgRate - Average purchase rate per 10g at time of sale
 * @returns {{ saleRate10g, costRupees, profitRup, profitPct }}
 */
CalcSvc.saleProfit = function (grams, rupees, avgRate) {
  var saleRate10g = grams > 0 ? CalcSvc.round2((rupees / grams) * 10) : 0;
  var costRupees = CalcSvc.round2((avgRate / 10) * grams);
  var profitRup = CalcSvc.round2(rupees - costRupees);
  var profitPct = costRupees > 0 ? CalcSvc.round2((profitRup / costRupees) * 100) : 0;
  return {
    saleRate10g: saleRate10g,
    costRupees: costRupees,
    profitRup: profitRup,
    profitPct: profitPct
  };
};
// ============================================================
// _svcOutstanding.gs — Outstanding Balance Service
// Owns all party-balance mutations: delta updates, absolute sets, reads.
// Uses: DB (data layer), CalcSvc (rounding)
// ============================================================

var OutSvc = {};

// ── Audit Log ────────────────────────────────────────────────

var AUDIT_SHEET = 'AuditLog';
var AUDIT_COLS = 7;
var AUDIT_HEADERS = ['Timestamp', 'Party ID', 'Action', 'Delta ₹', 'Delta g', 'New ₹', 'New g'];

/**
 * Append a row to the AuditLog sheet.
 * Silent — never throws. If the sheet doesn't exist, creates it.
 */
OutSvc.audit_ = function (partyId, action, deltaR, deltaG, newR, newG) {
  try {
    DB.ensureSheet(AUDIT_SHEET, AUDIT_HEADERS);
    var ts = new Date();
    DB.appendRow(AUDIT_SHEET, AUDIT_COLS, [
      ts, partyId, action,
      CalcSvc.round2(deltaR), CalcSvc.round3(deltaG),
      CalcSvc.round2(newR), CalcSvc.round3(newG)
    ]);
    DB.setDateFormat(AUDIT_SHEET, DB.lastRow(AUDIT_SHEET), 1);
  } catch (e) {
    Logger.log('OutSvc.audit_ error (non-fatal): ' + e.message);
  }
};

// ── Core Mutations ───────────────────────────────────────────

/**
 * Add/subtract from a party's outstanding balance.
 * @param {string} partyId      - Party ID (column A in Parties sheet)
 * @param {number} deltaRupees  - Amount to add (positive) or subtract (negative)
 * @param {number} deltaGrams   - Grams to add (positive) or subtract (negative)
 */
OutSvc.updateDelta = function (partyId, deltaRupees, deltaGrams) {
  try {
    if (!partyId) { Logger.log('OutSvc.updateDelta: empty partyId, skipping.'); return; }
    var rows = DB.readAll('Parties', 12);
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i][0]).trim() !== String(partyId).trim()) continue;
      var newR = CalcSvc.round2(DB.num(rows[i][9]) + DB.num(deltaRupees));
      var newG = CalcSvc.round3(DB.num(rows[i][10]) + DB.num(deltaGrams));
      DB.setCells('Parties', i + 2, 10, [[newR, newG]]);
      OutSvc.audit_(partyId, 'DELTA', deltaRupees, deltaGrams, newR, newG);
      return;
    }
    Logger.log('OutSvc.updateDelta: partyId not found: ' + partyId);
  } catch (e) {
    Logger.log('OutSvc.updateDelta: ' + e.message);
  }
};

OutSvc.updateDeltas = function (deltas) {
  try {
    if (!deltas || !deltas.length) return;
    var merged = {};
    for (var d = 0; d < deltas.length; d++) {
      var pid = String(deltas[d].partyId || '').trim();
      if (!pid) continue;
      if (!merged[pid]) merged[pid] = { rupees: 0, grams: 0 };
      merged[pid].rupees += DB.num(deltas[d].rupees);
      merged[pid].grams += DB.num(deltas[d].grams);
    }
    var rows = DB.readAll('Parties', 12);
    for (var i = 0; i < rows.length; i++) {
      var partyId = String(rows[i][0] || '').trim();
      var delta = merged[partyId];
      if (!delta) continue;
      var newR = CalcSvc.round2(DB.num(rows[i][9]) + delta.rupees);
      var newG = CalcSvc.round3(DB.num(rows[i][10]) + delta.grams);
      DB.setCells('Parties', i + 2, 10, [[newR, newG]]);
      OutSvc.audit_(partyId, 'DELTA_BATCH', delta.rupees, delta.grams, newR, newG);
    }
  } catch (e) {
    Logger.log('OutSvc.updateDeltas: ' + e.message);
  }
};

/**
 * Directly set a party's outstanding to specific values (for adjustments).
 * @param {string} partyId
 * @param {number} newR - New outstanding ₹
 * @param {number} newG - New outstanding grams
 * @returns {boolean} true if party found and updated
 */
OutSvc.setAbsolute = function (partyId, newR, newG) {
  if (!partyId) return false;
  var rows = DB.readAll('Parties', 12);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).trim() !== String(partyId).trim()) continue;
    var oldR = DB.num(rows[i][9]);
    var oldG = DB.num(rows[i][10]);
    DB.setCells('Parties', i + 2, 10, [[newR, newG]]);
    OutSvc.audit_(partyId, 'SET_ABSOLUTE', newR - oldR, newG - oldG, newR, newG);
    return true;
  }
  Logger.log('OutSvc.setAbsolute: partyId not found: ' + partyId);
  return false;
};

// ── Read Operations ──────────────────────────────────────────

/**
 * Read current outstanding balance for a specific party.
 * @returns {{ rupees: number, grams: number }}
 */
OutSvc.getForParty = function (partyId) {
  if (!partyId) return { rupees: 0, grams: 0 };
  var rows = DB.readAll('Parties', 11);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).trim() !== String(partyId).trim()) continue;
    return { rupees: DB.num(rows[i][9]), grams: DB.num(rows[i][10]) };
  }
  return { rupees: 0, grams: 0 };
};

/**
 * Resolve a party by NAME (not ID).
 * Used by outstanding adjustment feature where frontend sends partyName.
 * @returns {{ rowIdx, partyId, area, rupees, grams } | null}
 */
OutSvc.resolveByName = function (name) {
  if (!name) return null;
  var rows = DB.readAll('Parties', 11);
  var lowerName = String(name).trim().toLowerCase();
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][1]).trim().toLowerCase() !== lowerName) continue;
    return {
      rowIdx: i + 2,
      partyId: String(rows[i][0] || ''),
      area: String(rows[i][3] || ''),
      rupees: DB.num(rows[i][9]),
      grams: DB.num(rows[i][10])
    };
  }
  return null;
};

/**
 * Aggregate outstanding by party type (Supplier / Customer / Both).
 * @returns {{ supRupees, supGrams, custRupees, custGrams }}
 */
OutSvc.getByType = function () {
  var rows = DB.readAll('Parties', 11);
  var r = { supRupees: 0, supGrams: 0, custRupees: 0, custGrams: 0 };
  for (var i = 0; i < rows.length; i++) {
    var t = String(rows[i][2] || '').trim();
    var oR = DB.num(rows[i][9]);
    var oG = DB.num(rows[i][10]);
    if (t === 'Supplier') { r.supRupees += oR; r.supGrams += oG; }
    else if (t === 'Customer') { r.custRupees += oR; r.custGrams += oG; }
    else if (t === 'Both') { r.supRupees += oR; r.supGrams += oG; r.custRupees += oR; r.custGrams += oG; }
  }
  r.supRupees = CalcSvc.round2(r.supRupees);
  r.supGrams = CalcSvc.round3(r.supGrams);
  r.custRupees = CalcSvc.round2(r.custRupees);
  r.custGrams = CalcSvc.round3(r.custGrams);
  return r;
};

// ── Reconciliation ───────────────────────────────────────────

/**
 * Recompute outstanding for ALL parties from raw transactions.
 * Scans Sales + Receipts, computes expected outstanding, compares with stored.
 *
 * @param {boolean} [autoFix=false] - If true, auto-correct drifted values.
 * @returns {{ parties: number, drifted: [], fixed: number }}
 *
 * Each drifted entry: { partyId, partyName, storedR, storedG, expectedR, expectedG, diffR, diffG }
 */
OutSvc.reconcile = function (autoFix) {
  try {
    // 1. Build expected outstanding per partyId from transactions
    var expected = {};  // partyId → { rupees, grams }

    // Purchases: unpaid purchase entries add to supplier outstanding.
    try {
      var purRows = DB.readAll('Purchase', 12);
      for (var u = 0; u < purRows.length; u++) {
        var uParty = String(purRows[u][2] || '').trim();
        var uPaid = purRows[u][11] === 'YES';
        if (!uParty || uPaid) continue;
        if (!expected[uParty]) expected[uParty] = { rupees: 0, grams: 0 };
        expected[uParty].rupees += DB.num(purRows[u][6]);
        expected[uParty].grams += DB.num(purRows[u][5]);
      }
    } catch (e) { }

    // Sales: unpaid sale entries add to customer outstanding.
    try {
      var saleRows = DB.readAll('Sales', 14);
      for (var s = 0; s < saleRows.length; s++) {
        var sParty = String(saleRows[s][2] || '').trim();
        var sPaid = saleRows[s][13] === 'YES';
        if (!sParty || sPaid) continue;
        if (!expected[sParty]) expected[sParty] = { rupees: 0, grams: 0 };
        expected[sParty].rupees += DB.num(saleRows[s][6]);
        expected[sParty].grams += DB.num(saleRows[s][5]);
      }
    } catch (e) { }

    // Receipts/payments/adjustments subtract from outstanding.
    try {
      var rcptRows = DB.readAll('Receipts', 7);
      for (var r = 0; r < rcptRows.length; r++) {
        var rParty = String(rcptRows[r][2] || '').trim();
        if (!rParty) continue;
        if (!expected[rParty]) expected[rParty] = { rupees: 0, grams: 0 };
        expected[rParty].rupees -= DB.num(rcptRows[r][5]);
        expected[rParty].grams -= DB.num(rcptRows[r][6]);
      }
    } catch (e) { }

    // 2. Compare with stored values in Parties sheet
    var partRows = DB.readAll('Parties', 12);
    var drifted = [];
    var fixed = 0;

    for (var p = 0; p < partRows.length; p++) {
      var pid = String(partRows[p][0] || '').trim();
      if (!pid) continue;

      var storedR = CalcSvc.round2(DB.num(partRows[p][9]));
      var storedG = CalcSvc.round3(DB.num(partRows[p][10]));
      var exp = expected[pid] || { rupees: 0, grams: 0 };
      var expectedR = CalcSvc.round2(exp.rupees);
      var expectedG = CalcSvc.round3(exp.grams);

      var diffR = CalcSvc.round2(storedR - expectedR);
      var diffG = CalcSvc.round3(storedG - expectedG);

      if (diffR !== 0 || diffG !== 0) {
        drifted.push({
          partyId: pid,
          partyName: String(partRows[p][1] || ''),
          storedR: storedR,
          storedG: storedG,
          expectedR: expectedR,
          expectedG: expectedG,
          diffR: diffR,
          diffG: diffG
        });

        if (autoFix) {
          DB.setCells('Parties', p + 2, 10, [[expectedR, expectedG]]);
          OutSvc.audit_(pid, 'RECONCILE_FIX', expectedR - storedR, expectedG - storedG, expectedR, expectedG);
          fixed++;
        }
      }
    }

    Logger.log('OutSvc.reconcile: parties=' + partRows.length + ', drifted=' + drifted.length + ', fixed=' + fixed);
    return { success: true, parties: partRows.length, drifted: drifted, fixed: fixed };
  } catch (e) {
    Logger.log('OutSvc.reconcile error: ' + e.message);
    return { success: false, message: e.message, drifted: [], fixed: 0 };
  }
};

// ── Global backward-compat alias ──────────────────────────────
// partUpdateOutstanding_ was previously in gsparties.gs
function partUpdateOutstanding_(partyId, deltaR, deltaG) {
  return OutSvc.updateDelta(partyId, deltaR, deltaG);
}

// ── Global convenience functions (Run from Apps Script editor) ──

/**
 * Run from Apps Script editor: checks outstanding drift without fixing.
 * View results in Execution Log.
 */
function runReconcileCheck() {
  var result = OutSvc.reconcile(false);
  Logger.log('=== RECONCILE CHECK ===');
  Logger.log('Total parties: ' + result.parties);
  Logger.log('Drifted: ' + result.drifted.length);
  for (var i = 0; i < result.drifted.length; i++) {
    var d = result.drifted[i];
    Logger.log('  ' + d.partyName + ' (' + d.partyId + '): stored ₹' + d.storedR + '/' + d.storedG + 'g → expected ₹' + d.expectedR + '/' + d.expectedG + 'g (diff ₹' + d.diffR + '/' + d.diffG + 'g)');
  }
  return result;
}

/**
 * Run from Apps Script editor: fixes all drifted outstanding values.
 * Creates audit log entries for every fix.
 */
function runReconcileFix() {
  var result = OutSvc.reconcile(true);
  Logger.log('=== RECONCILE FIX ===');
  Logger.log('Fixed: ' + result.fixed + ' of ' + result.drifted.length + ' drifted parties.');
  return result;
}

/**
 * Run from Apps Script editor: recalculates profit on ALL sales.
 */
function runRecalcProfits() {
  var result = StockSvc.recalcSaleProfits();
  Logger.log('=== RECALC PROFITS ===');
  Logger.log('Updated: ' + result.updated + ', Skipped: ' + result.skipped);
  return result;
}

// ============================================================
// _svcStock.gs — Stock & Rate Service
// Owns all purchased-vs-sold balance and avg rate calculations.
// Uses: DB (data layer), CalcSvc (rounding/rates)
// ============================================================

var StockSvc = {};

/**
 * Sum of all purchased grams from Purchase sheet.
 */
StockSvc.getPurchaseTotal = function () {
  var rows = DB.readAll('Purchase', 7);
  var total = 0;
  for (var i = 0; i < rows.length; i++) {
    if (!rows[i][0] && !rows[i][3]) continue;
    total += DB.num(rows[i][5]);
  }
  return CalcSvc.round3(total);
};

/**
 * Sum of all sold grams from Sales sheet.
 */
StockSvc.getSoldTotal = function () {
  var rows = DB.readAll('Sales', 6);
  var total = 0;
  for (var i = 0; i < rows.length; i++) {
    if (!rows[i][0] && !rows[i][3]) continue;
    total += DB.num(rows[i][5]);
  }
  return CalcSvc.round3(total);
};

/**
 * Current stock balance = total purchased − total sold.
 */
StockSvc.getBalance = function () {
  return CalcSvc.round3(StockSvc.getPurchaseTotal() - StockSvc.getSoldTotal());
};

/**
 * Weighted average purchase rate per 10g, optionally date-filtered.
 * @param {Date} [beforeDate] - Only include purchases on or before this date
 */
StockSvc.getAvgPurchaseRate = function (beforeDate) {
  var rows = DB.readAll('Purchase', 11);
  var totalG = 0, totalR = 0;
  for (var i = 0; i < rows.length; i++) {
    if (!rows[i][0] && !rows[i][3]) continue;
    if (beforeDate) {
      var rowDate = rows[i][1] ? new Date(rows[i][1]) : null;
      if (!rowDate || isNaN(rowDate.getTime())) continue;
      if (rowDate > beforeDate) continue;
    }
    totalG += DB.num(rows[i][5]);
    totalR += DB.num(rows[i][6]);
  }
  return CalcSvc.purchaseRate(totalG, totalR);
};

/**
 * Get all-time purchase totals { totalGrams, totalRupees }.
 * Accepts pre-read rows to avoid a redundant sheet read.
 */
StockSvc.getPurchaseTotals = function (purRowsOpt) {
  var rows = purRowsOpt || DB.readAll('Purchase', 7);
  var totalG = 0, totalR = 0;
  for (var i = 0; i < rows.length; i++) {
    if (!rows[i][0] && !rows[i][3]) continue;
    totalG += DB.num(rows[i][5]);
    totalR += DB.num(rows[i][6]);
  }
  return { totalGrams: totalG, totalRupees: totalR };
};

/**
 * Get purchase totals EXCLUDING a specific purchaseId.
 * Accepts pre-read rows to avoid a redundant sheet read.
 */
StockSvc.getPurchaseTotalsExcluding = function (excludeId, purRowsOpt) {
  var rows = purRowsOpt || DB.readAll('Purchase', 7);
  var totalG = 0, totalR = 0;
  for (var i = 0; i < rows.length; i++) {
    if (!rows[i][0] && !rows[i][3]) continue;
    if (String(rows[i][0]).trim() === String(excludeId).trim()) continue;
    totalG += DB.num(rows[i][5]);
    totalR += DB.num(rows[i][6]);
  }
  return { totalGrams: totalG, totalRupees: totalR };
};

/**
 * Get total sold grams EXCLUDING a specific saleId.
 * Used by sale controller when updating an entry.
 */
StockSvc.getSoldTotalExcluding = function (excludeId) {
  var rows = DB.readAll('Sales', 6);
  var total = 0;
  for (var i = 0; i < rows.length; i++) {
    if (!rows[i][0] && !rows[i][3]) continue;
    if (String(rows[i][0]).trim() === String(excludeId).trim()) continue;
    total += DB.num(rows[i][5]);
  }
  return CalcSvc.round3(total);
};

/**
 * Combined data for the Sale form: avg rate + available stock.
 * Reads Purchase sheet only ONCE for both values (performance).
 */
StockSvc.getCalcDataForSaleForm = function () {
  var rows = DB.readAll('Purchase', 7);
  var totalG = 0, totalR = 0;
  for (var i = 0; i < rows.length; i++) {
    if (!rows[i][0] && !rows[i][3]) continue;
    totalG += DB.num(rows[i][5]);
    totalR += DB.num(rows[i][6]);
  }
  var avgRate = CalcSvc.purchaseRate(totalG, totalR);
  var purStock = CalcSvc.round3(totalG);
  var sold = StockSvc.getSoldTotal();
  return { avgRate: avgRate, stockBalance: CalcSvc.round3(purStock - sold) };
};

// ── Stock Guard ──────────────────────────────────────────────

/**
 * Validate that enough stock is available for a sale.
 * @param {number} gramsNeeded   - Grams being sold
 * @param {string} [excludeSaleId] - Sale ID to exclude from sold total (for updates)
 * @returns {{ ok: boolean, available: number, message: string }}
 */
StockSvc.guardStock = function (gramsNeeded, excludeSaleId) {
  var purTotal = StockSvc.getPurchaseTotal();
  var soldTotal = excludeSaleId
    ? StockSvc.getSoldTotalExcluding(excludeSaleId)
    : StockSvc.getSoldTotal();
  var available = CalcSvc.round3(purTotal - soldTotal);
  var needed = CalcSvc.round3(gramsNeeded);

  if (needed > available) {
    return {
      ok: false,
      available: available,
      message: 'Insufficient stock. Available: ' + available + 'g, Requested: ' + needed + 'g.'
    };
  }
  return { ok: true, available: available, message: '' };
};

// ── Profit Recalculation ─────────────────────────────────────

/**
 * Public entry point. Reads Purchase sheet once, then delegates.
 * Called by purDeletePurchase (no pre-read rows available).
 */
StockSvc.recalcSaleProfits = function () {
  var purRows = DB.readAll('Purchase', 7);
  return StockSvc.recalcSaleProfitsWithData_(purRows);
};

/**
 * Internal: accepts pre-read purchase rows to avoid a 2nd sheet read.
 * Called by purAddPurchase / purUpdatePurchase which already read Purchase.
 *
 * PERFORMANCE IMPROVEMENT:
 * - Collects all changed rows first, then writes them in a single batched
 *   setValues call per contiguous range (instead of one setCells per row).
 *
 * @param {Array[][]} purRows - Raw 2D array from DB.readAll('Purchase', 7)
 * @returns {{ updated: number, skipped: number }}
 */
StockSvc.recalcSaleProfitsWithData_ = function (purRows) {
  try {
    // Step 1: Build purchase history sorted by date
    var purchases = [];
    for (var i = 0; i < purRows.length; i++) {
      if (!purRows[i][0] && !purRows[i][3]) continue;
      var pDate = purRows[i][1] ? new Date(purRows[i][1]) : null;
      purchases.push({
        date: pDate,
        grams: DB.num(purRows[i][5]),
        rupees: DB.num(purRows[i][6])
      });
    }
    // Sort by date ascending (null dates go first)
    purchases.sort(function (a, b) {
      if (!a.date && !b.date) return 0;
      if (!a.date) return -1;
      if (!b.date) return 1;
      return a.date.getTime() - b.date.getTime();
    });

    var purTimes = [], purCumG = [], purCumR = [];
    var prefixG = 0, prefixR = 0;
    for (var px = 0; px < purchases.length; px++) {
      prefixG += purchases[px].grams;
      prefixR += purchases[px].rupees;
      purTimes.push(purchases[px].date ? purchases[px].date.getTime() : -8640000000000000);
      purCumG.push(prefixG);
      purCumR.push(prefixR);
    }

    // Step 2: Read all sales
    var saleRows = DB.readAll('Sales', 13);
    var updated = 0, skipped = 0;
    var runningSoldG = 0;

    // Precompute total purchased for stock balance
    var allPurG = 0;
    for (var p = 0; p < purchases.length; p++) allPurG += purchases[p].grams;

    // Step 3: Compute changes — collect pending writes instead of writing immediately
    // pendingWrites: { rowNum (1-indexed sheet row), values: [5 cells] }
    var pendingWrites = [];

    for (var j = 0; j < saleRows.length; j++) {
      if (!saleRows[j][0] && !saleRows[j][3]) { skipped++; continue; }

      var saleDate = saleRows[j][1] ? new Date(saleRows[j][1]) : null;
      var saleG = DB.num(saleRows[j][5]);
      var saleR = DB.num(saleRows[j][6]);

      // Compute avg rate at sale date from prefix totals.
      var cumG = 0, cumR = 0;
      if (purTimes.length) {
        var targetTime = saleDate ? saleDate.getTime() : 8640000000000000;
        var lo = 0, hi = purTimes.length - 1, pos = -1;
        while (lo <= hi) {
          var mid = Math.floor((lo + hi) / 2);
          if (purTimes[mid] <= targetTime) { pos = mid; lo = mid + 1; }
          else hi = mid - 1;
        }
        if (pos >= 0) {
          cumG = purCumG[pos];
          cumR = purCumR[pos];
        }
      }
      var newAvgRate = CalcSvc.purchaseRate(cumG, cumR);
      var newProfit = CalcSvc.saleProfit(saleG, saleR, newAvgRate);

      // Accumulate sold grams for stock balance
      runningSoldG += saleG;
      var newStockBal = CalcSvc.round3(allPurG - runningSoldG);

      // Compare with stored values — only write if changed
      var oldAvgRate = CalcSvc.round2(DB.num(saleRows[j][8]));
      var oldProfitR = CalcSvc.round2(DB.num(saleRows[j][9]));
      var oldProfitP = CalcSvc.round2(DB.num(saleRows[j][10]));

      if (oldAvgRate !== newAvgRate || oldProfitR !== newProfit.profitRup || oldProfitP !== newProfit.profitPct) {
        // j+2 because rows are 0-indexed from readAll and sheet row 1 is the header
        pendingWrites.push({
          rowNum: j + 2,
          values: [newProfit.saleRate10g, newAvgRate, newProfit.profitRup, newProfit.profitPct, newStockBal]
        });
        updated++;
      } else {
        skipped++;
      }
    }

    // Step 4: Batch write — group contiguous rows to minimise API calls
    if (pendingWrites.length > 0) {
      var sh = DB.sheet('Sales');
      // Sort by row number so we can detect contiguous runs
      pendingWrites.sort(function (a, b) { return a.rowNum - b.rowNum; });

      var i = 0;
      while (i < pendingWrites.length) {
        var startRow = pendingWrites[i].rowNum;
        var block = [pendingWrites[i].values];
        var j2 = i + 1;
        // Extend block while rows are contiguous
        while (j2 < pendingWrites.length && pendingWrites[j2].rowNum === pendingWrites[j2 - 1].rowNum + 1) {
          block.push(pendingWrites[j2].values);
          j2++;
        }
        // Single setValues call for the whole contiguous block (cols H–L = 8 to 12)
        sh.getRange(startRow, 8, block.length, 5).setValues(block);
        i = j2;
      }
    }

    Logger.log('StockSvc.recalcSaleProfits: updated=' + updated + ', skipped=' + skipped + ', api_calls=' + pendingWrites.length);
    return { updated: updated, skipped: skipped };
  } catch (e) {
    Logger.log('StockSvc.recalcSaleProfits error: ' + e.message);
    return { updated: 0, skipped: 0, error: e.message };
  }
};
