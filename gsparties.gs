// ============================================================
// gsparties.gs — Parties Controller
// Thin wrapper: validates → calls DB/services → returns response.
// ============================================================

var PART_COL_COUNT = 12;
var PART_HEADERS = [
  'Party ID', 'Party Name', 'Party Type', 'Area',
  'Outstanding Rupees', 'Outstanding Grams',
  'Owner Name', 'Mobile Number',
  'Labour 999', 'Labour 925', 'Labour Other',
  'Note'
];

function partEnsureLayout_() {
  var sh = DB.ensureSheet('Parties', PART_HEADERS);
  var headers = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), PART_HEADERS.length)).getValues()[0]
    .map(function (h) { return String(h || '').trim().toLowerCase(); });
  if (headers[4] === 'outstanding rupees' && headers[5] === 'outstanding grams') return sh;

  var oldOutR = headers.indexOf('outstanding rupees');
  var oldOutG = headers.indexOf('outstanding grams');
  var oldOwner = headers.indexOf('owner name');
  var oldMobile = headers.indexOf('mobile number');
  if (oldOutR < 0 || oldOutG < 0) {
    sh.getRange(1, 1, 1, PART_HEADERS.length).setValues([PART_HEADERS]);
    return sh;
  }

  var lastRow = sh.getLastRow();
  var values = lastRow > 1 ? sh.getRange(2, 1, lastRow - 1, Math.max(sh.getLastColumn(), PART_HEADERS.length)).getValues() : [];
  var fixed = values.map(function (r) {
    return [
      r[0], r[1], r[2], r[3],
      r[oldOutR], r[oldOutG],
      oldOwner >= 0 ? r[oldOwner] : '',
      oldMobile >= 0 ? r[oldMobile] : '',
      r[headers.indexOf('labour 999')] || '',
      r[headers.indexOf('labour 925')] || '',
      r[headers.indexOf('labour other')] || '',
      r[headers.indexOf('note')] || ''
    ];
  });
  sh.getRange(1, 1, 1, PART_HEADERS.length).setValues([PART_HEADERS]);
  if (lastRow > 1) {
    sh.getRange(2, 1, lastRow - 1, Math.max(sh.getLastColumn(), PART_HEADERS.length)).clearContent();
    sh.getRange(2, 1, fixed.length, PART_HEADERS.length).setValues(fixed);
  }
  _invalidateDashCache_();
  _invalidateRefCache_();
  return sh;
}

// ── Validation ────────────────────────────────────────────────

function partValidateInput_(d) {
  if (!d.partyId || !String(d.partyId).trim()) return 'Party ID is required.';
  if (!d.partyName || !String(d.partyName).trim()) return 'Party Name is required.';
  var validTypes = ['Supplier', 'Customer', 'Both'];
  if (validTypes.indexOf(d.partyType) === -1) return 'Party Type must be Supplier, Customer, or Both.';
  return null;
}

// ── Public: Get All ───────────────────────────────────────────

