// ============================================================
// gsfinalize.gs — Import Finalization Utility
//
// Run ONCE from the Apps Script editor after pasting raw data
// directly into the Purchase / Sales / Parties / Receipts sheets.
//
// What it auto-fills (everything the app normally computes):
//
//  Parties  : Party ID  (format: PT#####, same prefix style as app)
//  Purchase : Purchase ID (format: P##### — identical to app's purGenId)
//             Party ID from party name lookup
//             Rate/10g, Avg Purchase Rate, Stock Balance Grams
//  Sales    : Sale ID (format: S##### — identical to app's saleGenId)
//             Party ID from party name lookup
//             Sale Rate/10g, Avg Purchase Rate Used,
//             Profit Rupees, Profit %, Stock Balance Grams
//  Receipts : Receipt ID (format: R##### — mirrors app style)
//             Party ID from party name lookup
//  Then rebuilds outstanding for every party from transactions.
//  Finally flushes the dashboard / search caches.
//
// ── ID format compatibility check ─────────────────────────────
//   App frontend generates IDs as:
//     Purchase : 'P' + Math.floor(10000 + random*90000)  → e.g. P73821
//     Sale     : 'S' + Math.floor(10000 + random*90000)  → e.g. S73821
//     Receipt  : 'ADJ'+5digits (adjustments only)
//   All IDs are sanitised server-side with sanitizeText(id, 20) — max 20 chars.
//   This file uses the same compact format so IDs are visually consistent.
//
// ── How to run ────────────────────────────────────────────────
//   1. Open Apps Script editor (Extensions → Apps Script).
//   2. Select "finalizeImportedData" in the function dropdown.
//   3. Click ▶ Run.
//   4. Check Execution Log for a full step-by-step report.
// ============================================================

// ── ID Formats (matching the app's own client-side generators) ─
//   Purchase : P#####   (purGenId: 'P' + floor(10000+random*90000))
//   Sale     : S#####   (saleGenId: 'S' + floor(10000+random*90000))
//   Receipt  : R#####   (rcptAdjustOutstanding uses 'ADJ'+5digits; we use R for imports)
//   Party    : PT#####  (parties have no auto-gen in app; we use PT prefix for imports)
// All ≤ 7 chars, well within the 20-char sanitizeText limit.

/**
 * Master entry point — run from the Apps Script editor.
 */
