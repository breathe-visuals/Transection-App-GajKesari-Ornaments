// ============================================================
// gsinvoice.gs — Invoice/Estimate Controller
// Thin wrapper: validates → calls DB/OutSvc/CalcSvc → returns.
// ============================================================

var INV_MASTER_SHEET = 'InvoiceMaster';
var INV_ITEMS_SHEET = 'InvoiceItems';
var INV_MASTER_COLS = 13;
var INV_ITEMS_COLS = 11;
var INV_MASTER_HEADERS = [
  'Invoice ID', 'Date', 'Party ID', 'Party Name', 'Address',
  'Subtotal', 'GST Enabled', 'GST %', 'GST Amount', 'Grand Total',
  'Total Qty', 'Total Weight', 'Note'
];
var INV_ITEMS_HEADERS = [
  'Invoice ID', 'Item Name', 'Qty', 'Weight', 'Rate', 'Labour',
  'Metal Amount', 'Labour Amount', 'Item Total', 'Barcode', 'Purity'
];

// ── Public: Check ID ──────────────────────────────────────────

function invCheckIdExists(invoiceId) {
  try {
    DB.ensureSheet(INV_MASTER_SHEET, INV_MASTER_HEADERS);
    return { exists: DB.findRowById(INV_MASTER_SHEET, invoiceId) !== -1 };
  } catch (e) { return { exists: false }; }
}

// ── Public: Get All Invoices ──────────────────────────────────

function invGetAllInvoices() {
  try {
    DB.ensureSheet(INV_MASTER_SHEET, INV_MASTER_HEADERS);
    var rows = DB.readAll(INV_MASTER_SHEET, INV_MASTER_COLS);
    var result = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (!String(r[0]).trim()) continue;
      result.push({
        rowIndex: i + 2, invoiceId: r[0], date: DB.formatDate(r[1]), dateRaw: DB.dateRaw(r[1]),
        partyId: r[2], partyName: r[3], address: r[4], subtotal: r[5],
        gstEnabled: r[6], gstPct: r[7], gstAmount: r[8], grandTotal: r[9],
        totalQty: r[10], totalWeight: r[11], note: r[12]
      });
    }
    return { success: true, data: result };
  } catch (e) {
    Logger.log('invGetAllInvoices: ' + e.message);
    return { success: false, message: e.message };
  }
}

