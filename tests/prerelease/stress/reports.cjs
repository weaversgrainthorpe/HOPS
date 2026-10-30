// Settings reports at scale on a throwaway (default :18210): time to "working", to the result,
// the DOM size, then a click to Blocked status checks right after. Run from tests/prerelease.
const { chromium } = require('@playwright/test');
const BASE = process.argv[2] || 'http://127.0.0.1:18210';
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 }, baseURL: BASE });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  if (process.argv[3]) await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(process.argv[3]) });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.request.post('/api/auth/login', { data: { username: 'admin', password: 'stress-test-pw-3000' } });
  let t = performance.now();
  await page.goto('/settings/dashboards/duplicates');
  await page.getByText(/Finding duplicates…|groups? across/).first().waitFor({ timeout: 120000 });
  console.log('Duplicates: first sign (working or result):', Math.round(performance.now() - t), 'ms');
  await page.locator('[data-dup-count]').waitFor({ timeout: 120000 });
  console.log('Duplicates: result shown:', Math.round(performance.now() - t), 'ms;',
    await page.locator('[data-dup-count]').innerText(), '|', await page.locator('[data-dup-more]').innerText().catch(() => 'no more line'),
    '| DOM elements', await page.evaluate(() => document.getElementsByTagName('*').length));
  t = performance.now();
  await page.getByRole('link', { name: 'Blocked status checks' }).first().click();
  await page.getByRole('heading', { name: 'Blocked status checks' }).waitFor({ timeout: 120000 });
  console.log('Click to Blocked status checks, heading shown:', Math.round(performance.now() - t), 'ms');
  t = performance.now();
  await page.locator('[data-testid="blocked-status-checks"] [role=status], [data-testid="blocked-status-checks"] [data-state]').first().waitFor({ timeout: 120000 });
  console.log('Blocked status checks first status:', Math.round(performance.now() - t), 'ms');
  await page.goto('/settings/dashboards/duplicates');
  await page.locator('[data-dup-count]').waitFor({ timeout: 120000 });
  t = performance.now();
  await page.getByRole('button', { name: /^Show \d+ more$/ }).click();
  await page.waitForFunction(() => document.querySelectorAll('[data-dup-group]').length === 100);
  console.log('Show 50 more:', Math.round(performance.now() - t), 'ms');
  console.log(errors.length ? 'errors: ' + errors.join('; ') : 'no page errors');
  await b.close();
})().catch((e) => { console.error('FAILED:', e.message.split('\n')[0]); process.exit(1); });
