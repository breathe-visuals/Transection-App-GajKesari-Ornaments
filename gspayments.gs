// ============================================================
// gspayments.gs — Receipts/Payments Controller
// Thin wrapper: validates → calls DB/OutSvc/CalcSvc → returns.
// ============================================================

var RCPT_COL_COUNT = 11;
var RCPT_HEADERS = [
  'Receipt/Payment ID', 'Date', 'Party ID', 'Party Name', 'Area',
  'Rupees Received', 'Grams Received',
  'Outstanding Rupees', 'Outstanding Grams', 'Note', 'Entry Type'
];

// ── Validation ────────────────────────────────────────────────

function rcptValidateInput_(d) {
  if (!d.receiptId) return 'Receipt ID is required.';
  if (!DB.isValidDate(d.date)) return 'Date is required and must be valid (YYYY-MM-DD).';
  if (!d.partyId && !d.partyName) return 'Party is required.';
  var r = DB.num(d.rupeesReceived);
  var g = DB.num(d.gramsReceived);
  if (r < 0) return 'Rupees cannot be negative.';
  if (g < 0) return 'Grams cannot be negative.';
  if (r === 0 && g === 0) return 'Enter a rupee or gram amount greater than 0.';
  return null;
}

// ── Row mapper ────────────────────────────────────────────────

function rcptMapRow_(r, rowIndex) {
  return {
    receiptId: r[0],
    date: DB.formatDate(r[1]),
    dateRaw: DB.dateRaw(r[1]),
    partyId: r[2],
    partyName: r[3],
    area: r[4],
    rupeesReceived: r[5],
    gramsReceived: r[6],
    outstandingRupees: r[7],
    outstandingGrams: r[8],
    note: r[9],
    entryType: r[10] ? String(r[10]) : 'Receipt'
  };
}

// ── Public: Get All ───────────────────────────────────────────

function rcptGetAllReceipts() {
  try {
    DB.ensureSheet('Receipts', RCPT_HEADERS);
    var rows = DB.readAll('Receipts', RCPT_COL_COUNT);
    var result = [];
    for (var i = 0; i < rows.length; i++) {
      if (!String(rows[i][0]).trim() && !String(rows[i][3]).trim()) continue;
      result.push(rcptMapRow_(rows[i], i + 2));
    }
    return { success: true, data: result };
  } catch (e) {
    Logger.log('rcptGetAllReceipts: ' + e.message);
    return { success: false, message: e.message };
  }
}

function payGetAllPayments() { return rcptGetAllReceipts(); }

// ── Public: Check ID ──────────────────────────────────────────

function rcptCheckIdExists(receiptId) {
  try {
    DB.ensureSheet('Receipts', RCPT_HEADERS);
    return { exists: DB.findRowById('Receipts', receiptId) !== -1 };
  } catch (e) { return { exists: false }; }
}

function payCheckIdExists(id) { return rcptCheckIdExists(id); }

// ── Public: Parties Dropdown ──────────────────────────────────

function rcptGetPartiesForDropdown() {
  try {
    return { success: true, data: DB.getPartiesForDropdown(true) };
  } catch (e) { return { success: false, message: e.message }; }
}

function payGetPartiesForDropdown() { return rcptGetPartiesForDropdown(); }

// ── Public: Add Receipt ───────────────────────────────────────

function rcptAddReceipt(d) {
  try {
    var valErr = rcptValidateInput_(d);
    if (valErr) return { success: false, message: valErr };

    // C3: sanitize text inputs
    var receiptId = DB.sanitizeText(d.receiptId, 20);
    var partyId = DB.sanitizeText(d.partyId, 20);
    var partyName = DB.sanitizeText(d.partyName, 100);
    var area = DB.sanitizeText(d.area, 100);
    var note = DB.sanitizeText(d.note, 500);
    var entryType = (d.entryType === 'Payment' || d.entryType === 'Adjustment') ? d.entryType : 'Receipt';

    DB.ensureSheet('Receipts', RCPT_HEADERS);
    if (DB.findRowById('Receipts', receiptId) !== -1)
      return { success: false, message: 'Receipt ID already exists. Please regenerate.' };

    var rupeesRcvd = DB.num(d.rupeesReceived);
    var gramsRcvd = DB.num(d.gramsReceived);

    var out = OutSvc.getForParty(partyId);
    var newOutR = CalcSvc.round2(out.rupees - rupeesRcvd);
    var newOutG = CalcSvc.round3(out.grams - gramsRcvd);

    // H2: timezone-safe date parsing
    var dateVal = DB.parseDate(d.date) || '';
    var newRow = DB.appendRow('Receipts', RCPT_COL_COUNT, [
      receiptId, dateVal, partyId, partyName, area,
      rupeesRcvd, gramsRcvd, newOutR, newOutG,
      note, entryType
    ]);
    DB.setDateFormat('Receipts', newRow, 2);

    if (partyId) OutSvc.updateDelta(partyId, -rupeesRcvd, -gramsRcvd);
    _invalidateDashCache_();
    _invalidateSearchCache_();
    _invalidateRefCache_();
    return { success: true, message: 'New Receipt Added' };
  } catch (e) {
    return DB.safeError(e, 'rcptAddReceipt');
  }
}

