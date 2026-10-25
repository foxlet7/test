'use strict';
// Bundles public/* into ONE self-contained file: dist/noc-dashboard.htm
// That file runs inside PRTG's webroot and calls the PRTG API directly
// using the viewer's PRTG login session (no backend, no stored credentials).
//   node build-standalone.js
const fs = require('fs');
const path = require('path');

const pub = (f) => fs.readFileSync(path.join(__dirname, 'public', f), 'utf8');
// keep "</script>" sequences inside JS from closing the inline tag
const js = (s) => s.replace(/<\/script/gi, '<\\/script');

const config = pub('config.js').replace(
  /window\.NOC_CONFIG = \{/,
  "window.NOC_CONFIG = {\n" +
  "  // =====================================================================\n" +
  "  //  PASTE YOUR PRTG LOGIN DETAILS HERE  (use a READ-ONLY PRTG user)\n" +
  "  //  Option A: API key  ->  apiToken: 'xxxxxxxx',\n" +
  "  //  Option B: user + passhash  ->  username: 'noc-screen', passhash: '1234567890',\n" +
  "  //  Anyone who can open this page can read these values in the source.\n" +
  "  // =====================================================================\n" +
  "  apiToken: '',\n" +
  "  username: '',\n" +
  "  passhash: '',\n" +
  "  // =====================================================================\n\n" +
  "  source: 'prtg',  // single-file mode: read the PRTG API directly\n"
);

// --page report.html builds the availability report instead of the dashboard.
// The dashboard build embeds the report page too, so "Reports" works from the
// same file and window (no second file needed in webroot).
const argv = process.argv.slice(2);
const pageIdx = argv.indexOf('--page');
const page = pageIdx >= 0 ? argv.splice(pageIdx, 2)[1] : 'index.html';
// --no-report: don't embed the report; the Reports button then opens noc-uptime.htm
const noReportIdx = argv.indexOf('--no-report');
const embedReport = noReportIdx < 0;
if (!embedReport) argv.splice(noReportIdx, 1);

// Optional overlays (brand, site layouts, secrets) applied after config.js:
//   node build-standalone.js sites/asl-brand.js sites/asl-noc.js sites/asl-voip.js local/secrets.js -o local/noc.htm
let out = path.join('dist', page === 'index.html' ? 'noc-dashboard.htm' : page.replace('.html', '.htm'));
const overlays = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '-o') out = argv[++i];
  else overlays.push(argv[i]);
}

function build(pageFile) {
  // Inline every local stylesheet and script the page references.
  let html = pub(pageFile)
    .replace(/<link rel="stylesheet" href="([\w.-]+)">/g, (m, f) => '<style>\n' + pub(f) + '\n</style>')
    .replace(/<script src="([\w.-]+)"><\/script>/g, (m, f) =>
      '<script>\n' + js(f === 'config.js' ? config : pub(f)) + '\n</script>');
  html = html.replace('<!doctype html>', '<!doctype html>\n<!-- PRTG NOC Dashboard - single-file build. Edit NOC_CONFIG below to change layout. -->');
  if (/<(script src|link rel="stylesheet" href)="[\w.-]+"/.test(html)) throw new Error('bundle incomplete');

  if (overlays.length) {
    const extra = overlays.map((f) => '// ---- ' + path.basename(f) + '\n' + fs.readFileSync(f, 'utf8')).join('\n');
    html = html.replace(/(window\.NOC_CONFIG = \{[\s\S]*?\n\};\n)/, (m) => m + '\n' + js(extra) + '\n');
    if (!html.includes(extra.split('\n')[0])) throw new Error('overlay not applied');
  }
  return html;
}

let html = build(page);
if (page === 'index.html' && embedReport) {
  // base64 keeps the embedded page inert inside the dashboard's HTML
  // Short lines: PRTG runs webroot .htm files through its template parser,
  // which fails ("EParserError") on very long lines. atob() ignores the newlines.
  const report = Buffer.from(build('report.html'), 'utf8').toString('base64').replace(/.{1,76}/g, '$&\n');
  html = html.replace('<template id="report-src"></template>',
    () => '<script type="text/plain" id="report-src">' + report + '</script>');
  if (!html.includes('id="report-src">')) throw new Error('report not embedded');
}

// PRTG's template parser rejects very long lines - fail the build instead of the page.
const longest = html.split('\n').reduce((m, l) => Math.max(m, l.length), 0);
if (longest > 2000) throw new Error('line of ' + longest + ' chars - PRTG webroot pages need short lines');
if (/<#|#>/.test(html)) throw new Error('contains PRTG template markers (<# or #>)');

fs.mkdirSync(path.dirname(path.resolve(__dirname, out)), { recursive: true });
fs.writeFileSync(path.resolve(__dirname, out), html);
console.log(out, html.length, 'bytes');