function finalizeImportedData() {
  Logger.log('=== finalizeImportedData START ===');

  var lock = LockService.getScriptLock();
  try {
    if (!lock.tryLock(60000)) {
      Logger.log('ERROR: Could not acquire script lock. Is another execution running?');
      return;
    }

    // ── Step 1: Ensure all sheets + headers exist ──────────────
    _fin_ensureSheets_();
    Logger.log('[1/9] Sheets verified.');

    // ── Step 2: Fill missing Party IDs in Parties sheet ────────
    var partyIdsAdded = _fin_fillPartyIds_();
    Logger.log('[2/9] Party IDs generated: ' + partyIdsAdded);

    // ── Step 3: Build party name → {id, area} lookup map ───────
    var partyMap = _fin_buildPartyMap_();
    Logger.log('[3/9] Party map built: ' + Object.keys(partyMap).length + ' parties.');

    // ── Step 4: Backfill Party IDs + Area in Purchase rows ─────
    var purPartyFilled = _fin_fillPartyIdInSheet_('Purchase', PUR_COL_COUNT, 3, 2, 4, partyMap);
    Logger.log('[4/9] Purchase party IDs filled: ' + purPartyFilled);

    // ── Step 5: Fill missing Purchase IDs ──────────────────────
    var purIdsAdded = _fin_fillTransactionIds_('Purchase', PUR_COL_COUNT, 'P', 1, [5, 6, 3]);
    Logger.log('[5/9] Purchase IDs generated: ' + purIdsAdded);

    // ── Step 6: Recalculate Purchase computed columns ───────────
    var purStats = _fin_recalcPurchaseColumns_();
    Logger.log('[6/9] Purchase columns: ' + purStats.updated + ' rows updated, ' + purStats.skipped + ' skipped.');

    // ── Step 7: Backfill Party IDs + Area in Sales rows ────────
    var salePartyFilled = _fin_fillPartyIdInSheet_('Sales', SALE_COL_COUNT, 3, 2, 4, partyMap);
    Logger.log('[7/9] Sale party IDs filled: ' + salePartyFilled);

    // ── Step 8: Fill missing Sale IDs ──────────────────────────
    var saleIdsAdded = _fin_fillTransactionIds_('Sales', SALE_COL_COUNT, 'S', 1, [5, 6, 3]);
    Logger.log('[8/9] Sale IDs generated: ' + saleIdsAdded);

    // ── Step 9a: Recalculate Sales computed columns ─────────────
    var saleStats = _fin_recalcSaleColumns_();
    Logger.log('[9a/9] Sale columns: ' + saleStats.updated + ' rows updated, ' + saleStats.skipped + ' skipped.');

    // ── Step 9b: Handle Receipts sheet ─────────────────────────
    var rcptPartyFilled = 0, rcptIdsAdded = 0;
    try {
      DB.ensureSheet('Receipts', RCPT_HEADERS);
      rcptPartyFilled = _fin_fillPartyIdInSheet_('Receipts', RCPT_COL_COUNT, 3, 2, 4, partyMap);
      rcptIdsAdded = _fin_fillTransactionIds_('Receipts', RCPT_COL_COUNT, 'R', 1, [5, 6, 3]);
      Logger.log('[9b/9] Receipts — party IDs filled: ' + rcptPartyFilled + ', receipt IDs generated: ' + rcptIdsAdded);
    } catch (re) {
      Logger.log('[9b/9] Receipts sheet skipped (not found or error): ' + re.message);
    }

    // ── Step 9c: Rebuild outstanding from raw transactions ──────
    var outStats = _fin_rebuildOutstanding_();
    Logger.log('[9c/9] Outstanding rebuilt: ' + outStats.partiesUpdated + ' parties updated.');

    // ── Flush caches ────────────────────────────────────────────
    _invalidateDashCache_();
    _invalidateSearchCache_();
    Logger.log('Caches flushed.');

    Logger.log('');
    Logger.log('=== SUMMARY ===');
    Logger.log('  Party IDs auto-generated        : ' + partyIdsAdded);
    Logger.log('  Purchase party IDs backfilled   : ' + purPartyFilled);
    Logger.log('  Purchase IDs auto-generated     : ' + purIdsAdded);
    Logger.log('  Purchase rows recalculated      : ' + purStats.updated);
    Logger.log('  Sale party IDs backfilled       : ' + salePartyFilled);
    Logger.log('  Sale IDs auto-generated         : ' + saleIdsAdded);
    Logger.log('  Sale rows recalculated          : ' + saleStats.updated);
    Logger.log('  Receipt party IDs backfilled    : ' + rcptPartyFilled);
    Logger.log('  Receipt IDs auto-generated      : ' + rcptIdsAdded);
    Logger.log('  Parties outstanding updated     : ' + outStats.partiesUpdated);

    if (outStats.warnings && outStats.warnings.length) {
      Logger.log('  Warnings:');
      for (var w = 0; w < outStats.warnings.length; w++) {
        Logger.log('    ⚠ ' + outStats.warnings[w]);
      }
    }
    Logger.log('=== finalizeImportedData COMPLETE ===');

  } catch (e) {
    Logger.log('FATAL ERROR in finalizeImportedData: ' + e.message + '\n' + (e.stack || ''));
  } finally {
    try { lock.releaseLock(); } catch (le) { }
  }
}

// ============================================================
// Internal step helpers
// ============================================================

/**
 * Ensure all required sheets exist with correct headers.
 */
function _fin_ensureSheets_() {
  DB.ensureSheet('Purchase', PUR_HEADERS);
  DB.ensureSheet('Sales', SALE_HEADERS);
  DB.ensureSheet('Parties', PART_HEADERS);
  try { DB.ensureSheet('Receipts', RCPT_HEADERS); } catch (e) { }
}

// ── Party ID generator (Parties sheet) ───────────────────────

/**
 * Fills missing Party IDs in the Parties sheet.
 * App has no auto-generator for party IDs — we use format PT##### for imports.
 * @returns {number} Number of IDs written
 */
