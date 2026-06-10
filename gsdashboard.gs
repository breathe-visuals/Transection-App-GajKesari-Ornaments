// ============================================================
// gsdashboard.gs — Dashboard & Reports Controller
// Uses: DB (data layer), CalcSvc (rounding), OutSvc (outstanding)
// ============================================================

// ── Dashboard Summary ─────────────────────────────────────────
// PERF (B5): Caches the full summary in CacheService for 2 minutes.
// Cache is invalidated by _invalidateDashCache_() in _data.gs,
// which is called by every mutation controller (Add/Update/Delete).
// On cache hit: 0 sheet reads, ~150ms response vs ~2s uncached.

var DASH_CACHE_SHEET = 'DashboardCache';
var DASH_CACHE_RANGE_NAME = 'RANGEDASHBOARD';
var DASH_RUPEE = '\u20b9';
var DASH_CACHE_HEADERS = ['Key', 'Value ' + DASH_RUPEE, 'Value g', 'Value %', 'Value Digit'];
var DASH_CACHE_KEYS = [
  'Total Parties',
  'Total Purchase',
  'Total Sales',
  'Total Receipts',
  'Total Payments',
  'Supplier Outstanding ' + DASH_RUPEE,
  'Supplier Outstanding g',
  'Customer Outstanding ' + DASH_RUPEE,
  'Customer Outstanding g',
  'Total Purchase (' + DASH_RUPEE + ')',
  'Total Purchase (g)',
  'Total Sales (' + DASH_RUPEE + ')',
  'Total Sales (g)',
  'Total Receipts (' + DASH_RUPEE + ')',
  'Stock Balance (g)',
  'Avg Purchase Rate/10g',
  'Total Profit (' + DASH_RUPEE + ')',
  'Profit %'
];

function dashKey_(label) {
  return String(label || '').replace(/\?/g, DASH_RUPEE).replace(/\u20b9/g, DASH_RUPEE);
}

function dashFormula_(valueRupees, valueGrams, valuePct, valueDigit) {
  return [valueRupees || 0, valueGrams || 0, valuePct || 0, valueDigit || 0];
}

