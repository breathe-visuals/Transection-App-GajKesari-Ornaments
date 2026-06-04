// ============================================================
// gstemplate.gs — GajKesari Ornaments | Routing & Entry Point
// Config, auth, and metadata are in _config.gs.
// Data access is in _data.gs.
// ============================================================

// ── Entry Point ──────────────────────────────────────────────
// IMPORTANT: This file MUST be included in the Apps Script project.
// After any change, re-deploy via: Deploy > Manage Deployments > New Version.
function doGet(e) {
  var page = 'dashboard';
  try {
    if (e && e.parameter && e.parameter.page) {
      page = e.parameter.page;
    }
  } catch(pe) { page = 'dashboard'; }

  var pageTemplates = {
    'dashboard': 'index',
    'parties':   'parties',
    'purchase':  'purchase',
    'sales':     'sales',
    'payments':  'payments',
    'invoice':   'invoice',
    'estimate':  'invoice',
    'reports':   'reports'
  };

  var contentFile = pageTemplates[page];
  if (!contentFile) { contentFile = 'index'; page = 'dashboard'; }

  try {
    var content = HtmlService
      .createHtmlOutputFromFile(contentFile)
      .getContent();

    // Load config for UI injection
    var cfg = {};
    try { cfg = getConfig(); } catch(ce) {}

    var em = false;
    try { em = getEditMode().editMode; } catch(emErr) {}

    var scriptUrl = '';
    try { scriptUrl = ScriptApp.getService().getUrl(); } catch(su) {}

    // Build a single JSON data blob — keeps template.html scriptlet-free
    var pf = String(cfg['PrimaryFont']   || 'Roboto').replace(/['\";]/g, '').trim();
    var sf = String(cfg['SecondaryFont'] || 'sans-serif').replace(/['\";]/g, '').trim();
    var appData = {
      editMode:        em,
      currentPage:     page,
      scriptUrl:       scriptUrl,
      apiBaseUrl:      scriptUrl,
      routerMode:      'gas',
      appName:         String(cfg['AppName']           || 'GajKesari Ornaments'),
      businessName:    String(cfg['business_name']     || cfg['AppName'] || 'GajKesari Ornaments'),
      businessSub:     String(cfg['businessSub']       || 'Silver Wholesaler'),
      logoUrl:         convertDriveUrl_(String(cfg['business_logo_url'] || '')),
      version:         String(cfg['Version']           || '1.0.0'),
      currencySymbol:  String(cfg['CurrencySymbol']    || '\u20b9'),
      printDisclaimer: String(cfg['PrintDisclaimer']   || 'All sales are final'),
      primaryColor:    String(cfg['primaryColor']      || '#0d9488'),
      sidebarColor:    String(cfg['SidebarColor']      || '#0f1117'),
      fontFamily:      "'" + pf + "', " + sf,
      borderRadius:    String(cfg['BorderRadius']      || '8px')
    };

    var html = HtmlService.createHtmlOutputFromFile('template').getContent()
      .replace('<!-- CSS_INCLUDE -->', include('_css'))
      .replace('__APP_JSON__', JSON.stringify(appData))
      .replace('<!-- API_INCLUDE -->', include('_api'))
      .replace('<!-- CONTENT_INCLUDE -->', content)
      .replace('<!-- JS_INCLUDE -->', include('_js'));

    return HtmlService.createHtmlOutput(html)
      .setTitle(appData.appName + ' \u2014 Business App')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1.0');

  } catch (err) {
    Logger.log('doGet error [page=' + page + ']: ' + err.message);
    var errUrl = '';
    try { errUrl = ScriptApp.getService().getUrl(); } catch(e2) {}
    return HtmlService.createHtmlOutput(
      '<div style="font-family:sans-serif;padding:40px;color:#dc2626">'
      + '<h2>Error loading page: <em>' + page + '</em></h2>'
      + '<p>' + err.message + '</p>'
      + (errUrl ? '<a href="' + errUrl + '">← Back to Dashboard</a>' : '')
      + '</div>'
    );
  }
}

// ── Include Helper ────────────────────────────────────────────
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// ── Script URL Helper ─────────────────────────────────────────
function getScriptUrl() {
  try {
    var url = ScriptApp.getService().getUrl();
    return url || '';
  } catch(e) {
    Logger.log('getScriptUrl error: ' + e.message);
    return '';
  }
}
