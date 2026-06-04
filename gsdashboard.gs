// ============================================================
// gsdashboard.gs — Dashboard & Reports Controller
// Uses: DB (data layer), CalcSvc (rounding), OutSvc (outstanding)
// ============================================================

// ── Dashboard Summary ─────────────────────────────────────────
// PERF (B5): Caches the full summary in CacheService for 2 minutes.
// Cache is invalidated by _invalidateDashCache_() in _data.gs,
// which is called by every mutation controller (Add/Update/Delete).
// On cache hit: 0 sheet reads, ~150ms response vs ~2s uncached.

function dashGetSummary() {
  try {
    var CACHE_KEY = 'dash_summary_v1';
    var cache = CacheService.getScriptCache();
    try {
      var cached = cache.get(CACHE_KEY);
      if (cached) return JSON.parse(cached);
    } catch(ce) {}

    var purRows  = DB.readAll('Purchase', 11);
    var saleRows = DB.readAll('Sales', 13);
    var partRows = DB.readAll('Parties', 11);

    // Receipts sheet may not exist yet
    var rcptRows = [];
    try { rcptRows = DB.readAll('Receipts', 11); } catch(e) {}

    var purG = 0, purR = 0, salG = 0, salR = 0, prof = 0, rcpR = 0, rcpG = 0;
    var oSupR = 0, oSupG = 0, oCusR = 0, oCusG = 0;

    for (var i = 0; i < purRows.length;  i++) { purG += DB.num(purRows[i][5]);  purR += DB.num(purRows[i][6]); }
    for (var i = 0; i < saleRows.length; i++) { salG += DB.num(saleRows[i][5]); salR += DB.num(saleRows[i][6]); prof += DB.num(saleRows[i][9]); }
    for (var i = 0; i < rcptRows.length; i++) { rcpR += DB.num(rcptRows[i][5]); rcpG += DB.num(rcptRows[i][6]); }

    // Outstanding by type — computed inline from same partRows (single read)
    for (var i = 0; i < partRows.length; i++) {
      var t = String(partRows[i][2] || '').trim();
      var r = DB.num(partRows[i][9]), g = DB.num(partRows[i][10]);
      if (t === 'Supplier')      { oSupR += r; oSupG += g; }
      else if (t === 'Customer') { oCusR += r; oCusG += g; }
      else if (t === 'Both')     { oSupR += r; oSupG += g; oCusR += r; oCusG += g; }
    }

    var result = DB.safeReturn({
      success: true,
      parties: partRows.length, purchases: purRows.length, sales: saleRows.length, payments: rcptRows.length,
      purGrams: CalcSvc.round3(purG), purRupees: CalcSvc.round2(purR),
      saleGrams: CalcSvc.round3(salG), saleRupees: CalcSvc.round2(salR),
      rcptRupees: CalcSvc.round2(rcpR), rcptGrams: CalcSvc.round3(rcpG),
      stockGrams: CalcSvc.round3(purG - salG),
      avgPurRate: purG > 0 ? CalcSvc.round2((purR / purG) * 10) : 0,
      profitRupees: CalcSvc.round2(prof),
      profitPct: purR > 0 ? CalcSvc.round2((prof / purR) * 100) : 0,
      outSupRupees: CalcSvc.round2(oSupR), outSupGrams: CalcSvc.round3(oSupG),
      outCustRupees: CalcSvc.round2(oCusR), outCustGrams: CalcSvc.round3(oCusG)
    });

    // Cache for 2 minutes
    try { cache.put(CACHE_KEY, JSON.stringify(result), 120); } catch(ce) {}
    return result;
  } catch (e) {
    Logger.log('dashGetSummary: ' + e.message);
    return { success: false, message: e.message };
  }
}


// ── Reports Data ──────────────────────────────────────────────

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
