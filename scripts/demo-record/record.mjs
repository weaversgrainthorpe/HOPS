// HOPS demo recorder.
//
// Drives a real Chromium with Playwright through a ~30s storyboard and
// records the session as WebM. Run with HOPS_PASSWORD env var set:
//   HOPS_BASE=https://hops.weaversgrainthorpe.uk HOPS_PASSWORD=admin node record.mjs
//
// Output: ./output/<random-name>.webm. We rename to demo.webm afterwards.

import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BASE = process.env.HOPS_BASE || 'https://hops.weaversgrainthorpe.uk';
const USER = process.env.HOPS_USER || 'admin';
const PASS = process.env.HOPS_PASSWORD;
if (!PASS) { console.error('Set HOPS_PASSWORD env var'); process.exit(1); }
const DASHBOARD_PATH = process.env.HOPS_DASHBOARD || '/Weavers';

const VIEWPORT = { width: 1280, height: 720 };
const OUTDIR = path.join(__dirname, 'output');

// Pause helper — use this instead of waitForTimeout for narrative beats so
// the video has natural rhythm rather than feeling mashed together.
const beat = (ms) => new Promise(r => setTimeout(r, ms));

// Smooth drag — issues many small mouse-move events between two points so
// svelte-dnd-action sees realistic pointer motion. svelte-dnd-action uses a
// short delay-detector before treating the gesture as a drag, so we hover at
// the source for ~400ms after mouse-down before starting motion.
async function smoothDrag(page, from, to, steps = 60, stepDelay = 25) {
  await page.mouse.move(from.x, from.y);
  await page.waitForTimeout(150);
  await page.mouse.down();
  // svelte-dnd-action's delay-detector — give it time to register the drag
  await beat(500);
  // Initial tiny wiggle to confirm we're dragging, then move to target
  await page.mouse.move(from.x + 6, from.y + 6, { steps: 5 });
  await beat(100);
  for (let i = 1; i <= steps; i++) {
    const x = from.x + (to.x - from.x) * (i / steps);
    const y = from.y + (to.y - from.y) * (i / steps);
    await page.mouse.move(x, y);
    await beat(stepDelay);
  }
  // Hover over drop target briefly before releasing
  await beat(400);
  await page.mouse.up();
}

async function center(locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('Locator has no bounding box');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

await fs.mkdir(OUTDIR, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--hide-scrollbars'],
});
const context = await browser.newContext({
  viewport: VIEWPORT,
  ignoreHTTPSErrors: true,
  recordVideo: { dir: OUTDIR, size: VIEWPORT },
});

// Inject a fake cursor that follows real mouse events. Headless Chromium
// doesn't render the system cursor in screen recordings, so we need a CSS
// pseudo-cursor synced to mouse events. This runs on every page and survives
// navigation.
await context.addInitScript(() => {
  const install = () => {
    if (document.getElementById('__hops_demo_cursor__')) return;
    const c = document.createElement('div');
    c.id = '__hops_demo_cursor__';
    c.innerHTML = `
      <svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path d="M2 2 L2 18 L7 13 L10 20 L13 19 L10 12 L17 12 Z"
              fill="white" stroke="black" stroke-width="1.5" stroke-linejoin="round"/>
      </svg>`;
    Object.assign(c.style, {
      position: 'fixed',
      left: '0px',
      top: '0px',
      pointerEvents: 'none',
      zIndex: '2147483647',
      transition: 'transform 80ms linear',
      transform: 'translate(-2px, -2px)',
      willChange: 'transform',
      filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.5))',
    });
    document.body.appendChild(c);

    const move = (x, y) => {
      c.style.transform = `translate(${x - 2}px, ${y - 2}px)`;
    };
    window.addEventListener('mousemove', (e) => move(e.clientX, e.clientY), { capture: true });
    window.addEventListener('mousedown', () => {
      c.style.filter = 'drop-shadow(0 0 6px rgba(80,160,255,0.9))';
    }, { capture: true });
    window.addEventListener('mouseup', () => {
      c.style.filter = 'drop-shadow(0 1px 2px rgba(0,0,0,0.5))';
    }, { capture: true });
  };
  if (document.body) install();
  else document.addEventListener('DOMContentLoaded', install);
});

// Log in via the API BEFORE we open any page in the recorded context. This
// drops the session cookies into the context so the video opens directly on
// the dashboard — the viewer never sees the login form.
console.log('▸ pre-auth via API');
const loginResp = await fetch(BASE + '/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: USER, password: PASS }),
});
if (!loginResp.ok) throw new Error(`Pre-auth failed: ${loginResp.status}`);
const setCookies = loginResp.headers.getSetCookie?.() || loginResp.headers.raw?.()['set-cookie'] || [];
const url = new URL(BASE);
const cookies = setCookies.map(c => {
  const [pair, ...attrs] = c.split(';');
  const [name, value] = pair.split('=');
  const attrMap = Object.fromEntries(attrs.map(a => a.trim().split('=')).map(([k, v]) => [k.toLowerCase(), v ?? true]));
  return {
    name: name.trim(),
    value,
    domain: url.hostname,
    path: attrMap.path || '/',
    httpOnly: !!attrMap.httponly,
    secure: !!attrMap.secure,
    sameSite: 'Lax',
  };
});
await context.addCookies(cookies);

const page = await context.newPage();

// Helper: move cursor visibly to a target before any click or fill, so the
// viewer sees the cursor travel TO the element. Without this, clicks feel
// teleported because the cursor only updates on actual mouse-move events.
async function moveTo(locator, hover = 250) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) return;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 15 });
  await beat(hover);
}

