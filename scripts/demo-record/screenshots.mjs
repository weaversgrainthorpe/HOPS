// Discovery screenshot generator.
//
// Captures the four Discovery admin pages as PNGs for the README grid
// and the landing-page screenshot section. Borrows the auth flow from
// record.mjs but skips the storyboard recording — just navigates,
// waits for content, and snaps.
//
// Run:
//   HOPS_BASE=https://hops.weaversgrainthorpe.uk HOPS_PASSWORD=... node screenshots.mjs
//
// Output: ../../docs/screenshots/admin-discovery{,-draft,-detectors,-diagnostics}.png

import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BASE = process.env.HOPS_BASE || 'https://hops.weaversgrainthorpe.uk';
const USER = process.env.HOPS_USER || 'admin';
const PASS = process.env.HOPS_PASSWORD;
if (!PASS) { console.error('Set HOPS_PASSWORD env var'); process.exit(1); }

const VIEWPORT = { width: 1280, height: 720 };
const OUTDIR = path.resolve(__dirname, '../../docs/screenshots');

const beat = (ms) => new Promise(r => setTimeout(r, ms));

await fs.mkdir(OUTDIR, { recursive: true });

const browser = await chromium.launch({ headless: true, args: ['--hide-scrollbars'] });
const context = await browser.newContext({ viewport: VIEWPORT, ignoreHTTPSErrors: true });

// Reuse the API pre-auth dance from record.mjs so the SPA boots straight
// into the admin area.
console.log('▸ pre-auth via API');
const loginResp = await fetch(BASE + '/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: USER, password: PASS }),
});
if (!loginResp.ok) throw new Error(`Pre-auth failed: ${loginResp.status}`);
const setCookies = loginResp.headers.getSetCookie?.() || loginResp.headers.raw?.()['set-cookie'] || [];
const baseUrl = new URL(BASE);
const cookies = setCookies.map(c => {
  const [pair, ...attrs] = c.split(';');
  const [name, value] = pair.split('=');
  const attrMap = Object.fromEntries(attrs.map(a => a.trim().split('=')).map(([k, v]) => [k.toLowerCase(), v ?? true]));
  return {
    name: name.trim(),
    value,
    domain: baseUrl.hostname,
    path: attrMap.path || '/',
    httpOnly: !!attrMap.httponly,
    secure: !!attrMap.secure,
    sameSite: 'Lax',
  };
});
await context.addCookies(cookies);

const page = await context.newPage();

// We need a finished scan with results to make /admin/discovery/[id] and
// /admin/discovery/diagnostics non-empty. Look one up via the API.
console.log('▸ find a finished scan with results');
const scansResp = await page.request.get(BASE + '/api/discovery/scans');
const { scans } = await scansResp.json();
const candidate = scans.find(s => s.state === 'complete' && (s.progressDone ?? 0) > 0);
if (!candidate) {
  throw new Error('No completed scan on prod to screenshot — run one first.');
}
console.log(`  using scan ${candidate.id} (${candidate.cidr})`);

async function snap(url, filename, waitForText) {
  const out = path.join(OUTDIR, filename);
  console.log(`▸ ${url} → ${filename}`);
  await page.goto(BASE + url, { waitUntil: 'domcontentloaded' });
  if (waitForText) {
    await page.waitForFunction(
      (t) => document.body && document.body.innerText.includes(t),
      waitForText,
      { timeout: 20000 },
    );
  }
  // Wait for network to quieten + a beat for icon images + any transitions.
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  await beat(1500);
  await page.screenshot({ path: out, fullPage: false });
}

// Wait by visible text rather than CSS class — the class names have changed
// before and this script should survive that.
await snap('/admin/discovery', 'admin-discovery.png', 'Network Discovery');
await snap(`/admin/discovery/${candidate.id}`, 'admin-discovery-draft.png', 'Discovery draft');
await snap('/admin/discovery/detectors', 'admin-discovery-detectors.png', 'Discovery detectors');
await snap('/admin/discovery/diagnostics', 'admin-discovery-diagnostics.png', 'Discovery diagnostics');

await context.close();
await browser.close();
console.log('▸ done');