function _fin_fillPartyIds_() {
  var sh = DB.sheet('Parties');
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return 0;
  DB.ensureCols_(sh, PART_COL_COUNT);
  var rows = sh.getRange(2, 1, lastRow - 1, PART_COL_COUNT).getValues();

  var existingIds = {};
  for (var i = 0; i < rows.length; i++) {
    var id = String(rows[i][0]).trim();
    if (id) existingIds[id] = true;
  }

  var count = 0;
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).trim()) continue;  // already has ID

    // Skip completely blank rows
    var hasName = String(rows[i][1]).trim() !== '';
    if (!hasName) continue;

    var newId = _fin_genCompactId_('PT', existingIds);
    existingIds[newId] = true;
    sh.getRange(i + 2, 1).setValue(newId);
    rows[i][0] = newId;
    count++;
  }
  return count;
}

// ── Party map builder ─────────────────────────────────────────

/**
 * Build a lowercase-name → { partyId, area } map from the Parties sheet.
 * Used to look up Party ID when only the party name is present in a row.
 * @returns {Object} map of lowerCaseName → { partyId, area }
 */
function _fin_buildPartyMap_() {
  var rows = DB.readAll('Parties', PART_COL_COUNT);
  var map = {};
  for (var i = 0; i < rows.length; i++) {
    var id = String(rows[i][0]).trim();
    var name = String(rows[i][1]).trim();
    var area = String(rows[i][3]).trim();
    if (!id || !name) continue;
    map[name.toLowerCase()] = { partyId: id, area: area };
  }
  return map;
}

// ── Party ID backfiller for transaction sheets ────────────────

/**
 * For each data row in a sheet:
 *   - If Party ID (col partyIdCol) is empty BUT Party Name (col partyNameCol) is set,
 *     look up the party by name and fill in the Party ID (and Area if empty).
 *
 * @param {string} sheetName
 * @param {number} colCount       - Total column count for the sheet
 * @param {number} partyNameCol   - 0-indexed column holding the party name
 * @param {number} partyIdCol     - 0-indexed column holding the party ID
 * @param {number} areaCol        - 0-indexed column holding area (filled if empty)
 * @param {Object} partyMap       - From _fin_buildPartyMap_()
 * @returns {number} Number of rows updated
 */
function _fin_fillPartyIdInSheet_(sheetName, colCount, partyNameCol, partyIdCol, areaCol, partyMap) {
  var sh = DB.sheet(sheetName);
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return 0;
  DB.ensureCols_(sh, colCount);
  var rows = sh.getRange(2, 1, lastRow - 1, colCount).getValues();

  var count = 0;
  for (var i = 0; i < rows.length; i++) {
    var existingPartyId = String(rows[i][partyIdCol]).trim();
    if (existingPartyId) continue;  // already has a Party ID

    var name = String(rows[i][partyNameCol]).trim();
    if (!name) continue;  // no name to look up

    var found = partyMap[name.toLowerCase()];
    if (!found) {
      Logger.log('  [WARN] ' + sheetName + ' row ' + (i + 2) + ': party "' + name + '" not found in Parties sheet — skipping.');
      continue;
    }

    // Write Party ID
    sh.getRange(i + 2, partyIdCol + 1).setValue(found.partyId);
    rows[i][partyIdCol] = found.partyId;

    // Fill Area too if it is blank
    if (areaCol !== null && !String(rows[i][areaCol]).trim() && found.area) {
      sh.getRange(i + 2, areaCol + 1).setValue(found.area);
      rows[i][areaCol] = found.area;
    }
    count++;
  }
  return count;
}

// ── Generic transaction ID generator ─────────────────────────

/**
 * Generates missing IDs for any transaction sheet (Purchase, Sales, Receipts).
 * Skips rows that already have an ID or are completely blank.
 *
 * ID format matches the app's own client-side generators:
 *   Purchase : P##### (app: 'P' + floor(10000+random*90000))
 *   Sale     : S##### (app: 'S' + floor(10000+random*90000))
 *   Receipt  : R##### (mirrors the ADJ##### pattern from rcptAdjustOutstanding)
 *
 * @param {string}   sheetName
 * @param {number}   colCount
 * @param {string}   prefix        - 'P', 'S', or 'R'
 * @param {number}   dateCellCol   - 0-indexed column with date (for logging only)
 * @param {number[]} dataCols      - 0-indexed columns; row is skipped if ALL are blank
 * @returns {number} Number of IDs written
 */
