import { test, expect, type Page, type BrowserContext, type Browser } from '@playwright/test';
import { getCsrfToken, signInDialog, setSetting, uniqueName } from '../helpers';

// "Show the edit and Settings buttons when signed out" (Global settings › General): off, a viewer's
// navbar has no pencil and no gear; signed in, both are back. The /settings address always asks for
// the password, on or off: it is the way back in. A failed read of the setting shows the buttons.
// In a REAL browser: the signed-out session, the setting's public read and the sign-in dialog.

const KEY = 'display.signed_out_buttons';

const pencil = (p: Page) => p.getByRole('button', { name: 'Enter edit mode' });
const gear = (p: Page) => p.getByRole('link', { name: 'Settings', exact: true });
const search = (p: Page) => p.getByRole('button', { name: 'Search' });

/** A fresh browser context with no session (signed out), same server. */
async function signedOutPage(browser: Browser, viewport = { width: 1280, height: 800 }): Promise<{ page: Page; ctx: BrowserContext }> {
  // Explicitly empty: in Playwright Test a new context would otherwise inherit the project's auth.json.
  const ctx = await browser.newContext({
    baseURL: test.info().project.use.baseURL, serviceWorkers: 'block', storageState: { cookies: [], origins: [] }, viewport
  });
  return { page: await ctx.newPage(), ctx };
}

/** Dashboards this spec made: deleted after each test (later specs expect the Sample only). */
const made: string[] = [];

async function newDashboard(page: Page, context: BrowserContext): Promise<{ path: string; name: string }> {
  const p = uniqueName('signedout').toLowerCase();
  const name = `Viewer ${p}`;
  const r = await page.request.post('/api/dashboards', { headers: { 'X-CSRF-Token': await getCsrfToken(context) }, data: { name, path: `/${p}` } });
  expect(r.ok(), await r.text()).toBeTruthy();
  made.push((await r.json()).id);
  return { path: `/${p}`, name };
}

async function deleteMade(page: Page, context: BrowserContext) {
  while (made.length) {
    const id = made.pop()!;
    const d = (await (await page.request.get('/api/config')).json()).dashboards.find((x: { id: string }) => x.id === id);
    if (!d) continue;
    const r = await page.request.delete(`/api/dashboards/${encodeURIComponent(id)}?revision=${d.revision}`, {
      headers: { 'X-CSRF-Token': await getCsrfToken(context) }
    });
    expect(r.ok(), `delete ${id}: ${r.status()} ${await r.text()}`).toBeTruthy();
  }
}

/** Set the option on Settings › Global settings › General, as an admin does. */
async function setInGui(page: Page, on: boolean) {
  await page.goto('/settings/global#general');
  const box = page.locator(`[id="setting-${KEY}"]`);
  const row = page.locator('.row', { has: box });
  await expect(row).toContainText('Show the edit and Settings buttons when signed out');
  await expect(row).toContainText("To sign in when they're hidden, go to /settings on your HOPS address. Bookmark it.");
  await box.setChecked(on);
  await row.getByRole('button', { name: 'Save' }).click();
  await expect(row.getByRole('button', { name: 'Save' })).toBeDisabled();
  const stored = (await (await page.request.get('/api/settings')).json()).settings.find((s: { key: string }) => s.key === KEY).value;
  expect(stored).toBe(on ? 'true' : 'false');
}

