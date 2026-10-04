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

let html = pub('index.html')
  .replace('<link rel="stylesheet" href="app.css">', () => '<style>\n' + pub('app.css') + '\n</style>')
  .replace('<script src="config.js"></script>', () => '<script>\n' + js(config) + '\n</script>')
  .replace('<script src="demo-data.js"></script>', () => '<script>\n' + js(pub('demo-data.js')) + '\n</script>')
  .replace('<script src="app.js"></script>', () => '<script>\n' + js(pub('app.js')) + '\n</script>');

html = html.replace('<!doctype html>', '<!doctype html>\n<!-- PRTG NOC Dashboard - single-file build. Edit NOC_CONFIG below to change layout. -->');

if (/(src|href)="(app|config|demo-data)\./.test(html)) throw new Error('bundle incomplete');
fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'dist', 'noc-dashboard.htm'), html);
console.log('dist/noc-dashboard.htm', html.length, 'bytes');
