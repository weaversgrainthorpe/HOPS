// Settings polish: every Settings page and dialog is readable on EVERY theme preset × light/dark, and
// hover never restyles a disabled or non-interactive element.
// - Text >= 4.5:1 (large text >= 3:1); disabled controls' text >= 3:1; placeholders and field
//   borders >= 3:1 — each against what is really behind it (translucent layers composited).
// - Hovering a disabled button changes nothing: its computed colours, and those of the key chips
//   beside it, are identical before and after.
// One browser page; per page the theme is switched in place (the store's tokens on <html>, as
// applyThemePreset does), not by reloading.
import { test, expect, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createDashboardViaUI, deleteDashboardsNamed, uniqueName } from '../helpers';

const PRESETS = ['default', 'metallic', 'modern', 'subtle', 'cyberpunk', 'sunset', 'ocean', 'forest'];
const MODES = ['dark', 'light'] as const;

/** The presets' tokens, read from the theme store's own source (the same values it applies). */
function presetTokens(): Record<string, Record<string, Record<string, string>>> {
  const src = fs.readFileSync(path.resolve(process.cwd(), '../../frontend/src/lib/stores/theme.ts'), 'utf8');
  const grab = (name: string) => {
    const m = src.match(new RegExp(`const ${name}[^=]*=\\s*(\\{[\\s\\S]*?\\n\\});`));
    if (!m) throw new Error(`theme.ts: ${name} not found`);
    return Function(`return (${m[1]});`)();
  };
  const presets = grab('themePresets');
  const modeTokens = grab('modeTokens');
  const out: Record<string, Record<string, Record<string, string>>> = {};
  for (const id of PRESETS) {
    out[id] = {};
    for (const mode of MODES) {
      const c = presets[id][mode];
      out[id][mode] = {
        '--bg-primary': c.primary, '--bg-secondary': c.secondary, '--bg-tertiary': c.tertiary,
        '--accent': c.accent, '--accent-hover': c.accentHover, '--accent-solid': c.accentSolid,
        '--accent-solid-hover': c.accentSolidHover,
        '--text-secondary': c.textSecondary ?? (mode === 'dark' ? '#dbe4f0' : '#334155'),
        ...modeTokens[mode]
      };
      if (presets[id].gradient) out[id][mode]['data-gradient'] = '1';
    }
  }
  return out;
}

async function applyTheme(page: Page, mode: string, tokens: Record<string, string>) {
  await page.evaluate(([m, t]) => {
    const root = document.documentElement;
    root.setAttribute('data-theme', m);
    root.removeAttribute('style');
    for (const [k, v] of Object.entries(t)) if (k.startsWith('--')) root.style.setProperty(k, v);
    if (t['data-gradient']) root.setAttribute('data-gradient-theme', 'true');
    else root.removeAttribute('data-gradient-theme');
  }, [mode, tokens] as const);
}

type Finding = { ratio: number; min: number; what: string };

