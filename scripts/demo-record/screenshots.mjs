// README / Pages screenshots of the shipped Sample, from a throwaway instance.
// Run by run.sh:  node screenshots.mjs <base-url> <out-dir>
// Nothing here starts a discovery scan: the instance never probes the network.
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { signIn, beat } from './lib.mjs';

const [RAW_BASE, OUT] = process.argv.slice(2);
if (!RAW_BASE || !OUT) { console.error('Usage: node screenshots.mjs <base-url> <out-dir>'); process.exit(2); }
// Shown in the QR dialog: a friendly example name, mapped to the throwaway instance.
const BASE = RAW_BASE.replace('127.0.0.1', 'hops.example.lan');
await fs.mkdir(OUT, { recursive: true });
const storageState = await signIn(BASE, ['--host-resolver-rules=MAP hops.example.lan 127.0.0.1']);
const browser = await chromium.launch({ headless: true, args: ['--hide-scrollbars', '--host-resolver-rules=MAP hops.example.lan 127.0.0.1'] });

async function shoot(name, { width = 1600, height = 900, mobile = false } = {}, act) {
  const context = await browser.newContext({
    viewport: { width, height }, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile,
    storageState, colorScheme: 'dark'
  });
  const page = await context.newPage();
  try {
    const target = await act(page);
    await beat(900);
    const file = path.join(OUT, name);
    if (target) await target.screenshot({ path: file });
    else await page.screenshot({ path: file });
    console.log('▸', name);
  } catch (e) {
    await page.screenshot({ path: path.join(OUT, `failed-${name}`) });
    throw new Error(`${name}: ${e.message}`);
  } finally {
    await context.close();
  }
}

const sample = async (page, tab) => {
  await page.goto(BASE + '/sample');
  await page.locator('[data-node-id="sample-ff"]').first().waitFor();
  if (tab) {
    await page.getByRole('tab', { name: new RegExp(tab) }).click();
    await beat(600);
  }
};

try {
  await shoot('dashboard-hero.png', { width: 1920, height: 1080 }, (page) => sample(page));
  await shoot('folders.png', {}, (page) => sample(page, 'Shapes'));
  await shoot('edit-mode.png', {}, async (page) => {
    await sample(page, 'Folders');
    await page.getByRole('button', { name: 'Enter Edit Mode' }).click();
    await beat(800);
    await page.locator('[data-node-id="sample-mf"]').first().click({ position: { x: 40, y: 12 } });
    await page.locator('[data-node-id="sample-mg"]').first().click({ position: { x: 40, y: 12 }, modifiers: ['Control'] });
  });
  await shoot('edit-tile.png', { width: 1280, height: 1000 }, async (page) => {
    await sample(page);
    await page.getByRole('button', { name: 'Enter Edit Mode' }).click();
    await beat(600);
    await page.getByRole('button', { name: 'Add tile' }).click();
    const dlg = page.getByRole('dialog');
    await dlg.locator('input#name').fill('NAS');
    await dlg.locator('input#description').fill('Files and photos').catch(() => {});
    await dlg.locator('input#url').fill('http://192.168.1.20:5000');
    await dlg.locator('input#away-url').fill('https://nas.example.lan');
    return dlg.locator('.modal, [class*="modal"]').first().or(dlg).first();
  });
  await shoot('icon-picker.png', { width: 1280, height: 900 }, async (page) => {
    await sample(page);
    await page.getByRole('button', { name: 'Enter Edit Mode' }).click();
    await beat(600);
    await page.getByRole('button', { name: 'Add tile' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Edit icon' }).click();
    await page.getByRole('button', { name: /Browse/ }).click();
    await beat(800);
    const search = page.getByRole('dialog').last().getByRole('textbox').first();
    await search.fill('server');
    await beat(1200);
  });
  await shoot('mobile.png', { width: 390, height: 844, mobile: true }, (page) => sample(page));
  await shoot('settings.png', { width: 1440, height: 900 }, async (page) => {
    await page.goto(BASE + '/settings/dashboards');
    await page.getByRole('heading', { name: 'Dashboards', level: 2 }).waitFor();
  });
  await shoot('qr.png', { width: 1280, height: 900 }, async (page) => {
    await page.goto(BASE + '/settings/dashboards');
    await page.getByRole('button', { name: 'Show QR code for Sample', exact: true }).click();
    await page.getByRole('dialog', { name: 'QR Code' }).waitFor();
  });
  await shoot('discovery.png', { width: 1440, height: 900 }, async (page) => {
    await page.goto(BASE + '/settings/discovery/new');
    await page.getByRole('heading').first().waitFor();
    await beat(800);
    // The form pre-fills the network this machine is on: never publish that. Swap in an example.
    const chips = page.locator('button[aria-label^="Remove"]');
    while (await chips.count()) await chips.first().click();
    const field = page.getByPlaceholder(/CIDR, range, or IP/);
    await field.fill('192.168.1.0/24');
    await field.press('Enter');
    await beat(500);
    const left = await page.locator('button[aria-label^="Remove"]').evaluateAll((bs) => bs.map((b) => b.getAttribute('aria-label')));
    if (left.join() !== 'Remove 192.168.1.0/24') throw new Error('unexpected scan targets on the page: ' + left.join());
  });
} finally {
  await browser.close();
}
