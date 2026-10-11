const { chromium } = require('playwright-core');
const [EMAIL] = process.argv.slice(2);
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push('PAGEERR ' + e.message)); p.on('console', m => m.type()==='error' && !/favicon|Failed to load resource/.test(m.text()) && errs.push('CONSOLE '+m.text().slice(0,200)));
  const step = async (n, fn) => { try { await fn(); console.log('ok  ', n); } catch (e) { console.log('FAIL', n, '-', e.message.split('\n')[0]); await p.screenshot({ path: `fail-${n.replace(/\W+/g,'_')}.png` }); throw e; } };
  const vis = (t) => p.locator(`text=${t} >> visible=true`).first();
  await p.goto('http://localhost:8081/');
  await step('login', async () => { await vis('I already have an account').waitFor().catch(()=>{}); await p.getByRole('button', { name: 'Not now' }).click(); await p.getByRole('button', { name: 'I already have an account' }).click(); await p.getByLabel('Email').fill(EMAIL); await p.getByLabel('Password').fill('CorrectHorse9'); await p.getByRole('button', { name: 'Log in' }).click(); await vis('Hello, E2E').waitFor(); });
  await step('profile -> cook dashboard', async () => { await p.getByRole('tab', { name: 'Profile' }).click(); await p.getByRole('button', { name: 'Cook dashboard' }).click(); await vis('Pending').waitFor(); await p.screenshot({ path: 'c-1-orders.png' }); });
  await step('accept order', async () => { await p.getByRole('button', { name: 'Accept' }).first().click(); await p.getByRole('tab', { name: 'Active' }).click(); await vis('Start preparing').waitFor(); });
  for (const [btn] of [['Start preparing'], ['Mark ready'], ['Out for delivery'], ['Mark delivered']]) {
    await step(btn, async () => { await p.getByRole('button', { name: btn }).first().click(); await p.waitForTimeout(700); });
  }
  await step('menu tab + availability', async () => { await p.getByRole('tab', { name: 'Menu' }).click(); await vis('Chicken Kabsa').waitFor(); await p.screenshot({ path: 'c-2-menu.png' }); });
  await step('earnings tab', async () => { await p.getByRole('tab', { name: 'Earnings' }).click(); await vis('Available balance').waitFor(); await p.screenshot({ path: 'c-3-earnings.png' }); });
  console.log('errors:', errs);
  await b.close();
})().catch(() => process.exit(1));