test.describe('the signed-out buttons', () => {
  test.afterEach(async ({ page, context }) => {
    await setSetting(page, KEY, 'true'); // later specs share this server and sign in from the pencil
    await deleteMade(page, context);
  });

  test('off: a viewer sees neither button, signs in at /settings, and both return; on again restores them', async ({ page, context, browser }) => {
    const d = await newDashboard(page, context);
    const { page: anon, ctx } = await signedOutPage(browser);
    const { page: phone, ctx: phoneCtx } = await signedOutPage(browser, { width: 390, height: 844 });
    try {
      // The default: on.
      await anon.goto(d.path);
      await expect(anon.getByRole('heading', { name: d.name })).toBeVisible();
      await expect(pencil(anon)).toBeVisible();
      await expect(gear(anon)).toBeVisible();

      await setInGui(page, false);

      await anon.reload();
      await expect(anon.getByRole('heading', { name: d.name })).toBeVisible();
      await expect(search(anon)).toBeVisible();
      await expect(pencil(anon)).toHaveCount(0);
      await expect(gear(anon)).toHaveCount(0);

      // A phone, too: no route to them in the bar at all.
      await phone.goto(d.path);
      await expect(phone.getByRole('heading', { name: d.name })).toBeVisible();
      await expect(pencil(phone)).toHaveCount(0);
      await expect(gear(phone)).toHaveCount(0);
      await expect(phone.getByRole('button', { name: 'Text size' }).or(phone.getByRole('button', { name: 'Increase text size' })).first()).toBeVisible();

      // The way back in: the address itself.
      await anon.goto('/settings');
      await signInDialog(anon);
      await expect(anon).toHaveURL(/\/settings\/dashboards$/);
      await expect(gear(anon)).toBeVisible();
      await anon.goto(d.path);
      await expect(pencil(anon)).toBeVisible();
      await expect(gear(anon)).toBeVisible();

      // Log out: hidden again, without a reload.
      await anon.getByRole('button', { name: 'Log out' }).click();
      await expect(anon.getByRole('button', { name: 'Log out' })).toHaveCount(0);
      await expect(pencil(anon)).toHaveCount(0);
      await expect(gear(anon)).toHaveCount(0);

      await setInGui(page, true);
      await anon.reload();
      await expect(pencil(anon)).toBeVisible();
      await expect(gear(anon)).toBeVisible();
    } finally {
      await ctx.close();
      await phoneCtx.close();
    }
  });

  test('the /settings address asks for the password with the setting on and off', async ({ page, browser }) => {
    for (const value of ['true', 'false']) {
      await setSetting(page, KEY, value);
      const { page: anon, ctx } = await signedOutPage(browser);
      try {
        await anon.goto('/settings');
        await expect(anon.getByRole('dialog', { name: 'Sign in' })).toBeVisible();
        await anon.goto('/settings/global');
        await expect(anon.getByRole('dialog', { name: 'Sign in' })).toBeVisible();
      } finally {
        await ctx.close();
      }
    }
  });

  test('a viewer gets the value with no session; the admin settings stay closed to them', async ({ page, browser }) => {
    await setSetting(page, KEY, 'false');
    const { page: anon, ctx } = await signedOutPage(browser);
    try {
      expect((await (await anon.request.get('/api/config')).json()).signedOutButtons).toBe(false);
      expect((await anon.request.get('/api/settings')).status()).toBe(401);
    } finally {
      await ctx.close();
    }
  });

  test('a read that fails shows both buttons, even in a browser that remembers them hidden', async ({ page, context, browser }) => {
    const d = await newDashboard(page, context);
    await setSetting(page, KEY, 'false');
    const { page: anon, ctx } = await signedOutPage(browser);
    try {
      await anon.goto(d.path);
      await expect(anon.getByRole('heading', { name: d.name })).toBeVisible();
      await expect(gear(anon)).toHaveCount(0);

      await anon.route(/\/api\/config(\?|$)/, (r) => r.abort());
      await anon.reload();
      await expect(gear(anon)).toBeVisible();
      await expect(pencil(anon)).toBeVisible();

      await anon.unroute(/\/api\/config(\?|$)/);
      await anon.route(/\/api\/config(\?|$)/, (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"no"}' }));
      await anon.reload();
      await expect(gear(anon)).toBeVisible();
      await expect(pencil(anon)).toBeVisible();
    } finally {
      await ctx.close();
    }
  });
});