// Paginated invoice list for large datasets.
function invGetPage(params) {
  try {
    DB.ensureSheet(INV_MASTER_SHEET, INV_MASTER_HEADERS);
    var p = params || {};
    var pageSize = parseInt(p.pageSize, 10) || getPageSize_();
    var page = Math.max(1, parseInt(p.page, 10) || 1);
    var q = String(p.searchQ || '').trim().toLowerCase().substring(0, 100);

    if (!q) {
      var pg = DB.readPage(INV_MASTER_SHEET, INV_MASTER_COLS, (page - 1) * pageSize, pageSize);
      var pageRows = [];
      for (var i = 0; i < pg.rows.length; i++) {
        var r = pg.rows[i];
        if (!String(r[0]).trim()) continue;
        pageRows.push({
          rowIndex: pg.offset + i + 2, invoiceId: r[0], date: DB.formatDate(r[1]), dateRaw: DB.dateRaw(r[1]),
          partyId: r[2], partyName: r[3], address: r[4], subtotal: r[5],
          gstEnabled: r[6], gstPct: r[7], gstAmount: r[8], grandTotal: r[9],
          totalQty: r[10], totalWeight: r[11], note: r[12]
        });
      }
      return DB.safeReturn({ success: true, data: pageRows, total: pg.total, page: page, pageSize: pageSize });
    }

    var rows = DB.readAll(INV_MASTER_SHEET, INV_MASTER_COLS);
    var matches = [];
    for (var j = 0; j < rows.length; j++) {
      var rr = rows[j];
      if (!String(rr[0]).trim()) continue;
      var hay = (String(rr[0]) + String(rr[1]) + String(rr[3]) + String(rr[4]) + String(rr[12])).toLowerCase();
      if (hay.indexOf(q) !== -1) matches.push(j);
    }

    var total = matches.length;
    var start = (page - 1) * pageSize;
    var data = [];
    var slice = matches.slice(start, start + pageSize);
    for (var m = 0; m < slice.length; m++) {
      var row = rows[slice[m]];
      data.push({
        rowIndex: slice[m] + 2, invoiceId: row[0], date: DB.formatDate(row[1]), dateRaw: DB.dateRaw(row[1]),
        partyId: row[2], partyName: row[3], address: row[4], subtotal: row[5],
        gstEnabled: row[6], gstPct: row[7], gstAmount: row[8], grandTotal: row[9],
        totalQty: row[10], totalWeight: row[11], note: row[12]
      });
    }
    return DB.safeReturn({ success: true, data: data, total: total, page: page, pageSize: pageSize });
  } catch (e) {
    Logger.log('invGetPage: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ── Public: Get Single Invoice with Items ─────────────────────

function invGetInvoice(invoiceId) {
  try {
    DB.ensureSheet(INV_MASTER_SHEET, INV_MASTER_HEADERS);
    var masterRow = DB.findRowById(INV_MASTER_SHEET, invoiceId);
    if (masterRow === -1) return { success: false, message: 'Invoice not found.' };

    var mData = DB.getRow(INV_MASTER_SHEET, masterRow, INV_MASTER_COLS);
    var master = {
      invoiceId: mData[0], date: DB.formatDate(mData[1]), dateRaw: DB.dateRaw(mData[1]),
      partyId: mData[2], partyName: mData[3], address: mData[4], subtotal: mData[5],
      gstEnabled: mData[6], gstPct: mData[7], gstAmount: mData[8], grandTotal: mData[9],
      totalQty: mData[10], totalWeight: mData[11], note: mData[12]
    };

    DB.ensureSheet(INV_ITEMS_SHEET, INV_ITEMS_HEADERS);
    var iRows = DB.readAll(INV_ITEMS_SHEET, INV_ITEMS_COLS);
    var items = [];
    for (var i = 0; i < iRows.length; i++) {
      if (String(iRows[i][0]).trim() !== String(invoiceId).trim()) continue;
      if (!String(iRows[i][1]).trim()) continue;
      items.push({
        invoiceId: iRows[i][0], itemName: iRows[i][1], qty: iRows[i][2], weight: iRows[i][3],
        rate: iRows[i][4], labour: iRows[i][5], metalAmt: iRows[i][6], labourAmt: iRows[i][7],
        itemTotal: iRows[i][8], barcode: iRows[i][9] || '', purity: iRows[i][10] || ''
      });
    }

    return { success: true, master: master, items: items };
  } catch (e) {
    Logger.log('invGetInvoice: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ── Internal: Delete all items for an invoice ─────────────────

function invDeleteItems_(invoiceId) {
  try {
    DB.ensureSheet(INV_ITEMS_SHEET, INV_ITEMS_HEADERS);
    var ids = DB.readAll(INV_ITEMS_SHEET, 1);
    var rowNums = [];
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]).trim() === String(invoiceId).trim()) rowNums.push(i + 2);
    }
    DB.deleteRowsDesc(INV_ITEMS_SHEET, rowNums);
  } catch (e) {
    Logger.log('invDeleteItems_: ' + e.message);
  }
}

function invDeleteItemsForIds_(invoiceIds) {
  try {
    DB.ensureSheet(INV_ITEMS_SHEET, INV_ITEMS_HEADERS);
    var idSet = {};
    for (var k = 0; k < invoiceIds.length; k++) idSet[String(invoiceIds[k]).trim()] = true;
    var ids = DB.readAll(INV_ITEMS_SHEET, 1);
    var rowNums = [];
    for (var i = 0; i < ids.length; i++) {
      if (idSet[String(ids[i][0]).trim()]) rowNums.push(i + 2);
    }
    DB.deleteRowsDesc(INV_ITEMS_SHEET, rowNums);
  } catch (e) {
    Logger.log('invDeleteItemsForIds_: ' + e.message);
  }
}

// ── Internal: Write item rows ─────────────────────────────────

function invWriteItems_(invoiceId, items) {
  DB.ensureSheet(INV_ITEMS_SHEET, INV_ITEMS_HEADERS);
  var rows = [];
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    if (!String(it.itemName || '').trim()) continue;
    rows.push([
      invoiceId, it.itemName, DB.num(it.qty), DB.num(it.weight), DB.num(it.rate),
      DB.num(it.labour), DB.num(it.metalAmt), DB.num(it.labourAmt), DB.num(it.itemTotal),
      it.barcode || '', it.purity || ''
    ]);
  }
  if (rows.length) {
    var sh = DB.sheet(INV_ITEMS_SHEET);
    DB.ensureCols_(sh, INV_ITEMS_COLS);
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, INV_ITEMS_COLS).setValues(rows);
  }
}

// ── Public: Save New Invoice ──────────────────────────────────

