// HOPS demo video: a ~45 s walk through v3 on the shipped Sample, recorded as WebM.
// Run by run.sh against a throwaway instance:  node record.mjs <base-url> <out-dir>
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { signIn, beat, CURSOR_SCRIPT, pointer } from './lib.mjs';

const [BASE, OUTDIR] = process.argv.slice(2);
if (!BASE || !OUTDIR) { console.error('Usage: node record.mjs <base-url> <out-dir>'); process.exit(2); }
const VIEWPORT = { width: 1280, height: 720 };

await fs.rm(OUTDIR, { recursive: true, force: true });
await fs.mkdir(OUTDIR, { recursive: true });
const storageState = await signIn(BASE);

const browser = await chromium.launch({ headless: true, args: ['--hide-scrollbars'] });
const context = await browser.newContext({
  viewport: VIEWPORT, storageState, colorScheme: 'dark',
  recordVideo: { dir: OUTDIR, size: VIEWPORT }
});
await context.addInitScript(CURSOR_SCRIPT);
const page = await context.newPage();
const p = pointer(page);
const node = (id) => page.locator(`[data-node-id="${id}"]`).first();
const tileNamed = (name) => page.locator('[data-node-id]').filter({ has: page.getByText(name, { exact: true }) }).first();

try {
  // 1. The Sample: tabs, folders, a background.
  await page.goto(BASE + '/sample');
  await node('sample-ff').waitFor();
  await page.mouse.move(640, 360);
  await beat(2500);

  // 2. Into a folder within a folder, and back up.
  await p.click(node('sample-f-large-sub'), 400);
  await beat(1600);
  const up = page.locator('[data-crumb="sample-f-large"]').first();
  await p.click(up, 400);
  await beat(1200);

  // 3. Another tab: folder shapes.
  await p.click(page.getByRole('tab', { name: /Shapes/ }), 300);
  await beat(2200);
  await p.click(page.getByRole('tab', { name: /Home/ }), 300);
  await beat(900);

  // 4. Edit mode: drag one tile onto another to make a folder.
  await p.click(page.getByRole('button', { name: 'Enter Edit Mode' }), 300);
  await beat(1200);
  await p.drag(tileNamed('Backups'), tileNamed('Containers'), { settle: 900 });
  const folderDlg = page.getByRole('dialog');
  await folderDlg.locator('#folder-name').waitFor({ timeout: 8000 });
  await beat(500);
  await p.type(folderDlg.locator('#folder-name'), 'Servers');
  await beat(300);
  await p.click(folderDlg.getByRole('button', { name: /^Save/ }), 300);
  await folderDlg.waitFor({ state: 'detached' });
  await beat(1400);

  // 5. Add a tile: name, address, away address, icon.
  await p.click(page.getByRole('button', { name: 'Add tile' }), 300);
  const dlg = page.getByRole('dialog');
  await dlg.locator('input#name').waitFor();
  await beat(400);
  await p.type(dlg.locator('input#name'), 'NAS');
  await p.type(dlg.locator('input#url'), 'http://192.168.1.20:5000');
  await p.type(dlg.locator('input#away-url'), 'https://nas.example.lan');
  await beat(600);
  await p.click(dlg.getByRole('button', { name: 'Edit icon' }), 300);
  const iconDlg = page.getByRole('dialog', { name: 'Edit icon' });
  const iconName = iconDlg.locator('input').first();
  await iconName.waitFor();
  await p.type(iconName, 'nas', 120);
  const pick = iconDlg.getByText('mdi:nas', { exact: true });
  await pick.waitFor({ timeout: 5000 });
  await beat(900);
  await p.click(pick, 400);
  await beat(900);
  await p.click(iconDlg.getByRole('button', { name: 'Done' }), 300);
  await iconDlg.waitFor({ state: 'detached' });
  await beat(500);
  await p.click(dlg.getByRole('button', { name: /^(Create|Save)$/ }), 300);
  await beat(1500);

  // 6. Save the dashboard and leave edit mode.
  await p.click(page.getByRole('button', { name: 'Save', exact: true }), 400);
  await beat(1800);
  await p.click(page.getByRole('button', { name: 'Exit Edit Mode' }), 300);
  await beat(1200);

  // 7. Home / Away: the button appears once a tile has an away address.
  const away = page.getByRole('button', { name: /Switch to Away/ });
  await p.click(away, 500);
  await beat(1200);
  await p.moveTo(tileNamed('NAS'), 1200);

  // 8. Search finds a tile two folders deep.
  await p.click(page.getByRole('button', { name: 'Search' }), 300);
  await page.keyboard.type('audio', { delay: 110 });
  await beat(2500);
  await page.keyboard.press('Escape');
  await beat(1000);
} catch (e) {
  await page.screenshot({ path: path.join(OUTDIR, 'failed.png') });
  console.error('Recording failed (see failed.png):', e.message);
  await context.close();
  await browser.close();
  process.exit(1);
}

const video = page.video();
await context.close();
await browser.close();
await fs.rename(await video.path(), path.join(OUTDIR, 'demo.webm'));
console.log('▸ recorded', path.join(OUTDIR, 'demo.webm'));