// ── Public: Add Payment (alias) ───────────────────────────────

function payAddPayment(d) {
  return rcptAddReceipt({
    receiptId: d.paymentId,
    date: d.date,
    partyId: d.partyId,
    partyName: d.partyName,
    area: d.area,
    rupeesReceived: d.rupeesRP,
    gramsReceived: d.gramsRP,
    note: d.note,
    entryType: d.entryType || 'Payment'
  });
}

// ── Public: Update Receipt ────────────────────────────────────

function rcptUpdateReceipt(d) {
  try {
    var valErr = rcptValidateInput_(d);
    if (valErr) return { success: false, message: valErr };

    // C3: sanitize text inputs
    var receiptId = DB.sanitizeText(d.receiptId, 20);
    var partyId = DB.sanitizeText(d.partyId, 20);
    var partyName = DB.sanitizeText(d.partyName, 100);
    var area = DB.sanitizeText(d.area, 100);
    var note = DB.sanitizeText(d.note, 500);

    DB.ensureSheet('Receipts', RCPT_HEADERS);
    var targetRow = DB.findRowById('Receipts', receiptId);
    if (targetRow === -1) return { success: false, message: 'Receipt not found.' };

    var oldRow = DB.getRow('Receipts', targetRow, RCPT_COL_COUNT);
    var oldPartyId = String(oldRow[2] || '');
    var oldRupees = DB.num(oldRow[5]);
    var oldGrams = DB.num(oldRow[6]);
    var oldEntryType = String(oldRow[10] || 'Receipt');
    var entryType = (d.entryType === 'Payment' || d.entryType === 'Adjustment' || d.entryType === 'Receipt')
      ? d.entryType : oldEntryType;

    var rupeesRcvd = DB.num(d.rupeesReceived);
    var gramsRcvd = DB.num(d.gramsReceived);

    var resolvedPartyId = partyId || oldPartyId;
    var out = OutSvc.getForParty(resolvedPartyId);
    var preOutR = CalcSvc.round2(out.rupees + oldRupees);
    var preOutG = CalcSvc.round3(out.grams + oldGrams);
    var newOutR = CalcSvc.round2(preOutR - rupeesRcvd);
    var newOutG = CalcSvc.round3(preOutG - gramsRcvd);

    // H2: timezone-safe date parsing
    var dateVal = DB.parseDate(d.date) || '';
    DB.updateRow('Receipts', targetRow, RCPT_COL_COUNT, [
      receiptId, dateVal, partyId, partyName, area,
      rupeesRcvd, gramsRcvd, newOutR, newOutG,
      note, entryType
    ]);
    DB.setDateFormat('Receipts', targetRow, 2);

    var newPartyId = partyId;
    if (oldPartyId && oldPartyId === newPartyId) {
      OutSvc.updateDelta(newPartyId, oldRupees - rupeesRcvd, oldGrams - gramsRcvd);
    } else {
      if (oldPartyId) OutSvc.updateDelta(oldPartyId, +oldRupees, +oldGrams);
      if (newPartyId) OutSvc.updateDelta(newPartyId, -rupeesRcvd, -gramsRcvd);
    }

    _invalidateDashCache_();
    _invalidateSearchCache_();
    _invalidateRefCache_();
    return { success: true, message: 'Receipt Updated' };
  } catch (e) {
    return DB.safeError(e, 'rcptUpdateReceipt');
  }
}

// ── Public: Update Payment (alias) ────────────────────────────

function payUpdatePayment(d) {
  return rcptUpdateReceipt({
    receiptId: d.paymentId,
    date: d.date,
    partyId: d.partyId,
    partyName: d.partyName,
    area: d.area,
    rupeesReceived: d.rupeesRP,
    gramsReceived: d.gramsRP,
    note: d.note,
    entryType: d.entryType || 'Payment'
  });
}

// ── Public: Delete ────────────────────────────────────────────

