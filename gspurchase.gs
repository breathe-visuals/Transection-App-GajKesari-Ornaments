// ============================================================
// gspurchase.gs — Purchase Controller
// Thin wrapper: validates → calls DB/StockSvc/CalcSvc → returns response.
// ============================================================

var PUR_COL_COUNT = 12;
var PUR_HEADERS = [
  'Purchase ID', 'Date', 'Party ID', 'Party Name', 'Area',
  'Grams', 'Rupees', 'Rate/10g', 'Avg Purchase Rate',
  'Stock Balance Grams', 'Note', 'Is Paid'
];

// ── Validation ────────────────────────────────────────────────

function purValidateInput_(d) {
  if (!d.purchaseId) return 'Purchase ID is required.';
  if (!DB.isValidDate(d.date)) return 'Date is required and must be valid (YYYY-MM-DD).';
  if (!d.partyId && !d.partyName) return 'Party is required.';
  var g = Number(d.grams);
  if (isNaN(g) || g <= 0) return 'Grams must be greater than 0.';
  var r = Number(d.rupees);
  if (isNaN(r) || r < 0) return 'Rupees cannot be negative.';
  return null;
}

// ── Row mapper ────────────────────────────────────────────────

function purMapRow_(r, rowIndex) {
  return {
    purchaseId: r[0],
    date: DB.formatDate(r[1]),
    dateRaw: DB.dateRaw(r[1]),
    partyId: r[2],
    partyName: r[3],
    area: r[4],
    grams: r[5],
    rupees: r[6],
    rate10g: r[7],
    avgPurRate: r[8],
    stockBalGrams: r[9],
    note: r[10],
    isPaid: r[11] === 'YES'
  };
}

// ── Public: Get All ───────────────────────────────────────────