/** Measures every visible text, field border and placeholder under `scope`. */
async function audit(page: Page, scope: string): Promise<Finding[]> {
  return page.evaluate((sel) => {
    const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
    const rgba = (css: string): number[] => {
      probe.clearRect(0, 0, 1, 1);
      probe.fillStyle = 'rgba(0,0,0,0)';
      probe.fillStyle = css;
      probe.fillRect(0, 0, 1, 1);
      const d = Array.from(probe.getImageData(0, 0, 1, 1).data);
      return d[3] === 0 ? [0, 0, 0, 0] : [d[0], d[1], d[2], d[3] / 255];
    };
    const over = (t: number[], u: number[]) => [0, 1, 2].map((i) => t[i] * t[3] + u[i] * (1 - t[3])).concat(1);
    /** The opaque colour behind `start` (its own background included); null over a gradient/image. */
    const behind = (start: Element | null): number[] | null => {
      const layers: number[][] = [];
      for (let e = start; e; e = e.parentElement) {
        const cs = getComputedStyle(e);
        if (cs.backgroundImage !== 'none') return null;
        const c = rgba(cs.backgroundColor);
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
    const ratio = (fgCss: string, bg: number[], alpha: number) => {
      const f = rgba(fgCss);
      const fg = over([f[0], f[1], f[2], f[3] * alpha], bg);
      const x = lum(fg), y = lum(bg);
      return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
    };
    const opacityOf = (el: Element) => {
      let o = 1;
      for (let e: Element | null = el; e; e = e.parentElement) o *= Number(getComputedStyle(e).opacity);
      return o;
    };
    const name = (el: Element) => {
      const t = (el.textContent || (el as HTMLInputElement).placeholder || '').trim().slice(0, 40);
      return `<${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : ''}> "${t}"`;
    };
    const out: { ratio: number; min: number; what: string }[] = [];
    const root = document.querySelector(sel);
    if (!root) return [{ ratio: 0, min: 1, what: `scope ${sel} not found` }];
    for (const el of Array.from(root.querySelectorAll('*'))) {
      if (el.closest('svg, option, [aria-hidden="true"], .visually-hidden, .sr-only')) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility !== 'visible' || !(el as HTMLElement).checkVisibility?.({ opacityProperty: true })) continue;
      const alpha = opacityOf(el);
      if (alpha < 0.05) continue;
      const disabled = !!el.closest(':disabled, [aria-disabled="true"]');
      const hasText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent!.trim() !== '');
      const isField = el.matches('input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]):not([type=file]):not([type=hidden]), textarea, select');
      if (hasText || (isField && (el as HTMLInputElement).value)) {
        const bg = behind(el);
        if (bg) {
          const px = parseFloat(cs.fontSize);
          const large = px >= 24 || (px >= 18.66 && Number(cs.fontWeight) >= 700);
          const min = disabled || large ? 3 : 4.5;
          out.push({ ratio: ratio(cs.color, bg, alpha), min, what: `${disabled ? 'disabled ' : ''}text ${name(el)} ${cs.color}` });
        }
      }
      if (isField && !disabled) {
        const outside = behind(el.parentElement);
        if (outside && cs.borderTopStyle !== 'none' && parseFloat(cs.borderTopWidth) > 0) {
          out.push({ ratio: ratio(cs.borderTopColor, outside, alpha), min: 3, what: `field border ${name(el)} ${cs.borderTopColor}` });
        }
        const ph = (el as HTMLInputElement).placeholder;
        const inside = behind(el);
        if (ph && inside) {
          const p = getComputedStyle(el, '::placeholder');
          out.push({ ratio: ratio(p.color, inside, alpha * Number(p.opacity || '1')), min: 3, what: `placeholder ${name(el)} ${p.color}` });
        }
      }
    }
    return out;
  }, scope);
}

const LOOK = ['color', 'backgroundColor', 'borderTopColor', 'opacity', 'boxShadow', 'filter', 'outlineColor'] as const;

/** Hovers each disabled button (up to 4) in `scope`; nothing it or its row's key chips show may change. */
async function hoverDisabledChangesNothing(page: Page, scope: string, where: string) {
  const buttons = page.locator(`${scope} button:disabled`);
  const n = Math.min(await buttons.count(), 4);
  for (let i = 0; i < n; i++) {
    const b = buttons.nth(i);
    if (!(await b.isVisible())) continue;
    const snap = () => b.evaluate((el, keys) => {
      const row = el.closest('.row') ?? el.parentElement!;
      const pick = (e: Element) => Object.fromEntries(keys.map((k) => [k, getComputedStyle(e)[k as keyof CSSStyleDeclaration] as string]));
      return { button: pick(el), chips: Array.from(row.querySelectorAll('code')).map(pick) };
    }, [...LOOK]);
    await page.mouse.move(1, 1);
    await page.waitForTimeout(260); // past any transition
    const before = await snap();
    await b.hover({ force: true });
    await page.waitForTimeout(260);
    const after = await snap();
    expect.soft(after, `${where}: hovering disabled button #${i} changed its look`).toEqual(before);
  }
  await page.mouse.move(1, 1);
}

const made: string[] = [];
test.afterAll(async ({ browser }) => {
  if (!made.length) return;
  const context = await browser.newContext({ storageState: 'auth.json' });
  const page = await context.newPage();
  await deleteDashboardsNamed(page, made);
  await context.close();
});

