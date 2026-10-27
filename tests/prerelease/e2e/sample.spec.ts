import { test, expect } from '@playwright/test';

// Part F (v3 rc): a fresh install seeds a NATIVE v3 Sample (backend/internal/database/sample.json):
// several tabs, folders of every shape, nesting, every tile size and a packaged background. It must
// render fully offline — every tile icon from the offline bundle, every picture packaged — so a
// fresh install never shows a broken image or an empty icon slot.

const ICONIFY_HOSTS = /(api\.)?(iconify\.design|simplesvg\.com|unisvg\.com)/;

test('a fresh install shows the v3 Sample on every tab with no failed images or icons (offline)', async ({ page }) => {
  const problems: string[] = [];
  await page.route(ICONIFY_HOSTS, (route) => {
    problems.push(`Iconify API call: ${route.request().url()}`);
    return route.abort();
  });
  page.on('requestfailed', (r) => problems.push(`request failed: ${r.url()} (${r.failure()?.errorText})`));
  page.on('response', (r) => {
    if (r.status() >= 400 && ['image', 'stylesheet', 'script', 'font'].includes(r.request().resourceType())) {
      problems.push(`${r.status()} for ${r.url()}`);
    }
  });

  const cfg = await (await page.request.get('/api/config')).json();
  expect(cfg.dashboards.map((d: { name: string }) => d.name), 'the fresh server has its Sample only').toEqual(['Sample']);
  const sample = cfg.dashboards[0];
  expect(sample.path).toBe('/sample');
  const tabs: string[] = sample.tabs.map((t: { name: string }) => t.name);
  expect(tabs.length, 'the Sample shows several tabs').toBeGreaterThanOrEqual(3);

  await page.goto('/sample');
  for (const tab of tabs) {
    await page.getByRole('tab', { name: `Switch to ${tab} tab`, exact: true }).click();
    const entries = page.locator('.tab-canvas .entry');
    await expect(entries.first()).toBeVisible();
    // Every visible tile drew its icon: an inline Iconify <svg> with content, or a loaded <img>.
    await expect.poll(async () => entries.evaluateAll((els) => els
      .filter((e) => (e as HTMLElement).offsetParent !== null)
      .filter((e) => {
        const img = e.querySelector('img') as HTMLImageElement | null;
        if (img) return !(img.complete && img.naturalWidth > 0);
        const svg = e.querySelector('svg');
        return !svg || svg.children.length === 0;
      })
      .map((e) => e.textContent?.trim() ?? '?')), { message: `${tab}: tiles with no drawn icon`, timeout: 5000 }).toEqual([]);
    // No broken <img> anywhere on the page (backgrounds are CSS; checked via the responses above).
    const broken = await page.locator('img').evaluateAll((els) => (els as HTMLImageElement[])
      .filter((i) => i.complete && i.naturalWidth === 0 && i.getAttribute('src')).map((i) => i.src));
    expect(broken, `${tab}: broken images`).toEqual([]);
  }
  // The dashboard background picture is packaged and loads.
  const bg = sample.background?.value as string;
  expect(bg).toMatch(/^\/presets\//);
  const r = await page.request.get(bg);
  expect(r.status(), `background ${bg}`).toBe(200);
  expect(problems).toEqual([]);
});