function dashEnsureCacheSheet_() {
  DB.ensureSheet('Parties', typeof PART_HEADERS !== 'undefined' ? PART_HEADERS : null);
  DB.ensureSheet('Purchase', typeof PUR_HEADERS !== 'undefined' ? PUR_HEADERS : null);
  DB.ensureSheet('Sales', typeof SALE_HEADERS !== 'undefined' ? SALE_HEADERS : null);
  DB.ensureSheet('Receipts', typeof RCPT_HEADERS !== 'undefined' ? RCPT_HEADERS : null);

  var ss = DB.ss();
  var sh = DB.ensureSheet(DASH_CACHE_SHEET, DASH_CACHE_HEADERS);
  sh.getRange(1, 1, 1, DASH_CACHE_HEADERS.length).setValues([DASH_CACHE_HEADERS]);

  var receiptRows = 'LEN(Receipts!A2:A)';
  var receiptType = '((Receipts!K2:K="Receipt")+(Receipts!K2:K=""))';
  var paymentType = '(Receipts!K2:K="Payment")';
  var supplierType = '((Parties!C2:C="Supplier")+(Parties!C2:C="Both"))';
  var customerType = '((Parties!C2:C="Customer")+(Parties!C2:C="Both"))';

  var rows = [
    ['Total Parties'].concat(dashFormula_(0, 0, 0, '=IFERROR(COUNTA(Parties!A2:A),0)')),
    ['Total Purchase'].concat(dashFormula_('=IFERROR(SUM(Purchase!G2:G),0)', '=IFERROR(SUM(Purchase!F2:F),0)', 0, '=IFERROR(COUNTA(Purchase!A2:A),0)')),
    ['Total Sales'].concat(dashFormula_('=IFERROR(SUM(Sales!G2:G),0)', '=IFERROR(SUM(Sales!F2:F),0)', 0, '=IFERROR(COUNTA(Sales!A2:A),0)')),
    ['Total Receipts'].concat(dashFormula_(
      '=IFERROR(SUM(FILTER(Receipts!F2:F,' + receiptRows + ',' + receiptType + ')),0)',
      '=IFERROR(SUM(FILTER(Receipts!G2:G,' + receiptRows + ',' + receiptType + ')),0)',
      0,
      '=IFERROR(ROWS(FILTER(Receipts!A2:A,' + receiptRows + ',' + receiptType + ')),0)'
    )),
    ['Total Payments'].concat(dashFormula_(
      '=IFERROR(SUM(FILTER(Receipts!F2:F,' + receiptRows + ',' + paymentType + ')),0)',
      '=IFERROR(SUM(FILTER(Receipts!G2:G,' + receiptRows + ',' + paymentType + ')),0)',
      0,
      '=IFERROR(ROWS(FILTER(Receipts!A2:A,' + receiptRows + ',' + paymentType + ')),0)'
    )),
    ['Supplier Outstanding ' + DASH_RUPEE].concat(dashFormula_('=IFERROR(SUM(FILTER(Parties!J2:J,LEN(Parties!A2:A),' + supplierType + ')),0)', 0, 0, 0)),
    ['Supplier Outstanding g'].concat(dashFormula_(0, '=IFERROR(SUM(FILTER(Parties!K2:K,LEN(Parties!A2:A),' + supplierType + ')),0)', 0, 0)),
    ['Customer Outstanding ' + DASH_RUPEE].concat(dashFormula_('=IFERROR(SUM(FILTER(Parties!J2:J,LEN(Parties!A2:A),' + customerType + ')),0)', 0, 0, 0)),
    ['Customer Outstanding g'].concat(dashFormula_(0, '=IFERROR(SUM(FILTER(Parties!K2:K,LEN(Parties!A2:A),' + customerType + ')),0)', 0, 0)),
    ['Total Purchase (' + DASH_RUPEE + ')'].concat(dashFormula_('=IFERROR(SUM(Purchase!G2:G),0)', 0, 0, 0)),
    ['Total Purchase (g)'].concat(dashFormula_(0, '=IFERROR(SUM(Purchase!F2:F),0)', 0, 0)),
    ['Total Sales (' + DASH_RUPEE + ')'].concat(dashFormula_('=IFERROR(SUM(Sales!G2:G),0)', 0, 0, 0)),
    ['Total Sales (g)'].concat(dashFormula_(0, '=IFERROR(SUM(Sales!F2:F),0)', 0, 0)),
    ['Total Receipts (' + DASH_RUPEE + ')'].concat(dashFormula_('=IFERROR(SUM(FILTER(Receipts!F2:F,' + receiptRows + ',' + receiptType + ')),0)', 0, 0, 0)),
    ['Stock Balance (g)'].concat(dashFormula_(0, '=IFERROR(SUM(Purchase!F2:F)-SUM(Sales!F2:F),0)', 0, 0)),
    ['Avg Purchase Rate/10g'].concat(dashFormula_('=IFERROR((SUM(Purchase!G2:G)/SUM(Purchase!F2:F))*10,0)', 0, 0, 0)),
    ['Total Profit (' + DASH_RUPEE + ')'].concat(dashFormula_('=IFERROR(SUM(Sales!J2:J),0)', 0, 0, 0)),
    ['Profit %'].concat(dashFormula_(0, 0, '=IFERROR((SUM(Sales!J2:J)/SUM(Purchase!G2:G))*100,0)', 0))
  ];

  if (sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, DASH_CACHE_HEADERS.length).clearContent();
  }
  sh.getRange(2, 1, rows.length, DASH_CACHE_HEADERS.length).setValues(rows);
  sh.setFrozenRows(1);
  sh.getRange(2, 2, rows.length, 1).setNumberFormat(DASH_RUPEE + '#,##0.00');
  sh.getRange(2, 3, rows.length, 1).setNumberFormat('0.000');
  sh.getRange(2, 4, rows.length, 1).setNumberFormat('0.00');
  sh.getRange(2, 5, rows.length, 1).setNumberFormat('0');
  var namedRanges = ss.getNamedRanges();
  for (var nr = 0; nr < namedRanges.length; nr++) {
    if (namedRanges[nr].getName() === DASH_CACHE_RANGE_NAME) namedRanges[nr].remove();
  }
  ss.setNamedRange(DASH_CACHE_RANGE_NAME, sh.getRange(1, 1, rows.length + 1, DASH_CACHE_HEADERS.length));
  SpreadsheetApp.flush();
  return sh;
}