function rcptDeleteReceipt(receiptId) {
  try {
    DB.ensureSheet('Receipts', RCPT_HEADERS);
    var targetRow = DB.findRowById('Receipts', receiptId);
    if (targetRow === -1) return { success: false, message: 'Receipt not found.' };

    var oldRow = DB.getRow('Receipts', targetRow, RCPT_COL_COUNT);
    var partyId = String(oldRow[2] || '');
    var oldRupees = DB.num(oldRow[5]);
    var oldGrams = DB.num(oldRow[6]);

    DB.deleteRow('Receipts', targetRow);
    if (partyId) OutSvc.updateDelta(partyId, +oldRupees, +oldGrams);
    _invalidateDashCache_();
    _invalidateSearchCache_();
    _invalidateRefCache_();
    return { success: true, message: 'Entry Deleted' };
  } catch (e) {
    Logger.log('rcptDeleteReceipt: ' + e.message);
    return { success: false, message: e.message };
  }
}

function payDeletePayment(id) { return rcptDeleteReceipt(id); }

// ── Public: Bulk Delete ───────────────────────────────────────
// PERF (B6): Uses compact-rewrite for large bulk deletes.

function rcptBulkDelete(ids) {
  try {
    DB.ensureSheet('Receipts', RCPT_HEADERS);
    var idSet = {};
    for (var k = 0; k < ids.length; k++) idSet[String(ids[k]).trim()] = true;

    if (ids.length >= 10) {
      // H3 fix: collect outstanding data BEFORE the rewrite so we can reverse it
      var rows = DB.readAll('Receipts', RCPT_COL_COUNT);
      var deltas = [];
      for (var ri = 0; ri < rows.length; ri++) {
        if (!idSet[String(rows[ri][0]).trim()]) continue;
        var pid = String(rows[ri][2] || '');
        if (pid) deltas.push({ partyId: pid, rupees: DB.num(rows[ri][5]), grams: DB.num(rows[ri][6]) }); // reverse receipt
      }
      OutSvc.updateDeltas(deltas);
      var deleted = DB.bulkDeleteAndRewrite('Receipts', RCPT_COL_COUNT, ids);
      _invalidateDashCache_();
      _invalidateSearchCache_();
      _invalidateRefCache_();
      return { success: true, message: deleted + ' entry(ies) deleted.' };
    }

    var rows2 = DB.readAll('Receipts', RCPT_COL_COUNT);
    var toDelete = [];
    for (var i = 0; i < rows2.length; i++) {
      if (!idSet[String(rows2[i][0]).trim()]) continue;
      toDelete.push({
        rowIdx: i + 2, partyId: String(rows2[i][2] || ''),
        rupees: DB.num(rows2[i][5]), grams: DB.num(rows2[i][6])
      });
    }
    toDelete.sort(function (a, b) { return b.rowIdx - a.rowIdx; });
    var smallDeltas = [];
    for (var j = 0; j < toDelete.length; j++) {
      DB.deleteRow('Receipts', toDelete[j].rowIdx);
      if (toDelete[j].partyId) smallDeltas.push({ partyId: toDelete[j].partyId, rupees: toDelete[j].rupees, grams: toDelete[j].grams });
    }
    OutSvc.updateDeltas(smallDeltas);
    _invalidateDashCache_();
    _invalidateSearchCache_();
    _invalidateRefCache_();
    return { success: true, message: toDelete.length + ' entry(ies) deleted.' };
  } catch (e) {
    return DB.safeError(e, 'rcptBulkDelete');
  }
}

// ── Public: Paginated Read ────────────────────────────────────
// PERF (B4): Filter on raw rows before mapping to objects.

