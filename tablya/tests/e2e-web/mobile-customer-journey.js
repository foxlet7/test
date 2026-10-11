const { chromium } = require('playwright-core');
const NAME = process.argv[2];
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, geolocation: { latitude: 24.72, longitude: 46.68 }, permissions: ['geolocation'], deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push('PAGEERR ' + e.message));
  p.on('console', m => m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text()) && errs.push('CONSOLE ' + m.text().slice(0, 200)));
  p.on('requestfailed', r => errs.push('REQFAIL ' + r.url()));
  const step = async (n, fn) => { try { await fn(); console.log('ok  ', n); } catch (e) { console.log('FAIL', n, '-', e.message.split('\n')[0]); await p.screenshot({ path: `fail-${n.replace(/\W+/g,'_')}.png` }); throw e; } };
  const btn = (name) => p.getByRole('button', { name, exact: false }).first();
  await p.goto('http://localhost:8081/');
  await step('welcome', async () => { await p.getByText('Home-cooked food, delivered').waitFor(); await p.screenshot({ path: 'm-1-welcome.png' }); });
  await step('skip location + get started', async () => { await btn('Not now').click(); await btn('Get started').click(); });
  const email = `m-${Date.now()}@example.com`;
  await step('register', async () => {
    await p.getByLabel('Full name').fill('Sara Customer'); await p.getByLabel('Email').fill(email); await p.getByLabel('Password').fill('CorrectHorse9');
    await p.screenshot({ path: 'm-2-register.png' });
    await p.getByRole('button', { name: 'Create account' }).click();
  });
  await step('home shows kitchen', async () => { await p.getByText('Hello, Sara').waitFor(); await p.getByText(NAME).first().waitFor({ timeout: 10000 }); await p.screenshot({ path: 'm-3-home.png' }); });
  await step('open kitchen', async () => { await p.locator(`text=${NAME} >> visible=true`).first().click(); await p.locator('text=Chicken Kabsa >> visible=true').first().waitFor(); await p.screenshot({ path: 'm-4-kitchen.png' }); });
  await step('open dish + add', async () => { await p.locator('text=Chicken Kabsa >> visible=true').first().click(); await p.getByText('Size').waitFor(); await p.screenshot({ path: 'm-5-item.png' }); await btn('Add to cart').click(); });
  await step('cart footer', async () => { await p.getByRole('button', { name: /Cart \(1\)/ }).waitFor({ timeout: 8000 }); await p.getByRole('button', { name: /Cart \(1\)/ }).click(); await p.getByText('Subtotal').waitFor(); await p.screenshot({ path: 'm-6-cart.png' }); });
  await step('go checkout', async () => { await p.getByRole('button', { name: /^Checkout/ }).click(); await p.getByText('Delivery address').waitFor(); });
  await step('add address', async () => {
    await p.getByRole('button', { name: 'Add address' }).click();
    await p.getByRole('button', { name: 'Use current location' }).click();
    await p.getByLabel('Street address').fill('12 Palm St'); await p.getByLabel('City').fill('Riyadh');
    await p.getByRole('button', { name: 'Save address' }).click(); await p.locator('text=12 Palm St, Riyadh >> visible=true').first().waitFor();
    await p.goBack();
  });
  await step('quote + place COD order', async () => {
    await p.locator('text=12 Palm St, Riyadh >> visible=true').first().click();
    await p.locator('text=Total >> visible=true').last().waitFor({ timeout: 8000 }); await p.screenshot({ path: 'm-7-checkout.png' });
    await p.getByRole('button', { name: 'Place order' }).click();
  });
  await step('order screen', async () => { await p.locator('text=Order progress >> visible=true').waitFor({ timeout: 10000 }); await p.locator('text=Order placed >> visible=true').first().waitFor(); await p.screenshot({ path: 'm-8-order.png' }); });
  console.log('errors:', errs);
  await b.close();
})().catch(() => process.exit(1));