function _fin_fillTransactionIds_(sheetName, colCount, prefix, dateCellCol, dataCols) {
  var sh = DB.sheet(sheetName);
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return 0;
  DB.ensureCols_(sh, colCount);
  var rows = sh.getRange(2, 1, lastRow - 1, colCount).getValues();

  var existingIds = {};
  for (var i = 0; i < rows.length; i++) {
    var id = String(rows[i][0]).trim();
    if (id) existingIds[id] = true;
  }

  var count = 0;
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).trim()) continue;  // already has ID

    // Check if the row has any meaningful data in dataCols
    var hasData = false;
    for (var dc = 0; dc < dataCols.length; dc++) {
      var v = rows[i][dataCols[dc]];
      if (v !== '' && v !== null && v !== undefined && !(typeof v === 'number' && v === 0)) {
        hasData = true; break;
      }
    }
    if (!hasData) continue;

    // Generate unique ID using same formula as app frontend
    var newId = _fin_genCompactId_(prefix, existingIds);
    existingIds[newId] = true;

    sh.getRange(i + 2, 1).setValue(newId);
    rows[i][0] = newId;
    count++;
  }
  return count;
}

// ── Purchase column recalculator ──────────────────────────────

/**
 * Recalculates Rate/10g (col H=8), Avg Purchase Rate (col I=9),
 * Stock Balance Grams (col J=10) for every Purchase row.
 * Processes top-to-bottom to correctly compute running cumulative average.
 * @returns {{ updated: number, skipped: number }}
 */
function _fin_recalcPurchaseColumns_() {
  var sh = DB.sheet('Purchase');
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return { updated: 0, skipped: 0 };
  DB.ensureCols_(sh, PUR_COL_COUNT);
  var rows = sh.getRange(2, 1, lastRow - 1, PUR_COL_COUNT).getValues();

  var updated = 0, skipped = 0;
  var cumulativeG = 0, cumulativeR = 0;
  var writes = [];  // { sheetRow, values: [rate10g, avgRate, stockBal] }

  for (var i = 0; i < rows.length; i++) {
    var id = String(rows[i][0]).trim();
    var partyNm = String(rows[i][3]).trim();
    var grams = DB.num(rows[i][5]);
    var rupees = DB.num(rows[i][6]);

    if (!id && !partyNm && grams === 0 && rupees === 0) { skipped++; continue; }

    cumulativeG += grams;
    cumulativeR += rupees;

    var rate10g = CalcSvc.purchaseRate(grams, rupees);
    var avgRate = CalcSvc.purchaseRate(cumulativeG, cumulativeR);
    var stockBal = CalcSvc.round3(cumulativeG);

    var storedRate = CalcSvc.round2(DB.num(rows[i][7]));
    var storedAvg = CalcSvc.round2(DB.num(rows[i][8]));
    var storedStock = CalcSvc.round3(DB.num(rows[i][9]));

    if (storedRate !== rate10g || storedAvg !== avgRate || storedStock !== stockBal) {
      writes.push({ sheetRow: i + 2, values: [rate10g, avgRate, stockBal] });
      updated++;
    } else {
      skipped++;
    }
  }

  // Batch write cols H(8), I(9), J(10) — 3 columns
  _fin_batchWrite_(sh, writes, 8, 3);
  return { updated: updated, skipped: skipped };
}

// ── Sale column recalculator ──────────────────────────────────

/**
 * Recalculates Sale Rate/10g (col H=8), Avg Purchase Rate Used (col I=9),
 * Profit Rupees (col J=10), Profit % (col K=11), Stock Balance Grams (col L=12).
 * Uses binary-search prefix-sum to derive weighted avg purchase rate at each sale's date —
 * identical logic to StockSvc.recalcSaleProfitsWithData_.
 * @returns {{ updated: number, skipped: number }}
 */
