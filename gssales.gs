// ============================================================
// gssales.gs — Sales Controller
// Thin wrapper: validates → calls DB/StockSvc/CalcSvc/OutSvc → returns.
// ============================================================

var SALE_COL_COUNT = 14;
var SALE_HEADERS   = [
  'Sale ID','Date','Party ID','Party Name','Area',
  'Grams','Rupees','Sale Rate/10g','Avg Purchase Rate Used',
  'Profit Rupees','Profit %','Stock Balance Grams','Note','Is Paid'
];

// ── Validation ────────────────────────────────────────────────

function saleValidateInput_(d) {
  if (!d.saleId)                  return 'Sale ID is required.';
  if (!DB.isValidDate(d.date))    return 'Date is required and must be valid (YYYY-MM-DD).';
  if (!d.partyId && !d.partyName) return 'Party is required.';
  var g = Number(d.grams);
  if (isNaN(g) || g <= 0)         return 'Grams must be greater than 0.';
  var r = Number(d.rupees);
  if (isNaN(r) || r < 0)          return 'Rupees cannot be negative.';
  return null;
}

// ── Row mapper ────────────────────────────────────────────────

function saleMapRow_(r, rowIndex) {
  return {
    saleId        : r[0],
    date          : DB.formatDate(r[1]),
    dateRaw       : DB.dateRaw(r[1]),
    partyId       : r[2],
    partyName     : r[3],
    area          : r[4],
    grams         : r[5],
    rupees        : r[6],
    saleRate10g   : r[7],
    avgPurRate    : r[8],
    profitRupees  : r[9],
    profitPct     : r[10],
    stockBalGrams : r[11],
    note          : r[12],
    isPaid        : r[13] === 'YES'
  };
}

// ── Public: Get All ───────────────────────────────────────────

