// Shared by record.mjs and screenshots.mjs. Both run against the throwaway
// instance run.sh starts (fresh data dir, shipped Sample only).
import { chromium } from 'playwright';

// The throwaway instance's own password: it exists only for one run.
const INITIAL = 'admin';
const DEMO = 'Demo-only-pass-1!';

/** Sign in (setting a new password on first run) and return the session as a storage state. */
export async function signIn(base, args = []) {
  const browser = await chromium.launch({ headless: true, args });
  const page = await browser.newPage();
  await page.goto(base + '/settings');
  const dlg = page.getByRole('dialog', { name: 'Sign in' });
  await dlg.waitFor({ timeout: 15_000 });
  await dlg.getByLabel('Username').fill('admin');
  const first = !(await signInWith(page, dlg, DEMO));
  if (first) {
    await signInWith(page, dlg, INITIAL, true);
    await page.getByRole('heading', { name: 'Set a New Password' }).waitFor({ timeout: 10_000 });
    await page.fill('input#current-password', INITIAL);
    await page.fill('input#new-password', DEMO);
    await page.fill('input#confirm-password', DEMO);
    await page.click('button:has-text("Set Password")');
    await page.waitForURL(/\/settings\/dashboards$/, { timeout: 15_000 });
  }
  await page.waitForTimeout(800);
  const state = await page.context().storageState();
  await browser.close();
  return state;
}

async function signInWith(page, dlg, password, must = false) {
  await dlg.getByLabel('Password').fill(password);
  await dlg.getByLabel('Password').press('Enter');
  try {
    await dlg.waitFor({ state: 'detached', timeout: 4_000 });
    return true;
  } catch (e) {
    if (must) throw new Error('Could not sign in to the throwaway instance');
    return false;
  }
}

export const beat = (ms) => new Promise((r) => setTimeout(r, ms));

/** A visible pointer for recordings: headless Chromium draws none. */
export const CURSOR_SCRIPT = () => {
  const install = () => {
    if (document.getElementById('__hops_demo_cursor__')) return;
    const c = document.createElement('div');
    c.id = '__hops_demo_cursor__';
    c.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M2 2 L2 18 L7 13 L10 20 L13 19 L10 12 L17 12 Z" fill="white" stroke="black" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
    Object.assign(c.style, {
      position: 'fixed', left: '0px', top: '0px', pointerEvents: 'none', zIndex: '2147483647',
      transition: 'transform 80ms linear', transform: 'translate(-100px, -100px)', willChange: 'transform',
      filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.5))'
    });
    document.body.appendChild(c);
    window.addEventListener('mousemove', (e) => { c.style.transform = `translate(${e.clientX - 2}px, ${e.clientY - 2}px)`; }, { capture: true });
    window.addEventListener('mousedown', () => { c.style.filter = 'drop-shadow(0 0 6px rgba(80,160,255,0.9))'; }, { capture: true });
    window.addEventListener('mouseup', () => { c.style.filter = 'drop-shadow(0 1px 2px rgba(0,0,0,0.5))'; }, { capture: true });
  };
  if (document.body) install();
  else document.addEventListener('DOMContentLoaded', install);
};

/** Pointer helpers bound to a page: the viewer sees the pointer travel, never teleport. */
export function pointer(page) {
  async function centre(loc) {
    await loc.scrollIntoViewIfNeeded();
    const b = await loc.boundingBox();
    if (!b) throw new Error('no box for ' + loc);
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }
  async function moveTo(loc, hold = 250) {
    const c = await centre(loc);
    await page.mouse.move(c.x, c.y, { steps: 18 });
    await beat(hold);
    return c;
  }
  async function click(loc, hold = 250) {
    await moveTo(loc, hold);
    await loc.click();
  }
  async function type(loc, text, perChar = 60) {
    await click(loc, 150);
    await loc.fill('');
    for (const ch of text) {
      await page.keyboard.type(ch);
      await beat(perChar);
    }
  }
  async function drag(from, to, { steps = 50, stepDelay = 20, settle = 600 } = {}) {
    const a = await centre(from);
    const b = await centre(to);
    await page.mouse.move(a.x, a.y, { steps: 15 });
    await beat(200);
    await page.mouse.down();
    await beat(250);
    await page.mouse.move(a.x + 8, a.y + 8, { steps: 4 });
    for (let i = 1; i <= steps; i++) {
      await page.mouse.move(a.x + ((b.x - a.x) * i) / steps, a.y + ((b.y - a.y) * i) / steps);
      await beat(stepDelay);
    }
    await beat(settle);
    await page.mouse.up();
  }
  return { centre, moveTo, click, type, drag };
}