function _fin_recalcSaleColumns_() {
  // Build purchase prefix-sum table sorted by date
  var purRows = DB.readAll('Purchase', PUR_COL_COUNT);
  var purchases = [];
  for (var p = 0; p < purRows.length; p++) {
    if (!purRows[p][0] && !purRows[p][3]) continue;
    var pDate = purRows[p][1] ? new Date(purRows[p][1]) : null;
    purchases.push({ date: pDate, grams: DB.num(purRows[p][5]), rupees: DB.num(purRows[p][6]) });
  }
  purchases.sort(function (a, b) {
    if (!a.date && !b.date) return 0;
    if (!a.date) return -1;
    if (!b.date) return 1;
    return a.date.getTime() - b.date.getTime();
  });

  var purTimes = [], purCumG = [], purCumR = [], allPurG = 0;
  var prefG = 0, prefR = 0;
  for (var px = 0; px < purchases.length; px++) {
    prefG += purchases[px].grams;
    prefR += purchases[px].rupees;
    allPurG += purchases[px].grams;
    purTimes.push(purchases[px].date ? purchases[px].date.getTime() : -8640000000000000);
    purCumG.push(prefG);
    purCumR.push(prefR);
  }

  var sh = DB.sheet('Sales');
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return { updated: 0, skipped: 0 };
  DB.ensureCols_(sh, SALE_COL_COUNT);
  var saleRows = sh.getRange(2, 1, lastRow - 1, SALE_COL_COUNT).getValues();

  var updated = 0, skipped = 0;
  var runningSoldG = 0;
  var writes = [];  // { sheetRow, values: [saleRate10g, avgRate, profitRup, profitPct, stockBal] }

  for (var j = 0; j < saleRows.length; j++) {
    var id = String(saleRows[j][0]).trim();
    var partyNm = String(saleRows[j][3]).trim();
    var saleG = DB.num(saleRows[j][5]);
    var saleR = DB.num(saleRows[j][6]);

    if (!id && !partyNm && saleG === 0 && saleR === 0) { skipped++; continue; }

    var saleDate = saleRows[j][1] ? new Date(saleRows[j][1]) : null;

    // Binary search for avg purchase rate at sale date
    var cumG = 0, cumR = 0;
    if (purTimes.length) {
      var targetTime = saleDate ? saleDate.getTime() : 8640000000000000;
      var lo = 0, hi = purTimes.length - 1, pos = -1;
      while (lo <= hi) {
        var mid = Math.floor((lo + hi) / 2);
        if (purTimes[mid] <= targetTime) { pos = mid; lo = mid + 1; }
        else hi = mid - 1;
      }
      if (pos >= 0) { cumG = purCumG[pos]; cumR = purCumR[pos]; }
    }

    var newAvgRate = CalcSvc.purchaseRate(cumG, cumR);
    var newProfit = CalcSvc.saleProfit(saleG, saleR, newAvgRate);
    runningSoldG += saleG;
    var newStockBal = CalcSvc.round3(allPurG - runningSoldG);

    var storedRate10g = CalcSvc.round2(DB.num(saleRows[j][7]));
    var storedAvg = CalcSvc.round2(DB.num(saleRows[j][8]));
    var storedProfitR = CalcSvc.round2(DB.num(saleRows[j][9]));
    var storedProfitP = CalcSvc.round2(DB.num(saleRows[j][10]));
    var storedStock = CalcSvc.round3(DB.num(saleRows[j][11]));

    var changed = (
      storedRate10g !== newProfit.saleRate10g ||
      storedAvg !== newAvgRate ||
      storedProfitR !== newProfit.profitRup ||
      storedProfitP !== newProfit.profitPct ||
      storedStock !== newStockBal
    );

    if (changed) {
      writes.push({ sheetRow: j + 2, values: [newProfit.saleRate10g, newAvgRate, newProfit.profitRup, newProfit.profitPct, newStockBal] });
      updated++;
    } else {
      skipped++;
    }
  }

  // Batch write cols H-L (8-12) — 5 columns
  _fin_batchWrite_(sh, writes, 8, 5);
  return { updated: updated, skipped: skipped };
}

// ── Outstanding rebuilder ─────────────────────────────────────

/**
 * Rebuilds outstanding for ALL parties by scanning all transactions:
 *   + unpaid Purchase rows → add to supplier outstanding
 *   + unpaid Sales rows    → add to customer outstanding
 *   − Receipts/Payments    → subtract from outstanding
 * Overwrites cols J & K in Parties sheet and logs every change to AuditLog.
 * @returns {{ partiesUpdated: number, warnings: string[] }}
 */
