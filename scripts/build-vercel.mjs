import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'public');

const pages = [
  { page: 'dashboard', source: 'index.html', output: 'index.html' },
  { page: 'parties', source: 'parties.html', output: 'parties.html' },
  { page: 'purchase', source: 'purchase.html', output: 'purchase.html' },
  { page: 'sales', source: 'sales.html', output: 'sales.html' },
  { page: 'payments', source: 'payments.html', output: 'payments.html' },
  { page: 'invoice', source: 'invoice.html', output: 'invoice.html' },
  { page: 'reports', source: 'reports.html', output: 'reports.html' }
];

const appDefaults = {
  editMode: false,
  scriptUrl: '',
  apiBaseUrl: '/api/gas',
  routerMode: 'static',
  businessName: 'GajKesari Ornaments',
  businessSub: 'Fine Jewellery',
  logoUrl: '',
  version: '1.0.0',
  currencySymbol: '\u20b9',
  printDisclaimer: '',
  primaryColor: '#0d9488',
  sidebarColor: '#0f1117',
  fontFamily: 'Poppins,sans-serif',
  borderRadius: '10px'
};

async function read(name) {
  return readFile(path.join(root, name), 'utf8');
}

function replaceOnce(html, needle, value, label) {
  if (!html.includes(needle)) throw new Error(`Missing ${label}: ${needle}`);
  return html.replace(needle, value);
}

function renderPage(template, partials, pageDef) {
  const app = { ...appDefaults, currentPage: pageDef.page };
  let html = template;

  html = replaceOnce(html, '<!-- CSS_INCLUDE -->', partials.css, 'CSS include');
  html = replaceOnce(html, '<!-- API_INCLUDE -->', partials.api, 'API include');
  html = replaceOnce(html, '<!-- JS_INCLUDE -->', partials.js, 'JS include');
  html = replaceOnce(html, '<!-- CONTENT_INCLUDE -->', partials.content, 'page content');
  html = replaceOnce(html, '__APP_JSON__', JSON.stringify(app), 'APP config');

  if (/<\?/.test(html) || /google\.script/.test(html)) {
    throw new Error(`${pageDef.output} still contains Apps Script-only frontend code`);
  }

  return html;
}

async function main() {
  const template = await read('template.html');
  const partials = {
    css: await read('_css.html'),
    api: await read('_api.html'),
    js: await read('_js.html')
  };

  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  for (const pageDef of pages) {
    const content = await read(pageDef.source);
    const html = renderPage(template, { ...partials, content }, pageDef);
    await writeFile(path.join(outDir, pageDef.output), html, 'utf8');
  }

  console.log(`Built ${pages.length} Vercel pages in ${path.relative(root, outDir)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
