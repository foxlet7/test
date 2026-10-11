const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
  await p.goto('http://localhost:8081/');
  await p.getByRole('button', { name: 'العربية' }).click();
  await p.getByRole('button', { name: 'ليس الآن' }).click();
  await p.screenshot({ path: 'ar-1-welcome.png' });
  console.log('dir:', await p.getAttribute('html', 'dir'));
  await p.getByRole('button', { name: 'أنشئ حسابك' }).count();
  await p.getByRole('button', { name: 'ابدأ الآن' }).click();
  await p.getByLabel('الاسم الكامل').fill('سارة'); await p.getByLabel('البريد الإلكتروني').fill(`ar-${Date.now()}@example.com`); await p.getByLabel('كلمة المرور').fill('CorrectHorse9');
  await p.getByRole('button', { name: 'إنشاء حساب' }).click();
  await p.locator('text=مرحبًا، سارة >> visible=true').waitFor({ timeout: 10000 });
  await p.waitForTimeout(800); await p.screenshot({ path: 'ar-2-home.png' });
  await b.close();
})().catch(e => { console.error('FAIL', e.message.split('\n')[0]); process.exit(1); });