function _fin_rebuildOutstanding_() {
  var expected = {};  // partyId → { rupees, grams }
  var warnings = [];

  try {
    var purRows = DB.readAll('Purchase', PUR_COL_COUNT);
    for (var u = 0; u < purRows.length; u++) {
      var pid = String(purRows[u][2] || '').trim();
      var isPaid = purRows[u][11] === 'YES';
      if (!pid || isPaid) continue;
      if (!expected[pid]) expected[pid] = { rupees: 0, grams: 0 };
      expected[pid].rupees += DB.num(purRows[u][6]);
      expected[pid].grams += DB.num(purRows[u][5]);
    }
  } catch (e) { warnings.push('Purchase read error: ' + e.message); }

  try {
    var saleRows = DB.readAll('Sales', SALE_COL_COUNT);
    for (var s = 0; s < saleRows.length; s++) {
      var spid = String(saleRows[s][2] || '').trim();
      var sPaid = saleRows[s][13] === 'YES';
      if (!spid || sPaid) continue;
      if (!expected[spid]) expected[spid] = { rupees: 0, grams: 0 };
      expected[spid].rupees += DB.num(saleRows[s][6]);
      expected[spid].grams += DB.num(saleRows[s][5]);
    }
  } catch (e) { warnings.push('Sales read error: ' + e.message); }

  try {
    var rcptRows = DB.readAll('Receipts', RCPT_COL_COUNT);
    for (var r = 0; r < rcptRows.length; r++) {
      var rpid = String(rcptRows[r][2] || '').trim();
      if (!rpid) continue;
      if (!expected[rpid]) expected[rpid] = { rupees: 0, grams: 0 };
      expected[rpid].rupees -= DB.num(rcptRows[r][5]);
      expected[rpid].grams -= DB.num(rcptRows[r][6]);
    }
  } catch (e) { /* Receipts sheet may not exist — not fatal */ }

  var partRows = DB.readAll('Parties', PART_COL_COUNT);
  var partiesUpdated = 0;

  for (var pi = 0; pi < partRows.length; pi++) {
    var ppid = String(partRows[pi][0] || '').trim();
    if (!ppid) continue;

    var exp = expected[ppid] || { rupees: 0, grams: 0 };
    var newR = CalcSvc.round2(exp.rupees);
    var newG = CalcSvc.round3(exp.grams);
    var oldR = CalcSvc.round2(DB.num(partRows[pi][9]));
    var oldG = CalcSvc.round3(DB.num(partRows[pi][10]));

    if (oldR !== newR || oldG !== newG) {
      DB.setCells('Parties', pi + 2, 10, [[newR, newG]]);
      OutSvc.audit_(ppid, 'FINALIZE_REBUILD', newR - oldR, newG - oldG, newR, newG);
      Logger.log('  Outstanding updated — ' + String(partRows[pi][1]) +
        ' (' + ppid + '): ₹' + oldR + '/' + oldG + 'g → ₹' + newR + '/' + newG + 'g');
      partiesUpdated++;
    }
  }
  return { partiesUpdated: partiesUpdated, warnings: warnings };
}

// ── ID generation ─────────────────────────────────────────────

/**
 * Generate a short unique ID matching the app's own ID style.
 *   'P' + 5 digits → Purchase (matches purGenId in purchase.html)
 *   'S' + 5 digits → Sale     (matches saleGenId in sales.html)
 *   'R' + 5 digits → Receipt  (mirrors ADJ##### from rcptAdjustOutstanding)
 *   'PT'+ 5 digits → Party    (parties have no app generator; PT prefix for imports)
 *
 * All generated IDs are ≤ 7 chars — well within the 20-char sanitizeText limit.
 *
 * @param {string} prefix        - 'P', 'S', 'R', or 'PT'
 * @param {Object} existingIds   - Set of already-used IDs (key = id string)
 * @returns {string} Unique ID
 */
function _fin_genCompactId_(prefix, existingIds) {
  for (var attempt = 0; attempt < 200; attempt++) {
    var rand = Math.floor(10000 + Math.random() * 90000);  // 10000–99999 (5 digits)
    var newId = prefix + rand;
    if (!existingIds[newId]) return newId;
  }
  // Ultimate fallback (collision-safe via timestamp)
  return prefix + new Date().getTime().toString().slice(-5) + Math.floor(Math.random() * 9);
}

// ── Batch write helper ────────────────────────────────────────

/**
 * Write an array of pending cell changes to a sheet,
 * grouping contiguous rows into single setValues() calls for performance.
 *
 * @param {Sheet}    sh         - Google Apps Script Sheet object
 * @param {Array}    writes     - [{ sheetRow: number (1-indexed), values: any[] }]
 * @param {number}   startCol   - 1-indexed column to start writing at
 * @param {number}   numCols    - Number of columns to write per row
 */