function rcptGetPage(params) {
  try {
    var p = params || {};
    var pageSize = parseInt(p.pageSize, 10) || getPageSize_();
    var page = Math.max(1, parseInt(p.page, 10) || 1);
    var q = String(p.searchQ || '').trim().toLowerCase().substring(0, 100); // L2: cap
    var col = String(p.searchCol || 'all');
    var validCols = { 'all': true, '0': true, '1': true, '3': true, '4': true, '10': true };
    if (!validCols[col]) col = 'all'; // whitelist

    DB.ensureSheet('Receipts', RCPT_HEADERS);

    // Fast path: no filter
    if (!q) {
      var pg = DB.readPage('Receipts', RCPT_COL_COUNT, (page - 1) * pageSize, pageSize);
      var data = [];
      for (var i = 0; i < pg.rows.length; i++) {
        if (!String(pg.rows[i][0]).trim() && !String(pg.rows[i][3]).trim()) continue;
        data.push(rcptMapRow_(pg.rows[i], pg.offset + i + 2));
      }
      return DB.safeReturn({ success: true, data: data, total: pg.total, page: page, pageSize: pageSize });
    }

    // Filter path: scan raw rows, map only matching ones
    var allRows = DB.readAll('Receipts', RCPT_COL_COUNT);
    var matchingIdxs = [];
    for (var i = 0; i < allRows.length; i++) {
      var r = allRows[i];
      if (!r[0] && !r[3]) continue;
      var hit = false;
      if (col === '0') hit = String(r[0]).toLowerCase().indexOf(q) !== -1;
      else if (col === '3') hit = String(r[3]).toLowerCase().indexOf(q) !== -1;
      else if (col === '4') hit = String(r[4]).toLowerCase().indexOf(q) !== -1;
      else if (col === '1') hit = String(r[1]).toLowerCase().indexOf(q) !== -1;
      else if (col === '10') hit = String(r[10] || '').toLowerCase().indexOf(q) !== -1;
      else hit = (String(r[0]) + String(r[1]) + String(r[3]) + String(r[4]) + String(r[9]) + String(r[10] || '')).toLowerCase().indexOf(q) !== -1;
      if (hit) matchingIdxs.push(i);
    }
    var total = matchingIdxs.length;
    var start = (page - 1) * pageSize;
    var pageIdxs = matchingIdxs.slice(start, start + pageSize);
    var data = [];
    for (var m = 0; m < pageIdxs.length; m++) {
      data.push(rcptMapRow_(allRows[pageIdxs[m]], pageIdxs[m] + 2));
    }
    return DB.safeReturn({ success: true, data: data, total: total, page: page, pageSize: pageSize });
  } catch (e) {
    return DB.safeError(e, 'rcptGetPage');
  }
}


function rcptAdjustOutstanding(d) {
  try {
    DB.ensureSheet('Receipts', RCPT_HEADERS);
    var newR = CalcSvc.round2(DB.num(d.newRupees));
    var newG = CalcSvc.round3(DB.num(d.newGrams));

    var party = OutSvc.resolveByName(d.partyName);
    if (!party) return { success: false, message: 'Party not found: ' + d.partyName };

    // Generate unique adjustment ID
    var adjId;
    for (var attempt = 0; attempt < 10; attempt++) {
      adjId = 'ADJ' + Math.floor(10000 + Math.random() * 90000);
      if (DB.findRowById('Receipts', adjId) === -1) break;
    }

    var deltaR = CalcSvc.round2(party.rupees - newR);
    var deltaG = CalcSvc.round3(party.grams - newG);
    var dateVal = d.date ? new Date(d.date) : new Date();

    var newRow = DB.appendRow('Receipts', RCPT_COL_COUNT, [
      adjId, dateVal, party.partyId, d.partyName || '', party.area,
      deltaR, deltaG, newR, newG,
      d.note || 'Outstanding Adjustment', 'Adjustment'
    ]);
    DB.setDateFormat('Receipts', newRow, 2);

    OutSvc.setAbsolute(party.partyId, newR, newG);

    _invalidateDashCache_();
    _invalidateSearchCache_();
    _invalidateRefCache_();

    return { success: true, message: 'Outstanding for ' + d.partyName + ' adjusted successfully.' };
  } catch (e) {
    Logger.log('rcptAdjustOutstanding: ' + e.message);
    return { success: false, message: e.message };
  }
}

// Concurrency guard: receipt/payment writes mutate party outstanding.
var rcptAddReceipt_raw = rcptAddReceipt;
rcptAddReceipt = function () {
  var args = arguments;
  return DB.withWriteLock('rcptAddReceipt', function () {
    return rcptAddReceipt_raw.apply(null, args);
  });
};

var rcptUpdateReceipt_raw = rcptUpdateReceipt;
rcptUpdateReceipt = function () {
  var args = arguments;
  return DB.withWriteLock('rcptUpdateReceipt', function () {
    return rcptUpdateReceipt_raw.apply(null, args);
  });
};

var rcptDeleteReceipt_raw = rcptDeleteReceipt;
rcptDeleteReceipt = function () {
  var args = arguments;
  return DB.withWriteLock('rcptDeleteReceipt', function () {
    return rcptDeleteReceipt_raw.apply(null, args);
  });
};

var rcptBulkDelete_raw = rcptBulkDelete;
rcptBulkDelete = function () {
  var args = arguments;
  return DB.withWriteLock('rcptBulkDelete', function () {
    return rcptBulkDelete_raw.apply(null, args);
  });
};

var rcptAdjustOutstanding_raw = rcptAdjustOutstanding;
rcptAdjustOutstanding = function () {
  var args = arguments;
  return DB.withWriteLock('rcptAdjustOutstanding', function () {
    return rcptAdjustOutstanding_raw.apply(null, args);
  });
};
