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

// --page report.html builds the availability report instead of the dashboard
const argv = process.argv.slice(2);
const pageIdx = argv.indexOf('--page');
const page = pageIdx >= 0 ? argv.splice(pageIdx, 2)[1] : 'index.html';

// Inline every local stylesheet and script the page references.
let html = pub(page)
  .replace(/<link rel="stylesheet" href="([\w.-]+)">/g, (m, f) => '<style>\n' + pub(f) + '\n</style>')
  .replace(/<script src="([\w.-]+)"><\/script>/g, (m, f) =>
    '<script>\n' + js(f === 'config.js' ? config : pub(f)) + '\n</script>');

html = html.replace('<!doctype html>', '<!doctype html>\n<!-- PRTG NOC Dashboard - single-file build. Edit NOC_CONFIG below to change layout. -->');

if (/<(script src|link rel="stylesheet" href)="[\w.-]+"/.test(html)) throw new Error('bundle incomplete');

// Optional overlays (site layout, secrets) applied after config.js:
//   node build-standalone.js sites/asl-noc.js local/secrets.js -o local/noc2.htm
const args = argv;
let out = path.join('dist', 'noc-dashboard.htm');
const overlays = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '-o') out = args[++i];
  else overlays.push(args[i]);
}
if (overlays.length) {
  const extra = overlays.map((f) => '// ---- ' + path.basename(f) + '\n' + fs.readFileSync(f, 'utf8')).join('\n');
  const marker = '<script src="demo-data.js"></script>';
  html = html.replace(/(window\.NOC_CONFIG = \{[\s\S]*?\n\};\n)/, (m) => m + '\n' + js(extra) + '\n');
  if (!html.includes(extra.split('\n')[0])) throw new Error('overlay not applied' + marker);
}

fs.mkdirSync(path.dirname(path.resolve(__dirname, out)), { recursive: true });
fs.writeFileSync(path.resolve(__dirname, out), html);
console.log(out, html.length, 'bytes');