function dashReadCacheMap_() {
  var ss = DB.ss();
  dashEnsureCacheSheet_();
  var range = ss.getRangeByName(DASH_CACHE_RANGE_NAME);
  if (!range) range = ss.getSheetByName(DASH_CACHE_SHEET).getRange(1, 1, DASH_CACHE_KEYS.length + 1, DASH_CACHE_HEADERS.length);
  var values = range.getValues();
  var rows = values.slice(1);
  var map = {};
  for (var i = 0; i < rows.length; i++) {
    var key = dashKey_(rows[i][0]);
    if (!key) continue;
    map[key] = {
      rupees: DB.num(rows[i][1]),
      grams: DB.num(rows[i][2]),
      pct: DB.num(rows[i][3]),
      digit: DB.num(rows[i][4])
    };
  }
  return map;
}

function dashCacheVal_(map, key, col) {
  var row = map[dashKey_(key)] || {};
  return DB.num(row[col]);
}

function dashGetSummary() {
  try {
    var CACHE_KEY = 'dash_summary_v2';
    var cache = CacheService.getScriptCache();
    try {
      var cached = cache.get(CACHE_KEY);
      if (cached) return JSON.parse(cached);
    } catch (ce) {}

    var m = dashReadCacheMap_();
    var result = DB.safeReturn({
      success: true,
      parties: dashCacheVal_(m, 'Total Parties', 'digit'),
      purchases: dashCacheVal_(m, 'Total Purchase', 'digit'),
      sales: dashCacheVal_(m, 'Total Sales', 'digit'),
      receipts: dashCacheVal_(m, 'Total Receipts', 'digit'),
      payments: dashCacheVal_(m, 'Total Payments', 'digit'),
      purGrams: CalcSvc.round3(dashCacheVal_(m, 'Total Purchase (g)', 'grams')),
      purRupees: CalcSvc.round2(dashCacheVal_(m, 'Total Purchase (' + DASH_RUPEE + ')', 'rupees')),
      saleGrams: CalcSvc.round3(dashCacheVal_(m, 'Total Sales (g)', 'grams')),
      saleRupees: CalcSvc.round2(dashCacheVal_(m, 'Total Sales (' + DASH_RUPEE + ')', 'rupees')),
      rcptRupees: CalcSvc.round2(dashCacheVal_(m, 'Total Receipts (' + DASH_RUPEE + ')', 'rupees')),
      rcptGrams: CalcSvc.round3(dashCacheVal_(m, 'Total Receipts', 'grams')),
      payRupees: CalcSvc.round2(dashCacheVal_(m, 'Total Payments', 'rupees')),
      payGrams: CalcSvc.round3(dashCacheVal_(m, 'Total Payments', 'grams')),
      stockGrams: CalcSvc.round3(dashCacheVal_(m, 'Stock Balance (g)', 'grams')),
      avgPurRate: CalcSvc.round2(dashCacheVal_(m, 'Avg Purchase Rate/10g', 'rupees')),
      profitRupees: CalcSvc.round2(dashCacheVal_(m, 'Total Profit (' + DASH_RUPEE + ')', 'rupees')),
      profitPct: CalcSvc.round2(dashCacheVal_(m, 'Profit %', 'pct')),
      outSupRupees: CalcSvc.round2(dashCacheVal_(m, 'Supplier Outstanding ' + DASH_RUPEE, 'rupees')),
      outSupGrams: CalcSvc.round3(dashCacheVal_(m, 'Supplier Outstanding g', 'grams')),
      outCustRupees: CalcSvc.round2(dashCacheVal_(m, 'Customer Outstanding ' + DASH_RUPEE, 'rupees')),
      outCustGrams: CalcSvc.round3(dashCacheVal_(m, 'Customer Outstanding g', 'grams')),
      rangeName: DASH_CACHE_RANGE_NAME
    });

    try { cache.put(CACHE_KEY, JSON.stringify(result), 120); } catch (ce2) {}
    return result;
  } catch (e) {
    Logger.log('dashGetSummary: ' + e.message);
    return { success: false, message: e.message };
  }
}