test('every Settings page and dialog is readable on every preset × mode; hover leaves disabled controls alone', async ({ page }) => {
  test.setTimeout(300_000);
  await page.route(/api\.iconify\.design|api\.simplesvg\.com|api\.unisvg\.com/, (route) => route.abort());
  // Discovery pages show their scan badges and "Create detector" rows only when there is scan data,
  // which otherwise depends on what earlier tests left behind. Supply it, so every run checks them.
  const now = new Date().toISOString();
  await page.route((u) => u.pathname === '/api/discovery/scans', (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({ json: { scans: [
          { id: 'scan-c', createdAt: now, cidr: '192.0.2.0/28', intensity: 'light', state: 'complete', progressTotal: 16, progressDone: 16, finishedAt: now },
          { id: 'scan-f', createdAt: now, cidr: '192.0.2.16/28', intensity: 'light', state: 'failed', progressTotal: 16, progressDone: 3, errorMessage: 'synthetic failure' }
        ] } })
      : route.fallback());
  await page.route((u) => u.pathname === '/api/discovery/diagnostics', (route) =>
    route.fulfill({ json: {
      unidentified: [{ id: 'r1', scanId: 'scan-c', host: '192.0.2.5', port: 8080, detectorId: 'generic/http', confidence: 'low',
        category: 'other', suggestedName: 'Web service on 192.0.2.5', suggestedUrl: 'http://192.0.2.5:8080', curateState: 'pending', createdAt: now }],
      summary: [{ detectorId: 'core/pihole', count: 2, distinctHosts: 1, lastSeen: now }]
    } }));
  const tokens = presetTokens();
  const findings: Finding[] = [];

  async function sweep(where: string, scope = 'body') {
    await page.mouse.move(1, 1);
    for (const mode of MODES) {
      for (const preset of PRESETS) {
        await applyTheme(page, mode, tokens[preset][mode]);
        for (const f of await audit(page, scope)) {
          findings.push({ ...f, what: `${where} ${mode}/${preset}: ${f.what}` });
        }
      }
      await applyTheme(page, mode, tokens.default[mode]);
      await hoverDisabledChangesNothing(page, scope, `${where} ${mode}`);
    }
  }

  // Colours are read the instant a theme is applied: no transition may be mid-way.
  const noMotion = () => page.addStyleTag({ content: '*,*::before,*::after{transition:none!important;animation:none!important}' });

  async function visit(url: string, heading: string | RegExp) {
    await page.goto(url);
    await noMotion();
    await expect(page.getByRole('heading', { name: heading, level: 2 }).first()).toBeVisible();
    await page.waitForTimeout(400);
  }

  await visit('/settings/dashboards', 'Dashboards');
  await sweep('Dashboards');
  await visit('/settings/icons', /Icons/);
  await expect(page.getByRole('heading', { name: 'Packaged icons', level: 3 })).toBeVisible();
  await sweep('Icons');
  await visit('/settings/global', 'Global settings');
  await expect(page.locator('section.group').first()).toBeVisible();
  await sweep('Global settings');
  await visit('/settings/discovery', /Discovery/);
  await sweep('Discovery scan');
  await visit('/settings/discovery/new', /Discovery/);
  await sweep('Discovery new scan');
  await visit('/settings/discovery/diagnostics', /Discovery|Diagnostics/);
  await expect(page.getByRole('button', { name: /Create detector/ }).first()).toBeVisible();
  await sweep('Discovery diagnostics');
  await visit('/settings/discovery/detectors', /Discovery|detectors/i);
  await sweep('Discovery detectors');
  await visit('/settings/backups', /Backups/);
  await sweep('Backups');
  await expect(page.locator('#backups .backup-item').first()).toBeVisible();
  await sweep('Backups list', '#backups');
  await visit('/settings/logs', /Logs/);
  await sweep('Logs');
  await visit('/settings/password', /Password/);
  await sweep('Password');
  await visit('/settings/reset', /reset/i);
  await sweep('Factory reset');

  // The tile dialog, and its SSH form.
  await createDashboardViaUI(page, uniqueName('Contrast'), undefined, made);
  await noMotion();
  await page.getByRole('toolbar', { name: 'Editing' }).getByRole('button', { name: 'Add tile' }).click();
  const dlg = page.getByRole('dialog', { name: 'New Tile' });
  await expect(dlg).toBeVisible();
  await sweep('Tile dialog', '[role="dialog"]');
  await dlg.locator('#entry-type').selectOption('ssh');
  await expect(dlg.locator('#ssh-port')).toBeVisible();
  await sweep('SSH dialog', '[role="dialog"]');

  const failed = findings.filter((f) => f.ratio < f.min).sort((a, b) => a.ratio - b.ratio);
  const worst = [...findings].sort((a, b) => a.ratio / a.min - b.ratio / b.min).slice(0, 3);
  console.log(`[settings-contrast] ${findings.length} checks; worst: ${worst.map((w) => `${w.ratio.toFixed(2)} (min ${w.min}) ${w.what}`).join(' | ')}`);
  // Unique by element + theme-independent description, so one bad token reads as one line per place.
  const lines = [...new Set(failed.map((f) => `${f.ratio.toFixed(2)}<${f.min} ${f.what}`))];
  expect(lines.slice(0, 60), `${failed.length} contrast failures`).toEqual([]);
});
