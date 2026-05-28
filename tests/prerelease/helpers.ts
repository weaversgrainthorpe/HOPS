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
 * Create a dashboard via the UI starting from the admin index. Returns the
 * URL path the dashboard ended up on.
 */
export async function createDashboardViaUI(page: Page, name: string, urlPath?: string): Promise<string> {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'HOPS Admin Panel' })).toBeVisible();
  await page.click('button:has-text("New Dashboard")');
  await page.fill('input[placeholder*="e.g., Home"]', name);
  if (urlPath) {
    await page.fill('input[placeholder*="/my-dashboard"]', urlPath);
  }
  await page.click('button:has-text("Save")');
  // Wait for the dashboard list row to appear. The dashboard name lives in
  // an <h3> inside a `button.dashboard-info`, so role=heading is the
  // cleanest target.
  await expect(page.getByRole('heading', { name, level: 3 })).toBeVisible({ timeout: 5_000 });
  // Click the row to open + enter edit mode (clicking the heading hits the
  // surrounding button's onclick).
  await page.getByRole('heading', { name, level: 3 }).click();
  // Wait for editing chip
  await expect(page.getByText('Editing')).toBeVisible({ timeout: 5_000 });
  return urlPath ?? `/${name.toLowerCase().replace(/\s+/g, '-')}`;
}

/**
 * Convenience login (used by specs that don't reuse the storageState — eg.
 * auth boundary tests that need to start unauthenticated).
 */
export async function login(page: Page, username = ADMIN_USERNAME, password = ADMIN_TEST_PASSWORD) {
  await page.goto('/');
  await page.fill('input#username', username);
  await page.fill('input#password', password);
  await page.click('button[type="submit"]');
}