function saleGetAllSales() {
  try {
    var rows = DB.readAll('Sales', SALE_COL_COUNT);
    var result = [];
    for (var i = 0; i < rows.length; i++) {
      if (!String(rows[i][0]).trim() && !String(rows[i][3]).trim()) continue;
      result.push(saleMapRow_(rows[i], i + 2));
    }
    return { success: true, data: result };
  } catch (e) {
    Logger.log('saleGetAllSales: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ── Public: Check ID ──────────────────────────────────────────

function saleCheckIdExists(saleId) {
  try { return { exists: DB.findRowById('Sales', saleId) !== -1 }; }
  catch (e) { return { exists: false }; }
}

// ── Public: Parties Dropdown ──────────────────────────────────

function saleGetPartiesForDropdown() {
  try {
    var parties = DB.getPartiesForDropdown(false);
    var filtered = parties.filter(function(p) { return p.partyType === 'Customer' || p.partyType === 'Both'; });
    return { success: true, data: filtered };
  } catch (e) { return { success: false, message: e.message }; }
}

// ── Public: Sale Calc Data (avg rate + stock) ─────────────────

function saleGetCalcData() {
  try {
    var data = StockSvc.getCalcDataForSaleForm();
    return { success: true, avgRate: data.avgRate, stockBalance: data.stockBalance };
  } catch (e) { return { success: false, message: e.message }; }
}

// ── Public: Add ───────────────────────────────────────────────

function saleAddSale(d) {
  try {
    var valErr = saleValidateInput_(d);
    if (valErr) return { success: false, message: valErr };

    // C3: sanitize text inputs
    var saleId    = DB.sanitizeText(d.saleId, 20);
    var partyId   = DB.sanitizeText(d.partyId, 20);
    var partyName = DB.sanitizeText(d.partyName, 100);
    var area      = DB.sanitizeText(d.area, 100);
    var note      = DB.sanitizeText(d.note, 500);
    var isPaid    = d.isPaid ? 'YES' : '';

    DB.ensureSheet('Sales', SALE_HEADERS);
    if (DB.findRowById('Sales', saleId) !== -1)
      return { success: false, message: 'Sale ID already exists. Please regenerate.' };

    var grams    = DB.num(d.grams);
    var rupees   = DB.num(d.rupees);
    // H2: timezone-safe date parsing
    var dateVal  = DB.parseDate(d.date) || '';
    var saleDate = dateVal || new Date();

    var guard = StockSvc.guardStock(grams);
    if (!guard.ok) return { success: false, message: guard.message };

    // M5: always compute avgRate server-side — do not trust client value
    var avgRate  = StockSvc.getAvgPurchaseRate(saleDate);
    var profit   = CalcSvc.saleProfit(grams, rupees, avgRate);
    var stockBal = CalcSvc.round3(guard.available - grams);

    var newRow = DB.appendRow('Sales', SALE_COL_COUNT, [
      saleId, dateVal, partyId, partyName, area,
      grams, rupees, profit.saleRate10g, avgRate,
      profit.profitRup, profit.profitPct, stockBal, note, isPaid
    ]);
    DB.setDateFormat('Sales', newRow, 2);

    if (partyId && !d.isPaid) OutSvc.updateDelta(partyId, +rupees, +grams);

    _invalidateDashCache_();
    _invalidateSearchCache_();
    _invalidateRefCache_();
    return { success: true, message: 'New Sale Added' };
  } catch (e) {
    return DB.safeError(e, 'saleAddSale');
  }
}

// ── Public: Update ────────────────────────────────────────────

function saleUpdateSale(d) {
  try {
    var valErr = saleValidateInput_(d);
    if (valErr) return { success: false, message: valErr };

    // C3: sanitize text inputs
    var saleId    = DB.sanitizeText(d.saleId, 20);
    var partyId   = DB.sanitizeText(d.partyId, 20);
    var partyName = DB.sanitizeText(d.partyName, 100);
    var area      = DB.sanitizeText(d.area, 100);
    var note      = DB.sanitizeText(d.note, 500);
    var isPaid    = d.isPaid ? 'YES' : '';

    var targetRow = DB.findRowById('Sales', saleId);
    if (targetRow === -1) return { success: false, message: 'Sale record not found.' };

    var oldRow     = DB.getRow('Sales', targetRow, SALE_COL_COUNT);
    var oldPartyId = String(oldRow[2] || '');
    var oldGrams   = DB.num(oldRow[5]);
    var oldRupees  = DB.num(oldRow[6]);
    var oldIsPaid  = oldRow[13] === 'YES';

    var grams    = DB.num(d.grams);
    var rupees   = DB.num(d.rupees);
    // H2: timezone-safe date parsing
    var dateVal  = DB.parseDate(d.date) || '';
    var saleDate = dateVal || new Date();

    var guard = StockSvc.guardStock(grams, saleId);
    if (!guard.ok) return { success: false, message: guard.message };

    // M5: always compute avgRate server-side
    var oldAvgRate = DB.num(oldRow[8]);
    var avgRate    = oldAvgRate > 0 ? oldAvgRate : StockSvc.getAvgPurchaseRate(saleDate);

    var profit   = CalcSvc.saleProfit(grams, rupees, avgRate);
    var stockBal = CalcSvc.round3(guard.available - grams);

    DB.updateRow('Sales', targetRow, SALE_COL_COUNT, [
      saleId, dateVal, partyId, partyName, area,
      grams, rupees, profit.saleRate10g, avgRate,
      profit.profitRup, profit.profitPct, stockBal, note, isPaid
    ]);
    DB.setDateFormat('Sales', targetRow, 2);

    var newPartyId = partyId;
    if (oldPartyId && !oldIsPaid) OutSvc.updateDelta(oldPartyId, -oldRupees, -oldGrams);
    if (newPartyId && !d.isPaid) OutSvc.updateDelta(newPartyId, +rupees, +grams);

    _invalidateDashCache_();
    _invalidateSearchCache_();
    _invalidateRefCache_();
    return { success: true, message: 'Sale Updated' };
  } catch (e) {
    return DB.safeError(e, 'saleUpdateSale');
  }
}

// ── Public: Delete ────────────────────────────────────────────

function saleDeleteSale(saleId) {
  try {
    var targetRow = DB.findRowById('Sales', saleId);
    if (targetRow === -1) return { success: false, message: 'Sale record not found.' };

    var oldRow    = DB.getRow('Sales', targetRow, SALE_COL_COUNT);
    var partyId   = String(oldRow[2] || '');
    var oldRupees = DB.num(oldRow[6]);
    var oldGrams  = DB.num(oldRow[5]);
    var oldIsPaid = oldRow[13] === 'YES';

    DB.deleteRow('Sales', targetRow);
    if (partyId && !oldIsPaid) OutSvc.updateDelta(partyId, -oldRupees, -oldGrams);

    _invalidateDashCache_();
    _invalidateSearchCache_();
    _invalidateRefCache_();
    return { success: true, message: 'Sale Deleted' };
  } catch (e) {
    Logger.log('saleDeleteSale: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ── Public: Bulk Delete ───────────────────────────────────────
// PERF (B6): Uses compact-rewrite for large bulk deletes.

function saleBulkDelete(ids) {
  try {
    var idSet = {};
    for (var k = 0; k < ids.length; k++) idSet[String(ids[k]).trim()] = true;

    if (ids.length >= 10) {
      // H3 fix: collect outstanding data BEFORE the rewrite so we can reverse it
      var rows = DB.readAll('Sales', SALE_COL_COUNT);
      var deltas = [];
      for (var ri = 0; ri < rows.length; ri++) {
        if (!idSet[String(rows[ri][0]).trim()]) continue;
        var pid = String(rows[ri][2] || '');
        var rPaid = rows[ri][13] === 'YES';
        if (pid && !rPaid) deltas.push({ partyId: pid, rupees: -DB.num(rows[ri][6]), grams: -DB.num(rows[ri][5]) });
      }
      OutSvc.updateDeltas(deltas);
      var deleted = DB.bulkDeleteAndRewrite('Sales', SALE_COL_COUNT, ids);
      _invalidateDashCache_();
      _invalidateSearchCache_();
      _invalidateRefCache_();
      return { success: true, message: deleted + ' sale(s) deleted.' };
    }

    var rows2 = DB.readAll('Sales', SALE_COL_COUNT);
    var toDelete = [];
    for (var i = 0; i < rows2.length; i++) {
      if (!idSet[String(rows2[i][0]).trim()]) continue;
      toDelete.push({
        rowIdx: i + 2, partyId: String(rows2[i][2] || ''),
        rupees: DB.num(rows2[i][6]), grams: DB.num(rows2[i][5]),
        isPaid: rows2[i][13] === 'YES'
      });
    }
    toDelete.sort(function(a, b) { return b.rowIdx - a.rowIdx; });
    var smallDeltas = [];
    for (var j = 0; j < toDelete.length; j++) {
      DB.deleteRow('Sales', toDelete[j].rowIdx);
      if (toDelete[j].partyId && !toDelete[j].isPaid) {
        smallDeltas.push({ partyId: toDelete[j].partyId, rupees: -toDelete[j].rupees, grams: -toDelete[j].grams });
      }
    }
    OutSvc.updateDeltas(smallDeltas);
    _invalidateDashCache_();
    _invalidateSearchCache_();
    _invalidateRefCache_();
    return { success: true, message: toDelete.length + ' sale(s) deleted.' };
  } catch (e) {
    return DB.safeError(e, 'saleBulkDelete');
  }
}

// ── Public: Paginated Read ────────────────────────────────────
// PERF (B4): Filter on raw rows before mapping to objects.

function saleGetPage(params) {
  try {
    var p        = params || {};
    var pageSize = parseInt(p.pageSize, 10) || getPageSize_();
    var page     = Math.max(1, parseInt(p.page, 10) || 1);
    var q        = String(p.searchQ || '').trim().toLowerCase().substring(0, 100); // L2: cap
    var col      = String(p.searchCol || 'all');
    var validCols = { 'all':true,'0':true,'1':true,'3':true,'4':true };
    if (!validCols[col]) col = 'all'; // whitelist

    // Fast path: no filter
    if (!q) {
      var pg = DB.readPage('Sales', SALE_COL_COUNT, (page - 1) * pageSize, pageSize);
      var data = [];
      for (var i = 0; i < pg.rows.length; i++) {
        if (!String(pg.rows[i][0]).trim() && !String(pg.rows[i][3]).trim()) continue;
        data.push(saleMapRow_(pg.rows[i], pg.offset + i + 2));
      }
      return DB.safeReturn({ success: true, data: data, total: pg.total, page: page, pageSize: pageSize });
    }

    // Filter path: scan raw rows, map only matching ones
    var allRows = DB.readAll('Sales', SALE_COL_COUNT);
    var matchingIdxs = [];
    for (var i = 0; i < allRows.length; i++) {
      var r = allRows[i];
      if (!r[0] && !r[3]) continue;
      var hit = false;
      if      (col === '0') hit = String(r[0]).toLowerCase().indexOf(q) !== -1;
      else if (col === '3') hit = String(r[3]).toLowerCase().indexOf(q) !== -1;
      else if (col === '4') hit = String(r[4]).toLowerCase().indexOf(q) !== -1;
      else if (col === '1') hit = String(r[1]).toLowerCase().indexOf(q) !== -1;
      else                  hit = (String(r[0]) + String(r[1]) + String(r[3]) + String(r[4]) + String(r[12])).toLowerCase().indexOf(q) !== -1;
      if (hit) matchingIdxs.push(i);
    }
    var total = matchingIdxs.length;
    var start = (page - 1) * pageSize;
    var pageIdxs = matchingIdxs.slice(start, start + pageSize);
    var data = [];
    for (var m = 0; m < pageIdxs.length; m++) {
      data.push(saleMapRow_(allRows[pageIdxs[m]], pageIdxs[m] + 2));
    }
    return DB.safeReturn({ success: true, data: data, total: total, page: page, pageSize: pageSize });
  } catch (e) {
    Logger.log('saleGetPage: ' + e.message);
    return { success: false, message: e.message };
  }
}

// Concurrency guard: sale writes affect stock and party outstanding.
var saleAddSale_raw = saleAddSale;
saleAddSale = function() {
  var args = arguments;
  return DB.withWriteLock('saleAddSale', function() {
    return saleAddSale_raw.apply(null, args);
  });
};

var saleUpdateSale_raw = saleUpdateSale;
saleUpdateSale = function() {
  var args = arguments;
  return DB.withWriteLock('saleUpdateSale', function() {
    return saleUpdateSale_raw.apply(null, args);
  });
};

var saleDeleteSale_raw = saleDeleteSale;
saleDeleteSale = function() {
  var args = arguments;
  return DB.withWriteLock('saleDeleteSale', function() {
    return saleDeleteSale_raw.apply(null, args);
  });
};

var saleBulkDelete_raw = saleBulkDelete;
saleBulkDelete = function() {
  var args = arguments;
  return DB.withWriteLock('saleBulkDelete', function() {
    return saleBulkDelete_raw.apply(null, args);
  });
};