// Slow type — visible typing animation rather than instant fill.
async function slowType(selector, text, perChar = 65) {
  const loc = page.locator(selector);
  await moveTo(loc, 150);
  await loc.click();
  await beat(150);
  await loc.fill(''); // clear first
  await page.keyboard.type(text, { delay: perChar });
  await beat(300);
}

try {
  // ===== 1. Open dashboard directly (we've already logged in via API) =====
  console.log('▸ open dashboard');
  await page.goto(BASE + DASHBOARD_PATH);
  await page.waitForLoadState('networkidle');
  await beat(4000); // long hold — first impression matters

  // ===== 2. Enter Edit Mode =====
  console.log('▸ edit mode');
  const editBtn = page.locator('[aria-label="Enter Edit Mode"]');
  await moveTo(editBtn);
  await editBtn.click();
  await beat(1500); // hold so viewer sees Editing chip appear

  // ===== 3. Drag (reorder within the first group) =====
  console.log('▸ drag tile');
  // Within-group reorder: drag the FIRST tile to a later position in the same
  // group. Both source and target are visible on screen at all times, and the
  // tile visibly moves across the row — clearly demonstrates drag-and-drop
  // without the cross-group scroll-conflict problem.
  await page.evaluate(() => window.scrollTo(0, 0));
  await beat(400);
  const firstGroupEntries = page.locator('.group').first().locator('.entry');
  const sourceTile = firstGroupEntries.first();
  const destTile = firstGroupEntries.nth(4); // 5th tile — visibly different position
  const from = await center(sourceTile);
  const to = await center(destTile);
  console.log(`  drag from (${Math.round(from.x)},${Math.round(from.y)}) to (${Math.round(to.x)},${Math.round(to.y)})`);
  await smoothDrag(page, from, to);
  await beat(2500); // hold so viewer sees the new order

  // ===== 4. Add Tile =====
  console.log('▸ add tile');
  const addTileBtn = page.locator('button:has-text("Add Tile")').first();
  await moveTo(addTileBtn);
  await addTileBtn.click();
  await page.waitForSelector('text=New Tile', { timeout: 5000 });
  await beat(1000);

  await slowType('input#name', 'Proxmox');
  await slowType('input#url', 'https://proxmox.example.com');

  // ===== 5. Browse icons + search =====
  console.log('▸ browse icons');
  const browseBtn = page.locator('button[title="Browse icon library"]');
  await moveTo(browseBtn);
  await browseBtn.click();
  await page.waitForSelector('text=Choose an Icon', { timeout: 5000 });
  await beat(1200);

  await slowType('input[placeholder*="Search"]', 'proxmox', 90); // slower for emphasis
  await beat(1500); // hold so filtered results register

  const firstIcon = page.locator('.icon-grid .icon-card').first();
  await moveTo(firstIcon);
  await firstIcon.click();
  await beat(1200);

  // ===== 6. Create the tile =====
  console.log('▸ create');
  const createBtn = page.locator('button:has-text("Create")').last();
  await moveTo(createBtn);
  await createBtn.click();
  await beat(1500); // brief hold while modal closes
  // Scroll to the newly-added tile (it lands at the end of the first group).
  // The new tile has name="Proxmox" — find the LAST entry in the page with
  // that name (the existing Proxmox tile is earlier).
  const newTile = page.locator('.entry:has-text("Proxmox")').last();
  await newTile.scrollIntoViewIfNeeded();
  await beat(3000); // hold on new tile so viewer sees the result

  // ===== 7. Exit edit mode =====
  console.log('▸ exit edit mode');
  const exitBtn = page.locator('[aria-label="Exit Edit Mode"]');
  await moveTo(exitBtn);
  await exitBtn.click();
  await beat(1200);

  // ===== 8. Switch tabs =====
  console.log('▸ switch tabs');
  const tabs = page.locator('[role="tab"]');
  if (await tabs.count() >= 2) {
    const tab2 = tabs.nth(1);
    await moveTo(tab2);
    await tab2.click();
    await beat(2500); // hold on second tab
    const tab1 = tabs.nth(0);
    await moveTo(tab1);
    await tab1.click();
    await beat(1500);
  }

  // (Mobile-view section removed — recording at 1280x720 but viewport at
  // 400px looks awkward with the right side empty. The static mobile.png
  // in the screenshots gallery already showcases responsive behaviour.)

  // ===== 9. Admin page + QR =====
  console.log('▸ qr code');
  const adminLink = page.locator('a.admin-link[aria-label="Admin Panel"]');
  await moveTo(adminLink);
  await adminLink.click();
  await page.waitForSelector('text=HOPS Admin Panel', { timeout: 5000 });
  await beat(1500);
  const qrBtn = page.locator('[aria-label^="Show QR code for"]').first();
  await moveTo(qrBtn);
  await qrBtn.click();
  await page.waitForSelector('text=QR Code', { timeout: 5000 });
  await beat(4500); // hold on QR for emphasis

  console.log('▸ done');
} catch (err) {
  console.error('Script error:', err.message);
  await page.screenshot({ path: path.join(OUTDIR, 'error.png') });
  throw err;
} finally {
  await page.close();
  await context.close(); // flushes video
  await browser.close();
}

// Rename the auto-named webm to demo.webm
const files = await fs.readdir(OUTDIR);
const webm = files.find(f => f.endsWith('.webm'));
if (webm) {
  const src = path.join(OUTDIR, webm);
  const dst = path.join(OUTDIR, 'demo.webm');
  await fs.rename(src, dst);
  const stats = await fs.stat(dst);
  console.log(`▸ saved ${dst} (${Math.round(stats.size / 1024)} KB)`);
}