function purGetAllPurchases() {
  try {
    var rows = DB.readAll('Purchase', PUR_COL_COUNT);
    var result = [];
    for (var i = 0; i < rows.length; i++) {
      if (!String(rows[i][0]).trim() && !String(rows[i][3]).trim()) continue;
      result.push(purMapRow_(rows[i], i + 2));
    }
    return { success: true, data: result };
  } catch (e) {
    Logger.log('purGetAllPurchases: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ── Public: Check ID ──────────────────────────────────────────

function purCheckIdExists(purchaseId) {
  try { return { exists: DB.findRowById('Purchase', purchaseId) !== -1 }; }
  catch (e) { return { exists: false }; }
}

// ── Public: Parties Dropdown ──────────────────────────────────

function purGetPartiesForDropdown() {
  try {
    var parties = DB.getPartiesForDropdown(false);
    var filtered = parties.filter(function (p) { return p.partyType === 'Supplier' || p.partyType === 'Both'; });
    return { success: true, data: filtered };
  } catch (e) { return { success: false, message: e.message }; }
}

// ── Public: Add ───────────────────────────────────────────────
// PERF: Reads Purchase sheet ONCE and passes it to StockSvc,
// eliminating 2 redundant DB.readAll calls vs the previous pattern.

function purAddPurchase(d) {
  try {
    var valErr = purValidateInput_(d);
    if (valErr) return { success: false, message: valErr };

    // C3: sanitize all text inputs before writing
    var purchaseId = DB.sanitizeText(d.purchaseId, 20);
    var partyId = DB.sanitizeText(d.partyId, 20);
    var partyName = DB.sanitizeText(d.partyName, 100);
    var area = DB.sanitizeText(d.area, 100);
    var note = DB.sanitizeText(d.note, 500);
    var isPaid = d.isPaid ? 'YES' : '';

    DB.ensureSheet('Purchase', PUR_HEADERS);
    if (DB.findRowById('Purchase', purchaseId) !== -1)
      return { success: false, message: 'Purchase ID already exists. Please regenerate.' };

    var grams = DB.num(d.grams);
    var rupees = DB.num(d.rupees);
    var rate10g = CalcSvc.purchaseRate(grams, rupees);

    var purRows = DB.readAll('Purchase', 7);
    var totals = StockSvc.getPurchaseTotals(purRows);
    var newTotalG = totals.totalGrams + grams;
    var newTotalR = totals.totalRupees + rupees;
    var avgRate = CalcSvc.purchaseRate(newTotalG, newTotalR);
    var stockBal = CalcSvc.round3(newTotalG);

    // H2: timezone-safe date parsing
    var dateVal = DB.parseDate(d.date) || '';
    var newRow = DB.appendRow('Purchase', PUR_COL_COUNT, [
      purchaseId, dateVal, partyId, partyName, area,
      grams, rupees, rate10g, avgRate, stockBal, note, isPaid
    ]);
    DB.setDateFormat('Purchase', newRow, 2);

    if (partyId && !d.isPaid) OutSvc.updateDelta(partyId, +rupees, +grams);

    purRows.push([purchaseId, dateVal, partyId, partyName, area, grams, rupees]);
    StockSvc.recalcSaleProfitsWithData_(purRows);

    _invalidateDashCache_();
    _invalidateSearchCache_();
    _invalidateRefCache_();

    return { success: true, message: 'New Purchase Added' };
  } catch (e) {
    return DB.safeError(e, 'purAddPurchase');
  }
}

// ── Public: Update ────────────────────────────────────────────

function purUpdatePurchase(d) {
  try {
    var valErr = purValidateInput_(d);
    if (valErr) return { success: false, message: valErr };

    // C3: sanitize text inputs
    var purchaseId = DB.sanitizeText(d.purchaseId, 20);
    var partyId = DB.sanitizeText(d.partyId, 20);
    var partyName = DB.sanitizeText(d.partyName, 100);
    var area = DB.sanitizeText(d.area, 100);
    var note = DB.sanitizeText(d.note, 500);
    var isPaid = d.isPaid ? 'YES' : '';

    var targetRow = DB.findRowById('Purchase', purchaseId);
    if (targetRow === -1) return { success: false, message: 'Purchase record not found.' };

    var oldRow = DB.getRow('Purchase', targetRow, PUR_COL_COUNT);
    var oldPartyId = String(oldRow[2] || '');
    var oldGrams = DB.num(oldRow[5]);
    var oldRupees = DB.num(oldRow[6]);
    var oldIsPaid = oldRow[11] === 'YES';

    var grams = DB.num(d.grams);
    var rupees = DB.num(d.rupees);
    var rate10g = CalcSvc.purchaseRate(grams, rupees);

    var purRows = DB.readAll('Purchase', 7);
    var totals = StockSvc.getPurchaseTotalsExcluding(purchaseId, purRows);
    var newTotalG = totals.totalGrams + grams;
    var newTotalR = totals.totalRupees + rupees;
    var avgRate = CalcSvc.purchaseRate(newTotalG, newTotalR);
    var stockBal = CalcSvc.round3(newTotalG);

    // H2: timezone-safe date parsing
    var dateVal = DB.parseDate(d.date) || '';
    DB.updateRow('Purchase', targetRow, PUR_COL_COUNT, [
      purchaseId, dateVal, partyId, partyName, area,
      grams, rupees, rate10g, avgRate, stockBal, note, isPaid
    ]);
    DB.setDateFormat('Purchase', targetRow, 2);

    var newPartyId = partyId;
    if (oldPartyId && !oldIsPaid) OutSvc.updateDelta(oldPartyId, -oldRupees, -oldGrams);
    if (newPartyId && !d.isPaid) OutSvc.updateDelta(newPartyId, +rupees, +grams);

    for (var pi = 0; pi < purRows.length; pi++) {
      if (String(purRows[pi][0]).trim() === purchaseId) {
        purRows[pi] = [purchaseId, dateVal, partyId, partyName, area, grams, rupees];
        break;
      }
    }
    StockSvc.recalcSaleProfitsWithData_(purRows);

    _invalidateDashCache_();
    _invalidateSearchCache_();
    _invalidateRefCache_();

    return { success: true, message: 'Purchase Updated' };
  } catch (e) {
    return DB.safeError(e, 'purUpdatePurchase');
  }
}

// ── Public: Delete ────────────────────────────────────────────

function purDeletePurchase(purchaseId) {
  try {
    var targetRow = DB.findRowById('Purchase', purchaseId);
    if (targetRow === -1) return { success: false, message: 'Purchase record not found.' };

    var oldRow = DB.getRow('Purchase', targetRow, PUR_COL_COUNT);
    var partyId = String(oldRow[2] || '');
    var oldRupees = DB.num(oldRow[6]);
    var oldGrams = DB.num(oldRow[5]);
    var oldIsPaid = oldRow[11] === 'YES';

    DB.deleteRow('Purchase', targetRow);

    if (partyId && !oldIsPaid) OutSvc.updateDelta(partyId, -oldRupees, -oldGrams);
    StockSvc.recalcSaleProfits();

    _invalidateDashCache_();
    _invalidateSearchCache_();
    _invalidateRefCache_();

    return { success: true, message: 'Purchase Deleted' };
  } catch (e) {
    return DB.safeError(e, 'purDeletePurchase');
  }
}

// ── Public: Bulk Delete ───────────────────────────────────────
// PERF: Uses compact-rewrite strategy for large bulk deletes (B6).

function purBulkDelete(ids) {
  try {
    var idSet = {};
    for (var k = 0; k < ids.length; k++) idSet[String(ids[k]).trim()] = true;

    if (ids.length >= 10) {
      // H3 fix: collect outstanding data BEFORE the rewrite so we can reverse it
      var rows = DB.readAll('Purchase', PUR_COL_COUNT);
      var deltas = [];
      for (var ri = 0; ri < rows.length; ri++) {
        if (!idSet[String(rows[ri][0]).trim()]) continue;
        var pid = String(rows[ri][2] || '');
        var rPaid = rows[ri][11] === 'YES';
        if (pid && !rPaid) deltas.push({ partyId: pid, rupees: -DB.num(rows[ri][6]), grams: -DB.num(rows[ri][5]) });
      }
      OutSvc.updateDeltas(deltas);
      var deleted = DB.bulkDeleteAndRewrite('Purchase', PUR_COL_COUNT, ids);
      StockSvc.recalcSaleProfits();
      _invalidateDashCache_();
      _invalidateSearchCache_();
      _invalidateRefCache_();
      return { success: true, message: deleted + ' purchase(s) deleted.' };
    }

    // Small delete path: row-by-row (preserves outstanding tracking)
    var rows2 = DB.readAll('Purchase', PUR_COL_COUNT);
    var toDelete = [];
    for (var i = 0; i < rows2.length; i++) {
      if (!idSet[String(rows2[i][0]).trim()]) continue;
      toDelete.push({
        rowIdx: i + 2, partyId: String(rows2[i][2] || ''),
        rupees: DB.num(rows2[i][6]), grams: DB.num(rows2[i][5]),
        isPaid: rows2[i][11] === 'YES'
      });
    }
    toDelete.sort(function (a, b) { return b.rowIdx - a.rowIdx; });
    var smallDeltas = [];
    for (var j = 0; j < toDelete.length; j++) {
      DB.deleteRow('Purchase', toDelete[j].rowIdx);
      if (toDelete[j].partyId && !toDelete[j].isPaid) {
        smallDeltas.push({ partyId: toDelete[j].partyId, rupees: -toDelete[j].rupees, grams: -toDelete[j].grams });
      }
    }
    OutSvc.updateDeltas(smallDeltas);
    StockSvc.recalcSaleProfits();
    _invalidateDashCache_();
    _invalidateSearchCache_();
    _invalidateRefCache_();
    return { success: true, message: toDelete.length + ' purchase(s) deleted.' };
  } catch (e) {
    return DB.safeError(e, 'purBulkDelete');
  }
}

// ── Public: Paginated Read ────────────────────────────────────
// PERF (B4): Filter on raw rows before mapping to objects (avoids
// creating a full JS object per row just to throw most away).

function purGetPage(params) {
  try {
    var p = params || {};
    var pageSize = parseInt(p.pageSize, 10) || getPageSize_();
    var page = Math.max(1, parseInt(p.page, 10) || 1);
    var q = String(p.searchQ || '').trim().toLowerCase().substring(0, 100); // L2: cap
    var col = String(p.searchCol || 'all');
    var validCols = { 'all': true, '0': true, '1': true, '3': true, '4': true };
    if (!validCols[col]) col = 'all'; // whitelist

    // Fast path: no filter — read only one page directly from sheet
    if (!q) {
      var pg = DB.readPage('Purchase', PUR_COL_COUNT, (page - 1) * pageSize, pageSize);
      var data = [];
      for (var i = 0; i < pg.rows.length; i++) {
        if (!String(pg.rows[i][0]).trim() && !String(pg.rows[i][3]).trim()) continue;
        data.push(purMapRow_(pg.rows[i], pg.offset + i + 2));
      }
      return DB.safeReturn({ success: true, data: data, total: pg.total, page: page, pageSize: pageSize });
    }

    // Filter path: scan raw rows, map only matching ones
    var allRows = DB.readAll('Purchase', PUR_COL_COUNT);
    var matchingIdxs = [];
    for (var i = 0; i < allRows.length; i++) {
      var r = allRows[i];
      if (!r[0] && !r[3]) continue;
      var hit = false;
      if (col === '0') hit = String(r[0]).toLowerCase().indexOf(q) !== -1;
      else if (col === '3') hit = String(r[3]).toLowerCase().indexOf(q) !== -1;
      else if (col === '4') hit = String(r[4]).toLowerCase().indexOf(q) !== -1;
      else if (col === '1') hit = String(r[1]).toLowerCase().indexOf(q) !== -1;
      else hit = (String(r[0]) + String(r[1]) + String(r[3]) + String(r[4]) + String(r[10])).toLowerCase().indexOf(q) !== -1;
      if (hit) matchingIdxs.push(i);
    }
    var total = matchingIdxs.length;
    var start = (page - 1) * pageSize;
    var pageIdxs = matchingIdxs.slice(start, start + pageSize);
    var data = [];
    for (var m = 0; m < pageIdxs.length; m++) {
      data.push(purMapRow_(allRows[pageIdxs[m]], pageIdxs[m] + 2));
    }
    return DB.safeReturn({ success: true, data: data, total: total, page: page, pageSize: pageSize });
  } catch (e) {
    Logger.log('purGetPage: ' + e.message);
    return { success: false, message: e.message };
  }
}

// Concurrency guard: purchase writes recalculate stock/profit and must be atomic.
var purAddPurchase_raw = purAddPurchase;
purAddPurchase = function () {
  var args = arguments;
  return DB.withWriteLock('purAddPurchase', function () {
    return purAddPurchase_raw.apply(null, args);
  });
};

var purUpdatePurchase_raw = purUpdatePurchase;
purUpdatePurchase = function () {
  var args = arguments;
  return DB.withWriteLock('purUpdatePurchase', function () {
    return purUpdatePurchase_raw.apply(null, args);
  });
};

var purDeletePurchase_raw = purDeletePurchase;
purDeletePurchase = function () {
  var args = arguments;
  return DB.withWriteLock('purDeletePurchase', function () {
    return purDeletePurchase_raw.apply(null, args);
  });
};

var purBulkDelete_raw = purBulkDelete;
purBulkDelete = function () {
  var args = arguments;
  return DB.withWriteLock('purBulkDelete', function () {
    return purBulkDelete_raw.apply(null, args);
  });
};
