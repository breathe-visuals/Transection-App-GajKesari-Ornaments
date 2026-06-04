var API_ALLOWED_FUNCTIONS = {
  getAppMeta: getAppMeta,
  toggleEditMode: toggleEditMode,
  verifyAdminPassword: verifyAdminPassword,
  globalSearch: globalSearch,
  dashGetSummary: dashGetSummary,
  repGetReportData: repGetReportData,
  repGetPartyList: repGetPartyList,
  partGetAllParties: partGetAllParties,
  partGetPage: partGetPage,
  partCheckIdExists: partCheckIdExists,
  partAddParty: partAddParty,
  partUpdateParty: partUpdateParty,
  partDeleteParty: partDeleteParty,
  partBulkDelete: partBulkDelete,
  purGetAllPurchases: purGetAllPurchases,
  purGetPage: purGetPage,
  purCheckIdExists: purCheckIdExists,
  purGetPartiesForDropdown: purGetPartiesForDropdown,
  purAddPurchase: purAddPurchase,
  purUpdatePurchase: purUpdatePurchase,
  purDeletePurchase: purDeletePurchase,
  purBulkDelete: purBulkDelete,
  saleGetAllSales: saleGetAllSales,
  saleGetPage: saleGetPage,
  saleCheckIdExists: saleCheckIdExists,
  saleGetPartiesForDropdown: saleGetPartiesForDropdown,
  saleGetCalcData: saleGetCalcData,
  saleAddSale: saleAddSale,
  saleUpdateSale: saleUpdateSale,
  saleDeleteSale: saleDeleteSale,
  saleBulkDelete: saleBulkDelete,
  rcptGetAllReceipts: rcptGetAllReceipts,
  rcptGetPage: rcptGetPage,
  rcptCheckIdExists: rcptCheckIdExists,
  rcptGetPartiesForDropdown: rcptGetPartiesForDropdown,
  rcptAddReceipt: rcptAddReceipt,
  rcptUpdateReceipt: rcptUpdateReceipt,
  rcptDeleteReceipt: rcptDeleteReceipt,
  rcptBulkDelete: rcptBulkDelete,
  rcptAdjustOutstanding: rcptAdjustOutstanding,
  invCheckIdExists: invCheckIdExists,
  invGetAllInvoices: invGetAllInvoices,
  invGetPage: invGetPage,
  invGetInvoice: invGetInvoice,
  invSaveInvoice: invSaveInvoice,
  invUpdateInvoice: invUpdateInvoice,
  invDeleteInvoice: invDeleteInvoice,
  invBulkDelete: invBulkDelete,
  invGetPartiesForDropdown: invGetPartiesForDropdown
};

function doPost(e) {
  try {
    var body = apiParseBody_(e);
    var functionName = String(body.functionName || '');
    var fn = API_ALLOWED_FUNCTIONS[functionName];
    if (!fn) {
      return apiJson_({ result: { success: false, message: 'Unknown API function: ' + functionName } });
    }

    var args = Array.isArray(body.args) ? body.args : [];
    var result = fn.apply(null, args);
    return apiJson_({ result: apiSafe_(result) });
  } catch (err) {
    return apiJson_({ result: { success: false, message: err && err.message ? err.message : String(err) } });
  }
}

function apiParseBody_(e) {
  if (!e || !e.postData || !e.postData.contents) {
    throw new Error('Missing request body');
  }
  try {
    return JSON.parse(e.postData.contents);
  } catch (err) {
    throw new Error('Invalid request JSON');
  }
}

function apiJson_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(apiSafe_(payload)))
    .setMimeType(ContentService.MimeType.JSON);
}

function apiSafe_(value) {
  if (typeof safeReturn_ === 'function') return safeReturn_(value);
  if (typeof DB !== 'undefined' && DB && typeof DB.safeReturn === 'function') return DB.safeReturn(value);
  return JSON.parse(JSON.stringify(value));
}
