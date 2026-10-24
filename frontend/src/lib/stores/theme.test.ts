// M6 batch-review I1/I2 (rulings 1 and 2): every theme preset, in light AND dark, carries solid colour
// tokens that pass WCAG contrast — so no button, link, error or status dot is wired to the default
// preset's colours or to a gradient that cannot be a text background.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { THEME_PRESET_IDS, themeTokens } from './theme';

const hex = (h: string) => {
  expect(h, `${h} is a #rrggbb colour`).toMatch(/^#[0-9a-f]{6}$/i);
  return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
};
const lum = (h: string) => {
  const [r, g, b] = hex(h).map((x) => {
    const s = x / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: string, b: string) => {
  const x = lum(a), y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

const modes = ['light', 'dark'] as const;

describe('theme tokens: every preset × light/dark', () => {
  it('covers all eight presets', () => {
    expect([...THEME_PRESET_IDS].sort()).toEqual(
      ['cyberpunk', 'default', 'forest', 'metallic', 'modern', 'ocean', 'subtle', 'sunset']
    );
  });

  for (const id of THEME_PRESET_IDS) {
    for (const mode of modes) {
      describe(`${id} / ${mode}`, () => {
        const t = themeTokens(id, mode)!;
        const page = t['--bg-primary'];
        const surface = t['--bg-secondary'];

        it('--on-accent on --accent-solid (and its hover) is >= 4.5:1', () => {
          expect(ratio(t['--on-accent'], t['--accent-solid'])).toBeGreaterThanOrEqual(4.5);
          expect(ratio(t['--on-accent'], t['--accent-solid-hover'])).toBeGreaterThanOrEqual(4.5);
        });

        it('--accent-solid is >= 3:1 against the page and the surface (navbar, dialogs)', () => {
          expect(ratio(t['--accent-solid'], page)).toBeGreaterThanOrEqual(3);
          expect(ratio(t['--accent-solid'], surface)).toBeGreaterThanOrEqual(3);
        });

        it('accent and error text are >= 4.5:1 on the page and the surface', () => {
          for (const k of ['--accent-text', '--color-error-text']) {
            expect(ratio(t[k], page), `${k} on page`).toBeGreaterThanOrEqual(4.5);
            expect(ratio(t[k], surface), `${k} on surface`).toBeGreaterThanOrEqual(4.5);
          }
        });

        it('the status dot fills are >= 3:1 against the navbar, and the glyph >= 3:1 on them', () => {
          for (const k of ['--status-online', '--status-degraded', '--status-offline', '--status-checking']) {
            expect(ratio(t[k], surface), `${k} on navbar`).toBeGreaterThanOrEqual(3);
            expect(ratio(t['--status-glyph'], t[k]), `glyph on ${k}`).toBeGreaterThanOrEqual(3);
          }
        });
      });
    }
  }
});

// The tokens are the only way white-ish text meets the accent: a guard against the patterns the
// review found (colour-mix of a possibly-gradient accent, hard-coded light text colours, white on
// the raw accent).
const SRC = resolve(process.cwd(), 'src');
function styled(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== 'test') out.push(...styled(p));
    } else if (/\.(svelte|css)$/.test(name)) out.push(p);
  }
  return out;
}

describe('no colour wired to one preset', () => {
  const files = styled(SRC).map((f) => ({ f: f.slice(SRC.length + 1), text: readFileSync(f, 'utf8') }));

  it('nothing colour-mixes var(--accent) (it is a gradient on three presets)', () => {
    const hits = files.filter(({ text }) => /color-mix\([^;]*var\(--accent(-hover)?\)/.test(text)).map(({ f }) => f);
    expect(hits).toEqual([]);
  });

  it('no fixed #93c5fd / #fca5a5 text colours', () => {
    const hits = files.filter(({ text }) => /color:\s*#(93c5fd|fca5a5)/i.test(text)).map(({ f }) => f);
    expect(hits).toEqual([]);
  });

  it('no rule puts white text on the raw accent', () => {
    const hits: string[] = [];
    for (const { f, text } of files) {
      for (const block of text.match(/\{[^{}]*\}/g) ?? []) {
        const accentFill = /background(-color)?:\s*var\(--accent(-hover)?\)/.test(block);
        const white = /(^|[\s;{])color:\s*(white|#fff\b|#ffffff)/i.test(block);
        if (accentFill && white) hits.push(`${f}: ${block.replace(/\s+/g, ' ').slice(0, 80)}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it('the bare button and .btn-primary use the solid accent tokens', () => {
    const app = readFileSync(join(SRC, 'app.css'), 'utf8');
    const bare = app.match(/\nbutton \{[^}]*\}/)![0];
    expect(bare).toContain('background: var(--accent-solid)');
    expect(bare).toContain('color: var(--on-accent)');
    for (const src of [app, readFileSync(join(SRC, 'lib/components/shared/Button.svelte'), 'utf8')]) {
      const primary = src.match(/\.btn-primary \{[^}]*\}/)![0];
      expect(primary).toContain('var(--accent-solid)');
      expect(primary).toContain('var(--on-accent)');
    }
  });
});
