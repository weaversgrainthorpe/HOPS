import { test, expect, type Page, type BrowserContext, type Locator } from '@playwright/test';
import { getCsrfToken } from '../helpers';

// The folder dialog, in a
// REAL browser:
//  1. the look (picker + tab position) sits between Icon and the colour / Background;
//  2. every look preview sits on a light card and keeps >= 3:1 against it, for dark and light folders;
//  3. no text in the Edit Folder or Edit Tile dialog is below 4.5:1 (3:1 large), in the dark and light
//     theme — disabled buttons such as "Reset to inherit" included;
//  4. Look, Status checks, Background and Move or copy are separate sections: the status-check text
//     never sits against the Background button;
//  5. the folder background is pictures only; a stored colour background keeps rendering, is shown
//     as such, and "Use as folder colour" moves it to the folder colour (saved).

let seq = 0;
const made: string[] = [];
type Child = Record<string, unknown>;
const kid = (id: string, name: string, extra: Child = {}): Child => ({
  id, kind: 'tile', type: 'link', name, url: `https://${name.toLowerCase()}.example.lan/`, icon: 'mdi:lan',
  openMode: 'newtab', size: 'medium', order: 0, ...extra
});
const folder = (id: string, name: string, box: { x: number; y: number; w: number; h: number }, children: Child[], extra: Child = {}): Child => ({
  id, kind: 'folder', name, display: 'expanded', shape: 'folder-flat', size: 'medium', contentSize: 'medium',
  placement: box, content: { children }, ...extra
});

