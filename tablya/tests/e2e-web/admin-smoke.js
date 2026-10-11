const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 1200, height: 800 } });
  const errs = []; p.on('requestfinished', async r => { const s=(await r.response())?.status(); if(s>=400) console.log(s, r.url()); }); p.on('pageerror', e => errs.push(e.message)); p.on('response', r => r.status()===404 && console.log('404:', r.url())); p.on('console', m => m.type()==='error' && errs.push(m.text()));
  await p.goto('http://localhost:5173/');
  await p.waitForURL('**/login');
  await p.fill('#email', 'customer@tablya.test'); await p.fill('#pw', 'DemoPassw0rd!'); await p.click('button[type=submit]');
  await p.waitForSelector('.error-box'); console.log('customer blocked:', await p.textContent('.error-box'));
  await p.fill('#email', 'admin@tablya.test'); await p.click('button[type=submit]');
  await p.waitForSelector('.stat'); console.log('dashboard stats:', await p.locator('.stat').count());
  for (const [name, path, sel] of [['kitchens','/kitchens','table'],['orders','/orders','table, .state'],['users','/users','table'],['moderation','/moderation','h2'],['payments','/payments','h2'],['marketing','/marketing','table, .state'],['settings','/settings','.card'],['audit','/audit','table']]) {
    await p.click(`a[href="${path}"]`); await p.waitForSelector(sel, {timeout: 8000}); console.log('ok', name);
  }
  await p.click('a[href="/kitchens"]'); await p.click('table a'); await p.waitForSelector('.kv'); console.log('kitchen detail ok');
  await p.click('button:has-text("العربية")'); console.log('dir=', await p.getAttribute('html','dir'));
  await p.screenshot({ path: 'admin-ar.png' });
  console.log('page errors:', errs);
  await b.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
