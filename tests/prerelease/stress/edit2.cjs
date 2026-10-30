// Heavy editing on the throwaway stress set (:18200). Run from tests/prerelease.
const { chromium } = require('@playwright/test');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 }, baseURL: 'http://127.0.0.1:18200' });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  const heap = async () => {
    await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
    const m = (await cdp.send('Performance.getMetrics')).metrics;
    return Math.round(m.find((x) => x.name === 'JSHeapUsedSize').value / 1e6);
  };
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const med = (a) => { const s = [...a].sort((x, y) => x - y); return `${s[Math.floor(s.length / 2)]} ms (max ${s[s.length - 1]})`; };
  const avg = (a) => Math.round(a.reduce((x, y) => x + y, 0) / a.length);

  await page.request.post('/api/auth/login', { data: { username: 'admin', password: 'stress-test-pw-3000' } });
  await page.goto('/stress-tabs');
  await page.locator('button[aria-label^="Open "]').first().waitFor();
  await page.getByRole('tab', { name: 'Switch to T1 tab' }).click();
  await page.waitForTimeout(500);
  await page.locator('[aria-label="Enter Edit Mode"]').click();
  const bar = page.getByRole('toolbar', { name: 'Editing' });
  await bar.waitFor();
  const tiles = page.locator('[data-node-id^="tabs-t"]:visible');
  const n = await tiles.count();
  console.log('tiles on Tab 39:', n, '| heap', await heap(), 'MB');

  // 1. Select 60 with Ctrl-click, delete them, undo, redo, undo.
  const sel = [];
  for (let i = 0; i < n; i++) {
    const t = performance.now();
    await tiles.nth(i).click({ modifiers: ['Control'] });
    sel.push(Math.round(performance.now() - t));
  }
  console.log('Ctrl-click to select 60:', med(sel), '| first 10 avg', avg(sel.slice(0, 10)), 'last 10 avg', avg(sel.slice(-10)));
  await tiles.nth(0).click({ button: 'right' });
  const menu = page.getByRole('menu');
  await menu.waitFor();
  console.log('menu for the selection:', (await menu.getByRole('menuitem').allInnerTexts()).map((s) => s.trim()).join(' / '));
  let t = performance.now();
  await menu.getByRole('menuitem', { name: /Delete/ }).first().click();
  const confirm = page.getByRole('dialog').getByRole('button', { name: /Delete/ });
  if (await confirm.count()) await confirm.first().click();
  await page.waitForTimeout(200);
  console.log('delete the selection:', Math.round(performance.now() - t), 'ms; tiles now', await tiles.count());
  t = performance.now();
  await bar.getByRole('button', { name: 'Undo' }).click();
  await page.waitForTimeout(100);
  console.log('undo:', Math.round(performance.now() - t), 'ms; tiles', await tiles.count());
  t = performance.now();
  await bar.getByRole('button', { name: 'Redo' }).click();
  await page.waitForTimeout(100);
  console.log('redo:', Math.round(performance.now() - t), 'ms; tiles', await tiles.count());
  await bar.getByRole('button', { name: 'Undo' }).click();
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape');

  // 2. 150 single changes (Duplicate), then 150 undos.
  const all = page.locator('[data-node-id]:visible');
  const toastsSeen = new Set();
  console.log('items on the tab before duplicating:', await all.count());
  const h0 = await heap();
  const dup = [];
  for (let i = 0; i < 150; i++) {
    t = performance.now();
    await tiles.nth(i % 3).click({ button: 'right' });
    await page.getByRole('menu').getByRole('menuitem', { name: 'Duplicate' }).click();
    await page.getByRole('menu').waitFor({ state: 'detached' }).catch(() => {});
    dup.push(Math.round(performance.now() - t));
    for (const x of await page.locator('[role=alert]').allInnerTexts()) toastsSeen.add(x.trim());
    if ([0, 9, 49, 99, 149].includes(i)) console.log(`  after duplicate #${i + 1}: items ${await all.count()}, took ${dup[dup.length - 1]} ms`);
  }
  console.log('150 Duplicates:', med(dup), '| first 10 avg', avg(dup.slice(0, 10)), 'last 10 avg', avg(dup.slice(-10)),
    '| tiles', await tiles.count(), '| heap', h0, '->', await heap(), 'MB');
  console.log('error messages during duplicates:', [...toastsSeen].join(' / ') || 'none');
  const und = [];
  for (let i = 0; i < 150; i++) {
    t = performance.now();
    try { await bar.getByRole('button', { name: 'Undo' }).click({ timeout: 8000 }); }
    catch (e) {
      const u = bar.getByRole('button', { name: 'Undo' });
      console.log(`undo #${i + 1} could not be clicked: enabled=${await u.isEnabled().catch(() => '?')}, visible=${await u.isVisible().catch(() => '?')}; dialogs=${await page.getByRole('dialog').count()}; menus=${await page.getByRole('menu').count()}; alerts=${(await page.getByRole('alert').allInnerTexts().catch(() => [])).join(' | ').slice(0, 200)}`);
      await page.screenshot({ path: process.argv[2] + '/11-undo-stuck.png' });
      break;
    }
    und.push(Math.round(performance.now() - t));
  }
  await page.waitForTimeout(300);
  console.log('150 undos:', med(und), '| tiles back to', await tiles.count(), '| heap', await heap(), 'MB');

  // 3. Save the long session's end state (nothing changed overall) and leave.
  const save = bar.getByRole('button', { name: /Save/ });
  console.log('Save enabled after undoing everything:', await save.isEnabled());
  await page.getByRole('button', { name: 'Exit Edit Mode' }).click();
  const disc = page.getByRole('dialog').getByRole('button', { name: /Discard|Leave|Exit/ });
  if (await disc.count()) await disc.first().click();
  console.log(errors.length ? 'errors: ' + errors.slice(0, 3).join('; ') : 'no page errors');
  await b.close();
})().catch((e) => { console.error('FAILED:', e.message.split('\n')[0]); process.exit(1); });