function invSaveInvoice(data) {
  try {
    if (!data || !data.master) return { success: false, message: 'No invoice data provided.' };
    var m = data.master;
    if (!m.invoiceId) return { success: false, message: 'Estimate ID is required.' };
    if (!m.date) return { success: false, message: 'Estimate date is required.' };
    if (!m.partyName) return { success: false, message: 'Customer name is required.' };
    if (!data.items || !data.items.length)
      return { success: false, message: 'Add at least one invoice item.' };

    DB.ensureSheet(INV_MASTER_SHEET, INV_MASTER_HEADERS);
    if (DB.findRowById(INV_MASTER_SHEET, m.invoiceId) !== -1)
      return { success: false, message: 'Estimate ID already exists. Please regenerate.' };

    var totalQty = 0, totalWt = 0;
    for (var j = 0; j < data.items.length; j++) {
      totalQty += DB.num(data.items[j].qty);
      totalWt += DB.num(data.items[j].weight);
    }
    totalWt = CalcSvc.round3(totalWt);

    var dateVal = DB.parseDate(m.date) || '';
    var mRow = DB.appendRow(INV_MASTER_SHEET, INV_MASTER_COLS, [
      m.invoiceId, dateVal, m.partyId || '', m.partyName, m.address || '',
      DB.num(m.subtotal), m.gstEnabled ? 'YES' : 'NO', DB.num(m.gstPct),
      DB.num(m.gstAmount), DB.num(m.grandTotal), totalQty, totalWt, m.note || ''
    ]);
    DB.setDateFormat(INV_MASTER_SHEET, mRow, 2);

    invWriteItems_(m.invoiceId, data.items);

    return { success: true, message: 'Estimate Saved', invoiceId: m.invoiceId };
  } catch (e) {
    Logger.log('invSaveInvoice: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ── Public: Update Invoice ────────────────────────────────────

function invUpdateInvoice(data) {
  try {
    if (!data || !data.master) return { success: false, message: 'No invoice data provided.' };
    var m = data.master;
    if (!m.invoiceId) return { success: false, message: 'Estimate ID is required.' };
    if (!data.items || !data.items.length)
      return { success: false, message: 'Add at least one invoice item.' };

    DB.ensureSheet(INV_MASTER_SHEET, INV_MASTER_HEADERS);
    var masterRow = DB.findRowById(INV_MASTER_SHEET, m.invoiceId);
    if (masterRow === -1) return { success: false, message: 'Estimate not found.' };

    var totalQty = 0, totalWt = 0;
    for (var j = 0; j < data.items.length; j++) {
      totalQty += DB.num(data.items[j].qty);
      totalWt += DB.num(data.items[j].weight);
    }
    totalWt = CalcSvc.round3(totalWt);

    var dateVal = DB.parseDate(m.date) || '';
    DB.updateRow(INV_MASTER_SHEET, masterRow, INV_MASTER_COLS, [
      m.invoiceId, dateVal, m.partyId || '', m.partyName || '', m.address || '',
      DB.num(m.subtotal), m.gstEnabled ? 'YES' : 'NO', DB.num(m.gstPct),
      DB.num(m.gstAmount), DB.num(m.grandTotal), totalQty, totalWt, m.note || ''
    ]);
    DB.setDateFormat(INV_MASTER_SHEET, masterRow, 2);

    // Replace items: delete old, write new
    invDeleteItems_(m.invoiceId);
    invWriteItems_(m.invoiceId, data.items);

    return { success: true, message: 'Estimate Updated' };
  } catch (e) {
    Logger.log('invUpdateInvoice: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ── Public: Delete Invoice ────────────────────────────────────

function invDeleteInvoice(invoiceId) {
  try {
    DB.ensureSheet(INV_MASTER_SHEET, INV_MASTER_HEADERS);
    var masterRow = DB.findRowById(INV_MASTER_SHEET, invoiceId);
    if (masterRow === -1) return { success: false, message: 'Estimate not found.' };

    DB.deleteRow(INV_MASTER_SHEET, masterRow);
    invDeleteItems_(invoiceId);

    return { success: true, message: 'Estimate Deleted' };
  } catch (e) {
    Logger.log('invDeleteInvoice: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ── Public: Bulk Delete Invoices ──────────────────────────────

function invBulkDelete(ids) {
  try {
    if (!ids || !ids.length) return { success: false, message: 'No IDs provided' };
    DB.ensureSheet(INV_MASTER_SHEET, INV_MASTER_HEADERS);
    var count = DB.bulkDeleteAndRewrite(INV_MASTER_SHEET, INV_MASTER_COLS, ids);
    invDeleteItemsForIds_(ids);
    return { success: true, message: count + ' estimate(s) deleted' };
  } catch (e) {
    Logger.log('invBulkDelete: ' + e.message);
    return { success: false, message: e.message };
  }
}

// ── Public: Parties Dropdown ──────────────────────────────────

function invGetPartiesForDropdown() {
  try {
    return { success: true, data: DB.getPartiesForDropdown(false) };
  } catch (e) { return { success: false, message: e.message }; }
}

// Concurrency guard: estimate writes mutate master/items and party outstanding.
var invSaveInvoice_raw = invSaveInvoice;
invSaveInvoice = function () {
  var args = arguments;
  return DB.withWriteLock('invSaveInvoice', function () {
    return invSaveInvoice_raw.apply(null, args);
  });
};

var invUpdateInvoice_raw = invUpdateInvoice;
invUpdateInvoice = function () {
  var args = arguments;
  return DB.withWriteLock('invUpdateInvoice', function () {
    return invUpdateInvoice_raw.apply(null, args);
  });
};

var invDeleteInvoice_raw = invDeleteInvoice;
invDeleteInvoice = function () {
  var args = arguments;
  return DB.withWriteLock('invDeleteInvoice', function () {
    return invDeleteInvoice_raw.apply(null, args);
  });
};

var invBulkDelete_raw = invBulkDelete;
invBulkDelete = function () {
  var args = arguments;
  return DB.withWriteLock('invBulkDelete', function () {
    return invBulkDelete_raw.apply(null, args);
  });
};
