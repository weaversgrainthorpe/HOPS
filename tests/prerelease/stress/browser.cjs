// Browser stress run against the throwaway HOPS on :18200 (run from tests/prerelease for Playwright).
const { chromium } = require('@playwright/test');
const OUT = process.argv[2];
const BASE = 'http://127.0.0.1:18200';
const TILES = 'button[aria-label^="Open "]';

const ms = (t) => Math.round(performance.now() - t);
const stats = (a) => { const s = [...a].sort((x, y) => x - y); return `median ${s[Math.floor(s.length / 2)]} ms, max ${s[s.length - 1]} ms`; };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, baseURL: BASE });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  const heap = async () => Math.round((await page.evaluate(() => performance.memory ? performance.memory.usedJSHeapSize : 0)) / 1e6);

  // 1. Big dashboard, signed out.
  let t = performance.now();
  await page.goto('/stress-test');
  await page.locator(TILES).first().waitFor({ timeout: 60000 });
  console.log(`Stress Test first tile visible: ${ms(t)} ms; tiles on first tab: ${await page.locator(TILES).count()}; heap ${await heap()} MB`);
  await page.screenshot({ path: `${OUT}/1-deep-tab.png` });

  // 2. Every tab of the big dashboard.
  const tabs = page.getByRole('tab');
  const nTabs = await tabs.count();
  const times = [];
  for (let i = 1; i < nTabs; i++) {
    const tab = tabs.nth(i);
    t = performance.now();
    await tab.click();
    await page.waitForFunction((n) => document.querySelector('[role=tab][aria-selected=true]')?.getAttribute('aria-label') === n,
      await tab.getAttribute('aria-label'), { timeout: 30000 });
    await page.locator(TILES).first().waitFor({ timeout: 30000 });
    times.push(ms(t));
    if (i === 5) await page.screenshot({ path: `${OUT}/2-tab5.png`, fullPage: false });
  }
  console.log(`Stress Test: ${nTabs} tabs; switching through ${times.length}: ${stats(times)}; tiles on last tab: ${await page.locator(TILES).count()}; heap ${await heap()} MB`);

  // 3. 200 tabs.
  t = performance.now();
  await page.goto('/stress-tabs');
  await page.locator(TILES).first().waitFor({ timeout: 60000 });
  const n200 = await page.getByRole('tab').count();
  console.log(`Stress Tabs first tile visible: ${ms(t)} ms; tabs in the bar: ${n200}`);
  await page.screenshot({ path: `${OUT}/3-200-tabs.png` });
  const last = page.getByRole('tab').last();
  t = performance.now();
  try {
    await last.scrollIntoViewIfNeeded({ timeout: 5000 });
    await last.click({ timeout: 10000 });
    await page.waitForFunction(() => document.querySelector('[role=tab][aria-selected=true]') === [...document.querySelectorAll('[role=tab]')].pop(), null, { timeout: 10000 });
    console.log(`Reached and opened the 200th tab: ${ms(t)} ms (label: ${await last.getAttribute('aria-label')})`);
  } catch (e) {
    console.log(`Could not open the 200th tab by clicking: ${e.message.split('\n')[0]}`);
  }
  await page.screenshot({ path: `${OUT}/4-200th-tab.png` });

  // 4. Deep nesting.
  await page.goto('/stress-deep');
  await page.locator(TILES).first().waitFor({ timeout: 30000 });
  console.log(`Stress Deep: tiles visible ${await page.locator(TILES).count()} of 33`);
  await page.screenshot({ path: `${OUT}/5-deep.png`, fullPage: true });

  // 5. Signed in: edit mode and save on the big dashboard.
  const login = await page.request.post('/api/auth/login', { data: { username: 'admin', password: 'stress-test-pw-3000' } });
  console.log(`Sign-in: ${login.status()}`);
  await page.goto('/stress-test');
  await page.locator(TILES).first().waitFor({ timeout: 60000 });
  await page.getByRole('tab').nth(3).click();
  t = performance.now();
  await page.locator('[aria-label="Enter Edit Mode"]').click();
  const bar = page.getByRole('toolbar', { name: 'Editing' });
  await bar.waitFor({ timeout: 60000 });
  console.log(`Enter edit mode: ${ms(t)} ms; heap ${await heap()} MB`);
  await page.screenshot({ path: `${OUT}/6-edit.png` });
  // A small change through the UI: add a tile is dialog-heavy; use Add tab, which marks the draft dirty.
  t = performance.now();
  await bar.getByRole('button', { name: /Add tab/ }).click();
  const dlg = page.getByRole('dialog');
  if (await dlg.count()) {
    const name = dlg.getByRole('textbox').first();
    if (await name.count()) await name.fill('Added under stress');
    await dlg.getByRole('button', { name: /^(Add|Create|Save|OK)/ }).first().click();
  }
  const save = bar.getByRole('button', { name: /Save/ });
  await save.waitFor();
  console.log(`Add tab: ${ms(t)} ms; Save enabled: ${await save.isEnabled()}`);
  t = performance.now();
  const resp = page.waitForResponse((r) => r.url().includes('/api/dashboards/') && r.request().method() === 'PUT', { timeout: 60000 });
  await save.click();
  const r = await resp;
  console.log(`Save: HTTP ${r.status()} after ${ms(t)} ms`);
  await page.getByRole('button', { name: 'Exit Edit Mode' }).click().catch(() => {});
  await page.waitForTimeout(500);
  console.log(`Tabs after save: ${await page.getByRole('tab').count()}; heap ${await heap()} MB`);

  // 6. Settings reports over everything.
  for (const p of ['/settings/dashboards', '/settings/dashboards/dead-links', '/settings/dashboards/duplicates', '/settings/dashboards/blocked-status-checks']) {
    t = performance.now();
    await page.goto(p);
    await page.getByRole('heading', { level: 2 }).first().waitFor({ timeout: 60000 });
    await page.waitForLoadState('networkidle');
    const txt = (await page.locator('main').innerText()).replace(/\s+/g, ' ').slice(0, 160);
    console.log(`${p}: ${ms(t)} ms — ${txt}`);
    await page.screenshot({ path: `${OUT}/7-${p.split('/').pop()}.png` });
  }
  console.log(errors.length ? `Browser errors (${errors.length}):\n  ` + [...new Set(errors)].slice(0, 15).join('\n  ') : 'No browser errors.');
  await browser.close();
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
