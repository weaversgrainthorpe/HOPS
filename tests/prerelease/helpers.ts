import type { Page, APIRequestContext, BrowserContext } from '@playwright/test';
import { expect } from '@playwright/test';
import { ADMIN_USERNAME, ADMIN_TEST_PASSWORD } from './constants';

// Helpers shared across e2e specs. Keep these tight — generic helpers that
// every spec needs (unique names, simple CRUD via UI, CSRF-aware fetch).
// Anything that's only used by one spec belongs inside that spec.

/**
 * Generate a unique-enough name for test fixtures so parallel tests (or
 * re-runs against a non-fresh server) don't collide.
 */
export function uniqueName(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Read the CSRF token from cookies on the given context (set on login).
 * Mutation requests must echo it in X-CSRF-Token.
 */
export async function getCsrfToken(context: BrowserContext): Promise<string> {
  const cookies = await context.cookies();
  const csrf = cookies.find(c => c.name === 'hops_csrf');
  if (!csrf) throw new Error('hops_csrf cookie not present — was the setup auth project run?');
  return csrf.value;
}

/**
 * Wrapper for authenticated API requests through Playwright's APIRequestContext.
 * Adds CSRF header for non-GET. Uses the browser context's cookies so the
 * session is shared with the page tests.
 */
export async function apiRequest(
  context: BrowserContext,
  request: APIRequestContext,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
  path: string,
  body?: unknown,
): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (method !== 'GET') {
    headers['X-CSRF-Token'] = await getCsrfToken(context);
  }
  const resp = await request.fetch(path, {
    method,
    headers,
    data: body ? JSON.stringify(body) : undefined,
  });
  return resp as unknown as Response;
}

/**
 * Sign in through the in-place sign-in dialog (the same one the dashboard pencil and Settings
 * open), which must already be showing. Resolves once the dialog has closed.
 */
export async function signInDialog(page: Page, username = ADMIN_USERNAME, password = ADMIN_TEST_PASSWORD) {
  const dlg = page.getByRole('dialog', { name: 'Sign in' });
  await expect(dlg).toBeVisible();
  await dlg.getByLabel('Username').fill(username);
  await dlg.getByLabel('Password').fill(password);
  await dlg.getByLabel('Password').press('Enter');
  await expect(dlg).toHaveCount(0);
}

/** Settings (the admin home), signed in: wait for its sections. */
export async function openSettings(page: Page) {
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Global settings', level: 2 })).toBeVisible();
}

/**
 * Create a dashboard via the UI from Settings (the admin home), open it and turn edit mode on.
 * Returns the URL path the dashboard ended up on. Its name is pushed onto `track` once it
 * exists; the caller deletes those afterwards (deleteDashboardsNamed) so later specs start from
 * the same set of dashboards.
 */
export async function createDashboardViaUI(page: Page, name: string, urlPath?: string, track?: string[]): Promise<string> {
  await openSettings(page);
  await page.getByRole('button', { name: 'New Dashboard' }).click();
  await page.fill('input#new-name', name);
  if (urlPath) {
    await page.fill('input#new-path', urlPath);
  }
  await page.click('.new-dashboard-form button.btn-primary:has-text("Save")');
  // The dashboard name lives in an <h3> inside a `button.dashboard-info`.
  await expect(page.getByRole('heading', { name, level: 3 })).toBeVisible({ timeout: 5_000 });
  // Created: from here on the caller's cleanup owns it (not before — a failed create must not
  // add a second, misleading cleanup failure).
  track?.push(name);
  await page.getByRole('heading', { name, level: 3 }).click();
  await page.waitForLoadState('networkidle');
  // Opening a dashboard doesn't enter edit mode; the "Exit Edit Mode" label is the
  // unambiguous in-edit-mode signal.
  const enterEdit = page.locator('[aria-label="Enter Edit Mode"]');
  await expect(enterEdit.or(page.locator('[aria-label="Exit Edit Mode"]'))).toBeVisible();
  if (await enterEdit.isVisible()) {
    await enterEdit.click();
  }
  await expect(page.locator('[aria-label="Exit Edit Mode"]')).toBeVisible({ timeout: 5_000 });
  await expect(page.getByRole('toolbar', { name: 'Editing' })).toBeVisible();
  return new URL(page.url()).pathname;
}

/**
 * Delete the named dashboards through the API (at their stored revisions). Each must exist and
 * each delete must succeed — a failed cleanup is a failure, never ignored, because a leftover
 * dashboard lengthens the navbar and changes later specs' layout.
 */
export async function deleteDashboardsNamed(page: Page, names: string[]) {
  for (const name of names) {
    const cfg = await (await page.request.get('/api/config')).json();
    const d = cfg.dashboards.find((x: { name: string }) => x.name === name);
    expect(d, `cleanup: dashboard "${name}" exists`).toBeTruthy();
    const r = await page.request.delete(`/api/dashboards/${encodeURIComponent(d.id)}?revision=${d.revision}`, {
      headers: { 'X-CSRF-Token': await getCsrfToken(page.context()) },
    });
    expect(r.ok(), `cleanup: delete dashboard "${name}": ${r.status()} ${await r.text()}`).toBeTruthy();
  }
}

/**
 * Convenience login (used by specs that don't reuse the storageState — eg. auth boundary tests
 * that need to start unauthenticated). Settings is the admin home: logged out, it asks for the
 * password in place.
 */
export async function login(page: Page, username = ADMIN_USERNAME, password = ADMIN_TEST_PASSWORD) {
  await page.goto('/settings');
  await signInDialog(page, username, password);
  await expect(page.getByRole('heading', { name: 'Global settings', level: 2 })).toBeVisible();
}

/**
 * Set a runtime setting through the API (shared session) and return its previous value, so the
 * caller can put it back. Fails loudly if the setting is missing or the write is refused.
 */
export async function setSetting(page: Page, key: string, value: string): Promise<string> {
  const list = await (await page.request.get('/api/settings')).json();
  const item = (list.settings || []).find((s: { key: string }) => s.key === key);
  expect(item, `setting ${key} exists`).toBeDefined();
  const r = await page.request.put(`/api/settings/${key}`, {
    headers: { 'X-CSRF-Token': await getCsrfToken(page.context()), 'Content-Type': 'application/json' },
    data: JSON.stringify({ value }),
  });
  expect(r.ok(), `set ${key}=${value}: ${r.status()} ${await r.text()}`).toBeTruthy();
  return String(item.value);
}