async function importDash(page: Page, context: BrowserContext, children: (id: (s: string) => string) => Child[]) {
  const p = `m6a${Date.now().toString(36)}${(seq++).toString(36)}`;
  const id = (s: string) => `${p}-${s}`;
  const dash = {
    id: id('dash'), name: `fixes A ${p}`, order: 0, path: `/${p}`, revision: 1,
    settings: {
      statusChecksEnabled: null, statusCheckIntervalMinutes: null, statusCheckTimeoutSeconds: null,
      editIdleTimeoutMinutes: null, animatedFolderBackgrounds: null
    },
    tabs: [{ id: id('tab'), name: 'Main', order: 0, root: { columns: 24, children: children(id) } }]
  };
  const doc = {
    format: 'hops-export', schemaVersion: 3, exportedAt: new Date().toISOString(), exportType: 'single-dashboard',
    config: { layoutVersion: 2, dashboards: [dash] }
  };
  const r = await page.request.post('/api/config/import', {
    headers: { 'X-CSRF-Token': await getCsrfToken(context) },
    multipart: { file: { name: 'm6a.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) } }
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

const node = (page: Page, id: string) => page.locator(`.tab-canvas [data-node-id="${id}"]`).first();
async function enterEdit(page: Page) {
  await page.locator('[aria-label="Enter Edit Mode"]').click();
  await expect(page.getByRole('toolbar', { name: 'Editing' })).toBeVisible();
}
async function saveDraft(page: Page) {
  const save = page.getByRole('toolbar', { name: 'Editing' }).getByRole('button', { name: /Save/ });
  await expect(save).toBeEnabled();
  const saved = page.waitForResponse((r) => r.request().method() === 'PUT' && /\/api\/dashboards\//.test(r.url()));
  await save.click();
  const r = await saved;
  expect(r.status(), await r.text()).toBe(200);
}
async function storedNode(page: Page, dashId: string, nodeId: string) {
  const cfg = await (await page.request.get('/api/config')).json();
  const d = cfg.dashboards.find((x: { id: string }) => x.id === dashId);
  return d.tabs[0].root.children.find((n: { id: string }) => n.id === nodeId);
}
async function openEdit(page: Page, id: string, name: 'Edit Folder' | 'Edit Tile') {
  await node(page, id).click({ button: 'right', position: { x: 12, y: 12 } });
  await page.getByRole('menuitem', { name: 'Edit' }).click();
  const dlg = page.getByRole('dialog', { name });
  await expect(dlg).toBeVisible();
  return dlg;
}
const boxOf = async (l: Locator) => {
  const b = await l.boundingBox();
  if (!b) throw new Error('no box');
  return b;
};

/**
 * Every visible piece of text in `root` whose contrast is below WCAG AA (4.5:1; 3:1 for large text),
 * computed from the rendered colours: the text colour (its alpha times every ancestor's opacity) over
 * the composited backgrounds behind it. Placeholders of empty fields are checked too.
 */
async function lowContrastText(root: Locator) {
  // Measured once the dialog's opening transition has finished (fully opaque).
  await expect
    .poll(() => root.evaluate((el) => {
      let o = 1;
      for (let e: Element | null = el; e; e = e.parentElement) o *= Number(getComputedStyle(e).opacity);
      return o;
    }))
    .toBe(1);
  return root.evaluate((rootEl) => {
    type C = [number, number, number, number];
    const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
    const parse = (css: string): C => {
      // The browser resolves any CSS colour (color-mix, oklab, named) to pixels for us.
      probe.clearRect(0, 0, 1, 1);
      probe.fillStyle = '#000';
      probe.fillStyle = css;
      probe.fillRect(0, 0, 1, 1);
      const d = probe.getImageData(0, 0, 1, 1).data;
      return [d[0], d[1], d[2], d[3] / 255];
    };
    const over = (top: C, under: C): C => {
      const a = top[3];
      return [0, 1, 2].map((i) => top[i] * a + under[i] * (1 - a)).concat(1) as C;
    };
    const lum = (c: C) => {
      const [r, g, b] = c.slice(0, 3).map((x) => {
        const s = x / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (a: C, b: C) => {
      const x = lum(a), y = lum(b);
      return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
    };
    /** The opaque colour behind `el` (its own background included), or null when a picture is behind it. */
    const backdrop = (el: Element): C | null => {
      const layers: C[] = [];
      for (let e: Element | null = el; e; e = e.parentElement) {
        const cs = getComputedStyle(e);
        if (cs.backgroundImage && cs.backgroundImage !== 'none') return null;
        const c = parse(cs.backgroundColor);
        if (c[3] > 0) layers.push(c);
        if (c[3] >= 1) break;
      }
      let out: C = [255, 255, 255, 1];
      for (let i = layers.length - 1; i >= 0; i--) out = over(layers[i], out);
      return out;
    };
    const fade = (el: Element) => {
      let o = 1;
      for (let e: Element | null = el; e && e !== document.body; e = e.parentElement) o *= Number(getComputedStyle(e).opacity);
      return o;
    };
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && !el.closest('[hidden]');
    };
    const large = (cs: CSSStyleDeclaration) => {
      const px = parseFloat(cs.fontSize);
      return px >= 24 || (px >= 18.66 && Number(cs.fontWeight) >= 700);
    };
    const bad: string[] = [];
    let checked = 0;
    const check = (el: Element, colour: string, what: string) => {
      const bg = backdrop(el);
      if (!bg) return;
      const cs = getComputedStyle(el);
      const fg = parse(colour);
      const shown = over([fg[0], fg[1], fg[2], fg[3] * fade(el)], bg);
      const r = ratio(shown, bg);
      checked++;
      const need = large(cs) ? 3 : 4.5;
      if (r < need - 0.005) bad.push(`${what} — ${r.toFixed(2)}:1 (needs ${need}) fg ${colour} on rgb(${bg.slice(0, 3).map(Math.round).join(',')})`);
    };
    for (const el of rootEl.querySelectorAll('*')) {
      if (!visible(el)) continue;
      // Visually-hidden controls (the look radios, the switch checkbox) carry no visible text.
      const own = Array.from(el.childNodes).filter((n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim()).map((n) => n.textContent!.trim()).join(' ');
      if (own) check(el, getComputedStyle(el).color, `"${own.slice(0, 50)}" <${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).split(' ')[0] : ''}>`);
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        if (el.type === 'text' || el.type === 'url' || el.type === 'number' || el.tagName === 'TEXTAREA') {
          if (el.value) check(el, getComputedStyle(el).color, `value of #${el.id || el.name}`);
          else if (el.placeholder) check(el, getComputedStyle(el, '::placeholder').color, `placeholder "${el.placeholder}"`);
        }
      }
      if (el instanceof HTMLSelectElement) check(el, getComputedStyle(el).color, `select #${el.id}`);
    }
    return { bad, checked };
  });
}

const fixture = (id: (s: string) => string) => [
  folder(id('f'), 'Services', { x: 0, y: 0, w: 12, h: 8 }, [kid(id('in1'), 'Inner')], { color: '#0f172a', statusChecksEnabled: null }),
  folder(id('w'), 'Pale', { x: 13, y: 0, w: 8, h: 8 }, [kid(id('in2'), 'Two')], { color: '#ffffff' }),
  kid(id('t'), 'Router', { placement: { x: 0, y: 9, w: 2, h: 2 } })
];

test.describe('the folder dialog order and sections', () => {
  test('the look sits between Icon and the colour and Background; each part is its own section', async ({ page, context }) => {
    const f = await importDash(page, context, fixture);
    await page.goto(f.path);
    await enterEdit(page);
    const dlg = await openEdit(page, f.id('f'), 'Edit Folder');
    const icon = dlg.getByRole('button', { name: /Edit icon/ });
    const look = dlg.getByRole('radiogroup', { name: 'Look' });
    const tabPos = dlg.getByRole('radiogroup', { name: 'Tab position' });
    const colour = dlg.getByText('Folder colour', { exact: true });
    const bgBtn = dlg.getByRole('button', { name: /^Background/ });
    // Measured in one scroll position (the dialog body scrolls), top to bottom.
    const ys: number[] = [];
    for (const l of [icon, look, tabPos, colour, bgBtn]) ys.push(await l.evaluate((e) => e.getBoundingClientRect().top));
    for (let i = 1; i < ys.length; i++) expect(ys[i], `order step ${i}`).toBeGreaterThan(ys[i - 1]);
    for (const h of ['Look', 'Colour', 'Background', 'Move or copy']) await expect(dlg.getByRole('heading', { name: h, level: 3 })).toBeVisible();

    // The status-check text and the Background button: separate sections, with clear space between.
    const status = dlg.locator('.status-checks .row-text');
    await bgBtn.scrollIntoViewIfNeeded();
    const s = await boxOf(status);
    const b = await boxOf(bgBtn);
    expect(b.y - (s.y + s.height), 'space between the status-check text and the Background button').toBeGreaterThanOrEqual(24);
    const heading = await boxOf(dlg.getByRole('heading', { name: 'Background', level: 3 }));
    expect(heading.y).toBeGreaterThan(s.y + s.height);
    expect(heading.y + heading.height).toBeLessThanOrEqual(b.y);
    const mv = await boxOf(dlg.getByRole('heading', { name: 'Move or copy', level: 3 }));
    expect(mv.y).toBeGreaterThan(b.y + b.height);
  });
});

test.describe('look previews on a light card', () => {
  for (const [which, id] of [['dark (#0f172a)', 'f'], ['white (#ffffff)', 'w']] as const) {
    test(`a ${which} folder: every preview is on a light card and keeps >= 3:1 against it`, async ({ page, context }) => {
      const f = await importDash(page, context, fixture);
      await page.goto(f.path);
      await enterEdit(page);
      const dlg = await openEdit(page, f.id(id), 'Edit Folder');
      const cards = dlg.locator('.shape-picker [data-preview-card]');
      await expect(cards).toHaveCount(7);
      await cards.first().scrollIntoViewIfNeeded();
      const boxes = [];
      for (let i = 0; i < 7; i++) boxes.push(await boxOf(cards.nth(i)));
      const png = await page.screenshot({ animations: 'disabled', caret: 'hide' });
      const result = await page.evaluate(
        async ({ b64, bxs }) => {
          const img = new Image();
          img.src = `data:image/png;base64,${b64}`;
          await img.decode();
          const c = document.createElement('canvas');
          c.width = img.naturalWidth;
          c.height = img.naturalHeight;
          const ctx = c.getContext('2d', { willReadFrequently: true })!;
          ctx.drawImage(img, 0, 0);
          const scale = img.naturalWidth / window.innerWidth;
          const lum = (r: number, g: number, b: number) =>
            [r, g, b].map((x) => { const s = x / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; })
              .reduce((acc, v, i) => acc + v * [0.2126, 0.7152, 0.0722][i], 0);
          return bxs.map((b) => {
            const x0 = Math.round(b.x * scale), y0 = Math.round(b.y * scale);
            const w = Math.round(b.width * scale), h = Math.round(b.height * scale);
            const d = ctx.getImageData(x0, y0, w, h).data;
            // The card's own colour: a pixel just inside its corner padding.
            const k = (Math.round(3 * scale) * w + Math.round(3 * scale)) * 4;
            const card = [d[k], d[k + 1], d[k + 2]];
            const lc = lum(card[0], card[1], card[2]);
            let best = 1;
            for (let i = 0; i < d.length; i += 4) {
              const l = lum(d[i], d[i + 1], d[i + 2]);
              best = Math.max(best, (Math.max(l, lc) + 0.05) / (Math.min(l, lc) + 0.05));
            }
            return { card, cardLum: lc, best };
          });
        },
        { b64: png.toString('base64'), bxs: boxes }
      );
      for (const [i, r] of result.entries()) {
        expect(r.cardLum, `preview ${i}: the card is light (${r.card})`).toBeGreaterThan(0.75);
        expect(r.best, `preview ${i}: the shape reaches 3:1 against its card`).toBeGreaterThanOrEqual(3);
      }
    });
  }
});

// The audit runs on EVERY theme preset, light and dark — the gradient
// presets (an accent that is a gradient, so never a text background) and the coloured dark ones
// (ocean, forest) included.
const PRESETS = ['default', 'metallic', 'modern', 'subtle', 'cyberpunk', 'sunset', 'ocean', 'forest'] as const;

/** The dialog's Save button: an opaque fill, and its label >= 4.5:1 on it. */
async function saveButtonContrast(dlg: Locator) {
  return dlg.locator('.modal-actions .btn-primary').first().evaluate((el) => {
    const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
    const px = (css: string) => {
      probe.clearRect(0, 0, 1, 1);
      probe.fillStyle = '#000';
      probe.fillStyle = css;
      probe.fillRect(0, 0, 1, 1);
      return Array.from(probe.getImageData(0, 0, 1, 1).data);
    };
    const lum = (c: number[]) => {
      const [r, g, b] = c.slice(0, 3).map((x) => {
        const s = x / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const cs = getComputedStyle(el);
    const bg = px(cs.backgroundColor), fg = px(cs.color);
    const x = lum(bg), y = lum(fg);
    return { alpha: bg[3], image: cs.backgroundImage, ratio: (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) };
  });
}

test.describe('text contrast in the Edit Folder and Edit Tile dialogs', () => {
  for (const preset of PRESETS) for (const theme of ['dark', 'light'] as const) {
    test(`${preset} preset, ${theme} theme: no text below 4.5:1 (disabled "Reset to inherit" included)`, async ({ page, context }) => {
      await page.addInitScript(([t, p]) => {
        localStorage.setItem('hops_theme', t);
        localStorage.setItem('hops_theme_preset', p);
      }, [theme, preset]);
      const f = await importDash(page, context, fixture);
      await page.goto(f.path);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await enterEdit(page);

      const folderDlg = await openEdit(page, f.id('f'), 'Edit Folder');
      // "Reset to inherit" is disabled while Inherit is chosen (the folder inherits): still readable.
      await expect(folderDlg.getByRole('button', { name: 'Reset to inherit' })).toBeDisabled();
      // A shape that warns: the contrast warning text is itself readable.
      await folderDlg.getByRole('radio', { name: 'Dark', exact: true }).check();
      await expect(folderDlg.locator('[data-contrast-warning]')).toBeVisible();
      const a = await lowContrastText(folderDlg);
      expect(a.checked, 'texts checked in Edit Folder').toBeGreaterThan(25);
      expect(a.bad, 'Edit Folder text below AA').toEqual([]);
      const save = await saveButtonContrast(folderDlg);
      expect(save.alpha, 'Edit Folder Save has an opaque fill').toBe(255);
      expect(save.image, 'Edit Folder Save is a solid fill').toBe('none');
      expect(save.ratio, 'Edit Folder Save label').toBeGreaterThanOrEqual(4.5);
      await folderDlg.getByRole('button', { name: 'Cancel' }).click();
      await expect(folderDlg).toHaveCount(0);

      const tileDlg = await openEdit(page, f.id('t'), 'Edit Tile');
      await expect(tileDlg.getByRole('button', { name: 'Reset to inherit' })).toBeVisible();
      const b = await lowContrastText(tileDlg);
      expect(b.checked, 'texts checked in Edit Tile').toBeGreaterThan(15);
      expect(b.bad, 'Edit Tile text below AA').toEqual([]);
      const tsave = await saveButtonContrast(tileDlg);
      expect(tsave.alpha, 'Edit Tile Save has an opaque fill').toBe(255);
      expect(tsave.ratio, 'Edit Tile Save label').toBeGreaterThanOrEqual(4.5);
    });
  }
});

test.describe('the folder background is pictures only', () => {
  test('the picker offers "No picture of its own" / "Its own picture" with Image and Slideshow only', async ({ page, context }) => {
    const f = await importDash(page, context, fixture);
    await page.goto(f.path);
    await enterEdit(page);
    const dlg = await openEdit(page, f.id('f'), 'Edit Folder');
    await expect(dlg.locator('.background-status')).toHaveText(/No picture of its own — shows what's behind/);
    await dlg.getByRole('button', { name: /^Background/ }).click();
    const picker = page.getByRole('dialog', { name: 'Folder background' });
    await expect(picker.getByRole('radio', { name: "No picture of its own — show what's behind" })).toBeChecked();
    await expect(picker.getByRole('radio', { name: /^Same as/ })).toHaveCount(0);
    await picker.getByRole('radio', { name: 'Its own picture' }).check();
    const types = picker.getByRole('group', { name: /Picture type/ }).getByRole('button');
    await expect(types).toHaveText(['Image', 'Slideshow']);
    await expect(picker.getByRole('button', { name: /^Color$/ })).toHaveCount(0);
    await expect(picker.getByRole('button', { name: /^None$/ })).toHaveCount(0);
    // Its own picture with nothing chosen: refused visibly.
    await picker.getByRole('button', { name: /^Save Background/ }).click();
    await expect(picker.getByRole('alert')).toContainText(/Choose an image/);
    await expect(picker).toBeVisible();
  });

  test('the tab picker keeps None, Color, Image and Slideshow', async ({ page, context }) => {
    const f = await importDash(page, context, fixture);
    await page.goto(f.path);
    await enterEdit(page);
    await page.getByRole('tab', { name: 'Switch to Main tab' }).dblclick();
    const tabDlg = page.getByRole('dialog', { name: 'Edit Tab' });
    await tabDlg.getByRole('button', { name: /Configure Tab Background/ }).click();
    const picker = page.getByRole('dialog', { name: 'Tab background' });
    await expect(picker.getByRole('group', { name: /Background Type/ }).getByRole('button')).toHaveText(['None', 'Color', 'Image', 'Slideshow']);
  });

  test('a stored colour background keeps rendering, is shown, and "Use as folder colour" saves it as the folder colour', async ({ page, context }) => {
    const f = await importDash(page, context, (id) => [
      folder(id('c'), 'Old', { x: 0, y: 0, w: 10, h: 8 }, [kid(id('ci'), 'Inside')], {
        shape: 'rounded', background: { type: 'color', value: '#c82828', opacity: 0.7 }
      }),
      kid(id('t'), 'Anchor', { placement: { x: 12, y: 0, w: 2, h: 2 } })
    ]);
    await page.goto(f.path);
    // Still drawn: the folder surface shows the stored colour.
    const surface = node(page, f.id('c')).locator('.folder-surface .background-root').first();
    await expect(surface).toHaveCount(1);
    await enterEdit(page);

    let dlg = await openEdit(page, f.id('c'), 'Edit Folder');
    await expect(dlg.getByText('Colour background #c82828 (set the folder colour instead)')).toBeVisible();
    // The picker shows it as its own choice, ticked; Cancel changes nothing.
    await dlg.getByRole('button', { name: /^Background/ }).click();
    const picker = page.getByRole('dialog', { name: 'Folder background' });
    await expect(picker.getByRole('radio', { name: 'Colour background (set the folder colour instead)' })).toBeChecked();
    await expect(picker.getByText(/#c82828/)).toBeVisible();
    await picker.getByRole('button', { name: 'Cancel' }).click();
    // Saving the dialog untouched keeps it exactly.
    await dlg.getByRole('textbox', { name: /Folder name/ }).fill('Old one');
    await dlg.getByRole('button', { name: /^Save/ }).click();
    await saveDraft(page);
    let stored = await storedNode(page, f.id('dash'), f.id('c'));
    expect(stored.name).toBe('Old one');
    expect(stored.background).toEqual({ type: 'color', value: '#c82828', opacity: 0.7 });

    // One click: the colour becomes the folder colour, the background goes, saved as one change.
    dlg = await openEdit(page, f.id('c'), 'Edit Folder');
    await dlg.getByRole('button', { name: 'Use as folder colour' }).click();
    await expect(dlg.getByRole('status').filter({ hasText: 'Folder colour set to #c82828 at 70% opacity' })).toBeVisible();
    await dlg.getByRole('button', { name: /^Save/ }).click();
    await saveDraft(page);
    stored = await storedNode(page, f.id('dash'), f.id('c'));
    expect(stored.color).toBe('#c82828');
    expect(stored.opacity).toBe(0.7);
    expect(stored).not.toHaveProperty('background');
    await expect(node(page, f.id('c')).locator('.folder-surface .background-root')).toHaveCount(0);
  });
});
