// Walkthrough bug: "Contrast on Image URL in Background" (seen in the FOLDER background dialog, preset
// "Default (Classic blue)", dark mode). The background section is one shared component, so its URL
// fields must be readable on EVERY theme preset × light/dark, and look IDENTICAL wherever the section
// is used (the dashboard, tab and folder levels): no host may restyle them.
// - Text (the label, the typed value, the error) >= 4.5:1; the placeholder and the input's border >= 3:1.
// - The Image URL field's computed colours are the same at all three levels, per theme.
// - "Add Custom Image URL" (a slideshow) is held to the same bar.
import { test, expect, type Page, type BrowserContext, type Locator } from '@playwright/test';
import { getCsrfToken } from '../helpers';

const PRESETS = ['default', 'metallic', 'modern', 'subtle', 'cyberpunk', 'sunset', 'ocean', 'forest'];
const LEVELS = ['dashboard', 'tab', 'folder'] as const;
type Level = (typeof LEVELS)[number];

let seq = 0;
const made: string[] = [];
const IMG = { type: 'image', value: '/presets/network-grid.jpg' };

async function importDash(page: Page, context: BrowserContext) {
  const p = `m6url${Date.now().toString(36)}${(seq++).toString(36)}`;
  const id = (s: string) => `${p}-${s}`;
  const dash = {
    id: id('dash'), name: `M6 url ${p}`, order: 0, path: `/${p}`, revision: 1,
    settings: {
      statusChecksEnabled: null, statusCheckIntervalMinutes: null, statusCheckTimeoutSeconds: null,
      editIdleTimeoutMinutes: null, animatedFolderBackgrounds: null
    },
    background: { ...IMG },
    tabs: [{
      id: id('tab'), name: 'Main', order: 0, background: { ...IMG },
      root: {
        columns: 24,
        children: [{
          id: id('f'), kind: 'folder', name: 'Pics', display: 'expanded', shape: 'rounded', size: 'medium', contentSize: 'medium',
          placement: { x: 0, y: 0, w: 10, h: 8 }, background: { ...IMG },
          content: { children: [{ id: id('k'), kind: 'tile', type: 'link', name: 'Inside', url: 'https://inside.example.lan/', icon: 'mdi:lan', openMode: 'newtab', size: 'medium', order: 0 }] }
        }]
      }
    }]
  };
  const doc = {
    format: 'hops-export', schemaVersion: 3, exportedAt: new Date().toISOString(), exportType: 'single-dashboard',
    config: { layoutVersion: 2, dashboards: [dash] }
  };
  const r = await page.request.post('/api/config/import', {
    headers: { 'X-CSRF-Token': await getCsrfToken(context) },
    multipart: { file: { name: 'm6url.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) } }
  });
  expect(r.status(), await r.text()).toBe(200);
  made.push(id('dash'));
  return { path: `/${p}`, id };
}

test.afterEach(async ({ page, context }) => {
  while (made.length) {
    const id = made.pop()!;
    const cfg = await (await page.request.get('/api/config')).json();
    const rev = cfg.dashboards.find((d: { id: string }) => d.id === id)?.revision;
    expect(typeof rev, `cleanup: dashboard ${id} has a revision`).toBe('number');
    const r = await page.request.delete(`/api/dashboards/${encodeURIComponent(id)}?revision=${rev}`, {
      headers: { 'X-CSRF-Token': await getCsrfToken(context) }
    });
    expect(r.ok(), `cleanup: delete dashboard ${id}: ${r.status()} ${await r.text()}`).toBeTruthy();
  }
});

async function usePreset(page: Page, mode: string, preset: string) {
  await page.addInitScript(([t, p]) => {
    localStorage.setItem('hops_theme', t);
    localStorage.setItem('hops_theme_preset', p);
  }, [mode, preset]);
}

/** Open the background section at a level; returns its scope. */
async function openLevel(page: Page, level: Level, folderId: string): Promise<Locator> {
  if (level === 'dashboard') {
    await page.getByRole('button', { name: 'Edit Dashboard' }).click();
    const dlg = page.getByRole('dialog', { name: 'Edit Dashboard' });
    await dlg.getByRole('tab', { name: 'Background' }).click();
    return dlg.getByRole('tabpanel', { name: 'Background' });
  }
  if (level === 'tab') {
    await page.getByRole('tab', { name: 'Switch to Main tab' }).dblclick();
    await page.getByRole('dialog', { name: 'Edit Tab' }).getByRole('button', { name: /Configure Tab Background/ }).click();
    return page.getByRole('dialog', { name: 'Tab background' });
  }
  await page.locator(`.tab-canvas [data-node-id="${folderId}"]`).first().click({ button: 'right', position: { x: 12, y: 12 } });
  await page.getByRole('menuitem', { name: 'Edit' }).click();
  const dlg = page.getByRole('dialog', { name: 'Edit Folder' });
  await expect(dlg).toBeVisible();
  await dlg.getByRole('button', { name: /^Background/ }).click();
  return page.getByRole('dialog', { name: 'Folder background' });
}

type Part = { ratio: number; fg: string; bg: string };
type FieldLook = { value: Part; placeholder: Part; border: Part; label: Part; colours: Record<string, string> };

/**
 * The field's text, placeholder and border against what is really behind each (every translucent
 * layer composited down to the first opaque one), plus its raw computed colours.
 */
async function look(input: Locator, label: Locator): Promise<FieldLook> {
  const inputH = await input.elementHandle();
  const labelH = await label.elementHandle();
  return input.page().evaluate(([el, lab]) => {
    const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
    const rgba = (css: string): number[] => {
      probe.clearRect(0, 0, 1, 1);
      // Read the colour itself (alpha kept) by painting it on a cleared pixel.
      probe.fillStyle = 'rgba(0,0,0,0)';
      probe.fillStyle = css;
      probe.fillRect(0, 0, 1, 1);
      const d = Array.from(probe.getImageData(0, 0, 1, 1).data);
      if (d[3] === 0) return [0, 0, 0, 0];
      // Un-premultiplied by getImageData; alpha 0..1.
      return [d[0], d[1], d[2], d[3] / 255];
    };
    const over = (top: number[], under: number[]) => {
      const a = top[3];
      return [0, 1, 2].map((i) => top[i] * a + under[i] * (1 - a)).concat(1);
    };
    /** The opaque colour behind (and including) `start`'s own background. */
    const behind = (start: Element | null): number[] => {
      const layers: number[][] = [];
      for (let e = start; e; e = e.parentElement) {
        const c = rgba(getComputedStyle(e).backgroundColor);
        if (c[3] > 0) layers.push(c);
        if (c[3] >= 1) break;
      }
      let acc = [255, 255, 255, 1];
      if (layers.length && layers[layers.length - 1][3] >= 1) acc = layers.pop()!;
      for (let i = layers.length - 1; i >= 0; i--) acc = over(layers[i], acc);
      return acc;
    };
    const lum = (c: number[]) => {
      const [r, g, b] = c.slice(0, 3).map((x) => {
        const s = x / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const part = (fgCss: string, bg: number[], extraAlpha = 1) => {
      const f = rgba(fgCss);
      const fg = over([f[0], f[1], f[2], f[3] * extraAlpha], bg);
      const x = lum(fg), y = lum(bg);
      return { ratio: (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05), fg: fgCss, bg: `rgb(${bg.slice(0, 3).map(Math.round)})` };
    };
    const input = el as HTMLInputElement;
    const cs = getComputedStyle(input);
    const ph = getComputedStyle(input, '::placeholder');
    const inside = behind(input);
    const outside = behind(input.parentElement);
    const labelEl = lab as HTMLElement;
    return {
      value: part(cs.color, inside),
      placeholder: part(ph.color, inside, Number(ph.opacity || '1')),
      border: part(cs.borderTopColor, outside),
      label: part(getComputedStyle(labelEl).color, behind(labelEl)),
      colours: {
        color: cs.color, background: `rgb(${inside.slice(0, 3).map(Math.round)})`, border: cs.borderTopColor,
        placeholder: ph.color, label: getComputedStyle(labelEl).color
      }
    };
  }, [inputH, labelH] as const);
}

/** The error text against what is behind it. */
async function errorLook(err: Locator): Promise<Part> {
  return err.evaluate((el) => {
    const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
    const rgba = (css: string) => {
      probe.clearRect(0, 0, 1, 1);
      probe.fillStyle = 'rgba(0,0,0,0)';
      probe.fillStyle = css;
      probe.fillRect(0, 0, 1, 1);
      const d = Array.from(probe.getImageData(0, 0, 1, 1).data);
      return [d[0], d[1], d[2], d[3] / 255];
    };
    const over = (t: number[], u: number[]) => [0, 1, 2].map((i) => t[i] * t[3] + u[i] * (1 - t[3])).concat(1);
    const layers: number[][] = [];
    for (let e: Element | null = el; e; e = e.parentElement) {
      const c = rgba(getComputedStyle(e).backgroundColor);
      if (c[3] > 0) layers.push(c);
      if (c[3] >= 1) break;
    }
    let bg = [255, 255, 255, 1];
    if (layers.length && layers[layers.length - 1][3] >= 1) bg = layers.pop()!;
    for (let i = layers.length - 1; i >= 0; i--) bg = over(layers[i], bg);
    const fg = over(rgba(getComputedStyle(el).color), bg);
    const lum = (c: number[]) => {
      const [r, g, b] = c.slice(0, 3).map((x) => {
        const s = x / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const x = lum(fg), y = lum(bg);
    return { ratio: (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05), fg: getComputedStyle(el).color, bg: `rgb(${bg.slice(0, 3).map(Math.round)})` };
  });
}

function expectReadable(where: string, l: FieldLook, worst: { r: number; at: string }[]) {
  for (const [k, min] of [['value', 4.5], ['label', 4.5], ['placeholder', 3], ['border', 3]] as const) {
    const p = l[k];
    worst.push({ r: p.ratio, at: `${where} ${k}: ${p.fg} on ${p.bg}` });
    expect.soft(p.ratio, `${where}: ${k} ${p.fg} on ${p.bg} (${p.ratio.toFixed(2)}:1)`).toBeGreaterThanOrEqual(min);
  }
}

for (const mode of ['dark', 'light'] as const) {
  test(`${mode}: the Image URL field is readable and identical at the dashboard, tab and folder levels on every preset`, async ({ page, context }) => {
    test.setTimeout(180_000);
    const d = await importDash(page, context);
    const worst: { r: number; at: string }[] = [];
    for (const preset of PRESETS) {
      await usePreset(page, mode, preset);
      const looks: Partial<Record<Level, FieldLook>> = {};
      for (const level of LEVELS) {
        await page.goto(d.path);
        await expect(page.locator('html')).toHaveAttribute('data-theme', mode);
        await page.locator('[aria-label="Enter Edit Mode"]').click();
        await expect(page.getByRole('toolbar', { name: 'Editing' })).toBeVisible();
        const scope = await openLevel(page, level, d.id('f'));
        const input = scope.locator('#imageUrl');
        await expect(input).toBeVisible();
        await page.mouse.move(2, 2); // nothing hovered or focused: the resting look
        const where = `${mode}/${preset}/${level}`;
        const l = await look(input, scope.locator('label[for="imageUrl"]'));
        // The placeholder shows only when empty: measure it then (the field's colours are unchanged).
        await input.fill('');
        await page.locator('body').evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        const empty = await look(input, scope.locator('label[for="imageUrl"]'));
        l.placeholder = empty.placeholder;
        expectReadable(where, l, worst);
        looks[level] = l;
        // The error text, for a URL that can't be used.
        await input.fill('ftp://example.com/x.jpg');
        const err = scope.locator('#imageUrl-error');
        await expect(err).toBeVisible();
        await page.locator('body').evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        const e = await errorLook(err);
        worst.push({ r: e.ratio, at: `${where} error: ${e.fg} on ${e.bg}` });
        expect.soft(e.ratio, `${where}: error ${e.fg} on ${e.bg} (${e.ratio.toFixed(2)}:1)`).toBeGreaterThanOrEqual(4.5);
      }
      // One shared section: it looks the same wherever it is used.
      expect.soft(looks.tab!.colours, `${mode}/${preset}: tab level looks like the dashboard level`).toEqual(looks.dashboard!.colours);
      expect.soft(looks.folder!.colours, `${mode}/${preset}: folder level looks like the dashboard level`).toEqual(looks.dashboard!.colours);
    }
    worst.sort((a, b) => a.r - b.r);
    console.log(`[url-contrast] ${mode} worst: ${worst.slice(0, 3).map((w) => `${w.r.toFixed(2)} ${w.at}`).join(' | ')}`);
  });

  test(`${mode}: "Add Custom Image URL" is readable on every preset (folder level)`, async ({ page, context }) => {
    test.setTimeout(120_000);
    const d = await importDash(page, context);
    const worst: { r: number; at: string }[] = [];
    for (const preset of PRESETS) {
      await usePreset(page, mode, preset);
      await page.goto(d.path);
      await expect(page.locator('html')).toHaveAttribute('data-theme', mode);
      await page.locator('[aria-label="Enter Edit Mode"]').click();
      const scope = await openLevel(page, 'folder', d.id('f'));
      await scope.getByRole('button', { name: /Slideshow/ }).click();
      const input = scope.locator('#custom-image-url');
      await expect(input).toBeVisible();
      await page.mouse.move(2, 2);
      const l = await look(input, scope.locator('label[for="custom-image-url"]'));
      expectReadable(`${mode}/${preset}/custom`, l, worst);
      await input.fill('ftp://example.com/x.jpg');
      await scope.getByRole('button', { name: 'Add', exact: true }).click();
      const err = scope.locator('#custom-image-url-error');
      await expect(err).toBeVisible();
      const e = await errorLook(err);
      worst.push({ r: e.ratio, at: `${mode}/${preset}/custom error: ${e.fg} on ${e.bg}` });
      expect.soft(e.ratio, `${mode}/${preset}: custom error ${e.fg} on ${e.bg}`).toBeGreaterThanOrEqual(4.5);
    }
    worst.sort((a, b) => a.r - b.r);
    console.log(`[url-contrast] ${mode} custom worst: ${worst.slice(0, 3).map((w) => `${w.r.toFixed(2)} ${w.at}`).join(' | ')}`);
  });
}

test('a host that re-scopes theme tokens around the section does not change its fields', async ({ page, context }) => {
  const d = await importDash(page, context);
  await usePreset(page, 'dark', 'default');
  await page.goto(d.path);
  await page.locator('[aria-label="Enter Edit Mode"]').click();
  const scope = await openLevel(page, 'folder', d.id('f'));
  const input = scope.locator('#imageUrl');
  await expect(input).toBeVisible();
  const label = scope.locator('label[for="imageUrl"]');
  const before = (await look(input, label)).colours;
  // A host overriding the theme tokens on an ancestor of the section (the dialog itself).
  await scope.evaluate((el) => {
    for (const [k, v] of [['--bg-primary', '#ff00ff'], ['--bg-tertiary', '#00ff00'], ['--text-primary', '#777777'],
      ['--text-secondary', '#888888'], ['--border', '#00ffff'], ['--color-error-text', '#ff0000']]) (el as HTMLElement).style.setProperty(k, v);
  });
  const after = (await look(input, label)).colours;
  expect({ color: after.color, border: after.border, placeholder: after.placeholder }).toEqual(
    { color: before.color, border: before.border, placeholder: before.placeholder });
  expect(await input.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe('rgb(255, 0, 255)');
});