function partGetAllParties() {
  try {
    partEnsureLayout_();
    var rows = DB.readAll('Parties', PART_COL_COUNT);
    var result = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (!String(r[0]).trim() && !String(r[1]).trim()) continue;
      result.push({
        partyId: r[0],
        partyName: r[1],
        partyType: r[2],
        area: r[3],
        outstandingRupees: r[4],
        outstandingGrams: r[5],
        ownerName: r[6],
        mobileNumber: r[7],
        labour999: r[8],
        labour925: r[9],
        labourOther: r[10],
        note: r[11]
      });
    }
    return { success: true, data: result };
  } catch (e) {
    Logger.log('partGetAllParties: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ── Public: Check ID ──────────────────────────────────────────

function partCheckIdExists(partyId) {
  try { return { exists: DB.findRowById('Parties', partyId) !== -1 }; }
  catch (e) { return { exists: false }; }
}

// ── Public: Add ───────────────────────────────────────────────

function partAddParty(d) {
  try {
    // M6: server-side validation
    var valErr = partValidateInput_(d);
    if (valErr) return { success: false, message: valErr };

    // C3: sanitize text inputs
    var partyId = DB.sanitizeText(d.partyId, 20);
    var partyName = DB.sanitizeText(d.partyName, 100);
    var area = DB.sanitizeText(d.area, 100);
    var ownerName = DB.sanitizeText(d.ownerName, 100);
    var mobileNumber = DB.sanitizeText(d.mobileNumber, 15);
    var note = DB.sanitizeText(d.note, 500);

    partEnsureLayout_();
    if (DB.findRowById('Parties', partyId) !== -1) {
      return { success: false, message: 'Party ID already exists. Please regenerate.' };
    }
    DB.appendRow('Parties', PART_COL_COUNT, [
      partyId,
      partyName,
      d.partyType,
      area,
      d.outstandingRupees !== '' && d.outstandingRupees != null ? Number(d.outstandingRupees) : 0,
      d.outstandingGrams !== '' && d.outstandingGrams != null ? Number(d.outstandingGrams) : 0,
      ownerName,
      mobileNumber,
      d.labour999 !== '' && d.labour999 != null ? Number(d.labour999) : '',
      d.labour925 !== '' && d.labour925 != null ? Number(d.labour925) : '',
      d.labourOther !== '' && d.labourOther != null ? Number(d.labourOther) : '',
      note
    ]);
    _invalidateDashCache_();
    _invalidateSearchCache_();
    _invalidateRefCache_();
    return { success: true, message: 'New Party Added' };
  } catch (e) {
    return DB.safeError(e, 'partAddParty');
  }
}

// ── Public: Update ────────────────────────────────────────────

function partUpdateParty(d) {
  try {
    // M6: server-side validation
    var valErr = partValidateInput_(d);
    if (valErr) return { success: false, message: valErr };

    // C3: sanitize text inputs
    var partyId = DB.sanitizeText(d.partyId, 20);
    var partyName = DB.sanitizeText(d.partyName, 100);
    var area = DB.sanitizeText(d.area, 100);
    var ownerName = DB.sanitizeText(d.ownerName, 100);
    var mobileNumber = DB.sanitizeText(d.mobileNumber, 15);
    var note = DB.sanitizeText(d.note, 500);

    partEnsureLayout_();
    var targetRow = DB.findRowById('Parties', partyId);
    if (targetRow === -1) return { success: false, message: 'Party not found.' };

    // Preserve live outstanding values — managed by sales/payments, not manual edit
    var currentRow = DB.getRow('Parties', targetRow, PART_COL_COUNT);
    var currentOutR = Number(currentRow[4]) || 0;
    var currentOutG = Number(currentRow[5]) || 0;

    DB.updateRow('Parties', targetRow, PART_COL_COUNT, [
      partyId,
      partyName,
      d.partyType,
      area,
      currentOutR,
      currentOutG,
      ownerName,
      mobileNumber,
      d.labour999 !== '' && d.labour999 != null ? Number(d.labour999) : '',
      d.labour925 !== '' && d.labour925 != null ? Number(d.labour925) : '',
      d.labourOther !== '' && d.labourOther != null ? Number(d.labourOther) : '',
      note
    ]);
    _invalidateDashCache_();
    _invalidateSearchCache_();
    _invalidateRefCache_();
    return { success: true, message: 'Party Details Updated' };
  } catch (e) {
    return DB.safeError(e, 'partUpdateParty');
  }
}

// ── Public: Delete ────────────────────────────────────────────

function partDeleteParty(partyId) {
  try {
    partEnsureLayout_();
    var rows = DB.readAll('Parties', PART_COL_COUNT);
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i][0]).trim() !== String(partyId).trim()) continue;
      var outR = Number(rows[i][4]) || 0;
      var outG = Number(rows[i][5]) || 0;
      if (outR !== 0 || outG !== 0) {
        return { success: false, message: 'Party has outstanding balance (₹' + outR + ', ' + outG + 'g). Clear balance before deleting.' };
      }
      DB.deleteRow('Parties', i + 2);
      _invalidateDashCache_();
      _invalidateSearchCache_();
      _invalidateRefCache_();
      return { success: true, message: 'Party deleted successfully.' };
    }
    return { success: false, message: 'Party not found.' };
  } catch (e) {
    Logger.log('partDeleteParty: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ── Public: Bulk Delete ───────────────────────────────────────

function partBulkDelete(ids) {
  try {
    partEnsureLayout_();
    var rows = DB.readAll('Parties', PART_COL_COUNT);
    var idSet = {};
    for (var k = 0; k < ids.length; k++) idSet[String(ids[k]).trim()] = true;

    var toDelete = [], skipped = [];
    for (var j = 0; j < rows.length; j++) {
      var rowId = String(rows[j][0]).trim();
      if (!idSet[rowId]) continue;
      var outR = Number(rows[j][4]) || 0;
      var outG = Number(rows[j][5]) || 0;
      if (outR !== 0 || outG !== 0) {
        skipped.push(String(rows[j][1] || rowId));
      } else {
        toDelete.push(j + 2);
      }
    }
    DB.deleteRowsDesc('Parties', toDelete);
    _invalidateDashCache_();
    _invalidateSearchCache_();
    _invalidateRefCache_();
    var msg = toDelete.length + ' party(ies) deleted.';
    if (skipped.length) msg += ' Skipped (outstanding balance): ' + skipped.join(', ');
    return { success: true, message: msg };
  } catch (e) {
    Logger.log('partBulkDelete: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ── Public: Paginated Read ────────────────────────────────────

function partGetPage(params) {
  try {
    partEnsureLayout_();
    var p = params || {};
    var pageSize = parseInt(p.pageSize, 10) || getPageSize_();
    var page = Math.max(1, parseInt(p.page, 10) || 1);
    var q = String(p.searchQ || '').trim().toLowerCase().substring(0, 100); // L2: cap
    var col = String(p.searchCol || 'all');
    var validCols = { 'all': true, '0': true, '1': true, '2': true, '3': true, '4': true, '5': true };
    if (!validCols[col]) col = 'all'; // whitelist

    // Fast path: no filter → read only this page from the sheet
    if (!q) {
      var pg = DB.readPage('Parties', PART_COL_COUNT, (page - 1) * pageSize, pageSize);
      var data = [];
      for (var i = 0; i < pg.rows.length; i++) {
        var r = pg.rows[i];
        if (!String(r[0]).trim() && !String(r[1]).trim()) continue;
        data.push({
          rowIndex: pg.offset + i + 2, partyId: r[0], partyName: r[1], partyType: r[2],
          area: r[3], outstandingRupees: r[4], outstandingGrams: r[5],
          ownerName: r[6], mobileNumber: r[7], labour999: r[8], labour925: r[9],
          labourOther: r[10], note: r[11]
        });
      }
      return DB.safeReturn({ success: true, data: data, total: pg.total, page: page, pageSize: pageSize });
    }

    // Filter path: load all, filter, slice
    var all = partGetAllParties();
    if (!all.success) return all;
    var filtered = all.data.filter(function (d) {
      switch (col) {
        case '0': return String(d.partyId || '').toLowerCase().indexOf(q) !== -1;
        case '1': return String(d.partyName || '').toLowerCase().indexOf(q) !== -1;
        case '2': return String(d.partyType || '').toLowerCase().indexOf(q) !== -1;
        case '3': return String(d.area || '').toLowerCase().indexOf(q) !== -1;
        case '4': return String(d.ownerName || '').toLowerCase().indexOf(q) !== -1;
        case '5': return String(d.mobileNumber || '').toLowerCase().indexOf(q) !== -1;
        default:
          return ['partyId', 'partyName', 'partyType', 'area', 'ownerName', 'mobileNumber'].some(function (k) {
            return String(d[k] || '').toLowerCase().indexOf(q) !== -1;
          });
      }
    });
    var total = filtered.length;
    var start = (page - 1) * pageSize;
    return DB.safeReturn({ success: true, data: filtered.slice(start, start + pageSize), total: total, page: page, pageSize: pageSize });
  } catch (e) {
    Logger.log('partGetPage: ' + e.message);
    return { success: false, message: e.message };
  }
}

// Concurrency guard: all party writes must be atomic.
var partAddParty_raw = partAddParty;
partAddParty = function () {
  var args = arguments;
  return DB.withWriteLock('partAddParty', function () {
    return partAddParty_raw.apply(null, args);
  });
};

var partUpdateParty_raw = partUpdateParty;
partUpdateParty = function () {
  var args = arguments;
  return DB.withWriteLock('partUpdateParty', function () {
    return partUpdateParty_raw.apply(null, args);
  });
};

var partDeleteParty_raw = partDeleteParty;
partDeleteParty = function () {
  var args = arguments;
  return DB.withWriteLock('partDeleteParty', function () {
    return partDeleteParty_raw.apply(null, args);
  });
};

var partBulkDelete_raw = partBulkDelete;
partBulkDelete = function () {
  var args = arguments;
  return DB.withWriteLock('partBulkDelete', function () {
    return partBulkDelete_raw.apply(null, args);
  });
};