// Reports Data
function repGetReportData(filters) {
  try {
    filters = filters || {};
    var dateFrom = filters.dateFrom ? new Date(filters.dateFrom) : null;
    var dateTo   = filters.dateTo   ? new Date(filters.dateTo + 'T23:59:59') : null;
    var party    = (filters.party   || '').trim().toLowerCase();
    var area     = (filters.area    || '').trim().toLowerCase();
    var module   = filters.module   || 'all';

    function inRange(val) {
      if (!val) return true;
      try {
        var d = new Date(val);
        if (isNaN(d.getTime())) return true;
        if (dateFrom && d < dateFrom) return false;
        if (dateTo   && d > dateTo)   return false;
        return true;
      } catch(e) { return true; }
    }
    function matchParty(name) { return !party || String(name || '').toLowerCase().includes(party); }
    function matchArea(a)     { return !area  || String(a || '').toLowerCase().includes(area); }

    var result = { success: true, purchase: [], sales: [], payments: [], summary: {} };

    if (module === 'all' || module === 'purchase') {
      var purRows = DB.readAll('Purchase', 11);
      purRows.forEach(function(r) {
        if (!inRange(r[1]) || !matchParty(r[3]) || !matchArea(r[4])) return;
        result.purchase.push({
          purchaseId: r[0], date: DB.dateRaw(r[1]), partyId: r[2], partyName: r[3], area: r[4],
          grams: r[5], rupees: r[6], rate10g: r[7], avgRate: r[8], stockBal: r[9], note: r[10]
        });
      });
    }

    if (module === 'all' || module === 'sales') {
      var saleRows = DB.readAll('Sales', 13);
      saleRows.forEach(function(r) {
        if (!inRange(r[1]) || !matchParty(r[3]) || !matchArea(r[4])) return;
        result.sales.push({
          saleId: r[0], date: DB.dateRaw(r[1]), partyId: r[2], partyName: r[3], area: r[4],
          grams: r[5], rupees: r[6], rate10g: r[7], avgRate: r[8],
          profitR: r[9], profitPct: r[10], stockBal: r[11], note: r[12]
        });
      });
    }

    if (module === 'all' || module === 'payments') {
      var rcptRows = [];
      try { rcptRows = DB.readAll('Receipts', 11); } catch(e) {}
      rcptRows.forEach(function(r) {
        if (!inRange(r[1]) || !matchParty(r[3]) || !matchArea(r[4])) return;
        result.payments.push({
          paymentId: r[0], date: DB.dateRaw(r[1]), partyId: r[2], partyName: r[3], area: r[4],
          rupeesRP: r[5], gramsRP: r[6], outR: r[7], outG: r[8],
          note: r[9], entryType: r[10] ? String(r[10]) : 'Receipt'
        });
      });
    }

    // Aggregate summary from filtered results
    var purG = 0, purR = 0, salG = 0, salR = 0, prof = 0, payR = 0, payG = 0;
    result.purchase.forEach(function(r) { purG += DB.num(r.grams); purR += DB.num(r.rupees); });
    result.sales.forEach(function(r)    { salG += DB.num(r.grams); salR += DB.num(r.rupees); prof += DB.num(r.profitR); });
    result.payments.forEach(function(r) { payR += DB.num(r.rupeesRP); payG += DB.num(r.gramsRP); });

    var outByType = OutSvc.getByType();
    result.summary = {
      purGrams: CalcSvc.round3(purG), purRupees: CalcSvc.round2(purR),
      saleGrams: CalcSvc.round3(salG), saleRupees: CalcSvc.round2(salR),
      profitRupees: CalcSvc.round2(prof),
      profitPct: purR > 0 ? CalcSvc.round2((prof / purR) * 100) : 0,
      payRupees: CalcSvc.round2(payR), payGrams: CalcSvc.round3(payG),
      stockGrams: CalcSvc.round3(purG - salG),
      outSupRupees: outByType.supRupees, outSupGrams: outByType.supGrams,
      outCustRupees: outByType.custRupees, outCustGrams: outByType.custGrams
    };

    var maxRows = Math.min(Math.max(parseInt(filters.maxRows || 500, 10) || 500, 100), 2000);
    result.counts = {
      purchase: result.purchase.length,
      sales: result.sales.length,
      payments: result.payments.length,
      maxRows: maxRows
    };
    result.truncated = result.purchase.length > maxRows || result.sales.length > maxRows || result.payments.length > maxRows;
    result.purchase = result.purchase.slice(0, maxRows);
    result.sales = result.sales.slice(0, maxRows);
    result.payments = result.payments.slice(0, maxRows);

    return result;
  } catch (e) {
    Logger.log('repGetReportData: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ── Parties for filter dropdown ───────────────────────────────

function repGetPartyList() {
  try {
    var rows = DB.readAll('Parties', 2);
    var names = [];
    for (var i = 0; i < rows.length; i++) {
      var n = String(rows[i][1] || '').trim();
      if (n) names.push(n);
    }
    return { success: true, data: names };
  } catch (e) { return { success: false, data: [] }; }
}
