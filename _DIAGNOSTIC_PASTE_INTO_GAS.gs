// ============================================================
// PASTE THIS ENTIRE FILE INTO APPS SCRIPT, THEN RUN:
// 1. RUN "FIX_ALL_OUTSTANDING" to rebuild party balances.
// ============================================================

function FIX_ALL_OUTSTANDING() {
  var parties = DB.readAll('Parties', 12);
  for (var i = 0; i < parties.length; i++) {
    DB.setCells('Parties', i + 2, 10, [[0, 0]]);
  }
  Logger.log('Reset all party outstanding to 0');

  try {
    var purchases = DB.readAll('Purchase', 12);
    var purchaseDeltas = [];
    for (var p = 0; p < purchases.length; p++) {
      var ppid = String(purchases[p][2] || '').trim();
      var ppaid = purchases[p][11] === 'YES';
      var pr = DB.num(purchases[p][6]);
      var pg = DB.num(purchases[p][5]);
      if (ppid && !ppaid && (pr || pg)) {
        purchaseDeltas.push({ partyId: ppid, rupees: pr, grams: pg });
      }
    }
    OutSvc.updateDeltas(purchaseDeltas);
    Logger.log('Applied ' + purchases.length + ' purchases');
  } catch (e) {
    Logger.log('Purchase error: ' + e.message);
  }

  try {
    var sales = DB.readAll('Sales', 14);
    var saleDeltas = [];
    for (var s = 0; s < sales.length; s++) {
      var spid = String(sales[s][2] || '').trim();
      var spaid = sales[s][13] === 'YES';
      var sr = DB.num(sales[s][6]);
      var sg = DB.num(sales[s][5]);
      if (spid && !spaid && (sr || sg)) {
        saleDeltas.push({ partyId: spid, rupees: sr, grams: sg });
      }
    }
    OutSvc.updateDeltas(saleDeltas);
    Logger.log('Applied ' + sales.length + ' sales');
  } catch (e) {
    Logger.log('Sales error: ' + e.message);
  }

  try {
    var receipts = DB.readAll('Receipts', 11);
    var receiptDeltas = [];
    for (var r = 0; r < receipts.length; r++) {
      var rpid = String(receipts[r][2] || '').trim();
      var rr = DB.num(receipts[r][5]);
      var rg = DB.num(receipts[r][6]);
      if (rpid && (rr || rg)) {
        receiptDeltas.push({ partyId: rpid, rupees: -rr, grams: -rg });
      }
    }
    OutSvc.updateDeltas(receiptDeltas);
    Logger.log('Applied ' + receipts.length + ' receipts/payments/adjustments');
  } catch (e) {
    Logger.log('Receipts error: ' + e.message);
  }

  var finalRows = DB.readAll('Parties', 12);
  for (var f = 0; f < finalRows.length; f++) {
    Logger.log('Party ' + finalRows[f][0] + ' (' + finalRows[f][1] + '): Rs. ' + finalRows[f][9] + ' / ' + finalRows[f][10] + 'g');
  }
  Logger.log('=== DONE ===');
}
