/*
 * AlasilaCX branding. Load this BEFORE the view files:
 *   node build-standalone.js sites/asl-brand.js sites/asl-noc.js sites/asl-voip.js local/secrets.js -o local/noc.htm
 * Logo: save the official logo (PNG or SVG, transparent background; a light
 * version suits the dark screen best) as "alasilacx-logo.png" next to the page
 * in PRTG's webroot. Until then the text wordmark below is shown.
 */
Object.assign(window.NOC_CONFIG, {
  theme: 'alasilacx',
  brandName: 'AlasilaCX',
  logo: 'alasilacx-logo.png',
  wordmark: ['alasila', 'cx'],
  reportPage: 'acx-report-v2.htm',   // the Reports button opens this file. PRTG caches webroot files by name, so bump the version on updates
  weekStartsOn: 0,   // reports: 0 = Sunday (KSA working week), 1 = Monday
});