function _fin_batchWrite_(sh, writes, startCol, numCols) {
  if (!writes.length) return;
  writes.sort(function (a, b) { return a.sheetRow - b.sheetRow; });
  var wi = 0;
  while (wi < writes.length) {
    var startRow = writes[wi].sheetRow;
    var block = [writes[wi].values];
    var wj = wi + 1;
    while (wj < writes.length && writes[wj].sheetRow === writes[wj - 1].sheetRow + 1) {
      block.push(writes[wj].values);
      wj++;
    }
    sh.getRange(startRow, startCol, block.length, numCols).setValues(block);
    wi = wj;
  }
}

// ============================================================
// Individual targeted re-runners (for partial use)
// ============================================================

/**
 * Re-run only Purchase: fill IDs + party ID lookup + recalc columns.
 */
function runFinalizePurchaseOnly() {
  Logger.log('=== runFinalizePurchaseOnly START ===');
  _fin_ensureSheets_();
  var partyMap = _fin_buildPartyMap_();
  var partyFilled = _fin_fillPartyIdInSheet_('Purchase', PUR_COL_COUNT, 3, 2, 4, partyMap);
  var idsAdded = _fin_fillTransactionIds_('Purchase', PUR_COL_COUNT, 'P', 1, [5, 6, 3]);
  var stats = _fin_recalcPurchaseColumns_();
  _invalidateDashCache_();
  _invalidateSearchCache_();
  Logger.log('Party IDs filled: ' + partyFilled + ' | IDs generated: ' + idsAdded + ' | Rows updated: ' + stats.updated);
}

/**
 * Re-run only Sales: fill IDs + party ID lookup + recalc columns.
 */
function runFinalizeSalesOnly() {
  Logger.log('=== runFinalizeSalesOnly START ===');
  _fin_ensureSheets_();
  var partyMap = _fin_buildPartyMap_();
  var partyFilled = _fin_fillPartyIdInSheet_('Sales', SALE_COL_COUNT, 3, 2, 4, partyMap);
  var idsAdded = _fin_fillTransactionIds_('Sales', SALE_COL_COUNT, 'S', 1, [5, 6, 3]);
  var stats = _fin_recalcSaleColumns_();
  _invalidateDashCache_();
  _invalidateSearchCache_();
  Logger.log('Party IDs filled: ' + partyFilled + ' | IDs generated: ' + idsAdded + ' | Rows updated: ' + stats.updated);
}

/**
 * Re-run only Receipts: fill IDs + party ID lookup.
 */
function runFinalizeReceiptsOnly() {
  Logger.log('=== runFinalizeReceiptsOnly START ===');
  _fin_ensureSheets_();
  var partyMap = _fin_buildPartyMap_();
  var partyFilled = _fin_fillPartyIdInSheet_('Receipts', RCPT_COL_COUNT, 3, 2, 4, partyMap);
  var idsAdded = _fin_fillTransactionIds_('Receipts', RCPT_COL_COUNT, 'R', 1, [5, 6, 3]);
  _invalidateDashCache_();
  _invalidateSearchCache_();
  Logger.log('Party IDs filled: ' + partyFilled + ' | IDs generated: ' + idsAdded);
}

/**
 * Re-run only outstanding rebuild (e.g. after editing Is Paid flags).
 */
function runFinalizeOutstandingOnly() {
  Logger.log('=== runFinalizeOutstandingOnly START ===');
  _fin_ensureSheets_();
  var result = _fin_rebuildOutstanding_();
  _invalidateDashCache_();
  _invalidateSearchCache_();
  Logger.log('Parties updated: ' + result.partiesUpdated);
  if (result.warnings.length) Logger.log('Warnings: ' + result.warnings.join('; '));
}

/**
 * Re-run only party ID backfill across all transaction sheets.
 */
function runFinalizePartyIdLookup() {
  Logger.log('=== runFinalizePartyIdLookup START ===');
  _fin_ensureSheets_();
  var partyMap = _fin_buildPartyMap_();
  Logger.log('Party map: ' + Object.keys(partyMap).length + ' entries');
  var p1 = _fin_fillPartyIdInSheet_('Purchase', PUR_COL_COUNT, 3, 2, 4, partyMap);
  var p2 = _fin_fillPartyIdInSheet_('Sales', SALE_COL_COUNT, 3, 2, 4, partyMap);
  var p3 = 0;
  try { p3 = _fin_fillPartyIdInSheet_('Receipts', RCPT_COL_COUNT, 3, 2, 4, partyMap); } catch (e) { }
  Logger.log('Purchase: ' + p1 + ' | Sales: ' + p2 + ' | Receipts: ' + p3);
}
