// One folder colour drives the look — back panel (and tab) darker, front
// lighter, a gradient and an outline — with contrast-safe text, and a visible warning when an
// explicit light/dark text choice fails 4.5:1 on the panels it sits on.
import { describe, it, expect } from 'vitest';
import { deriveFolderColours, contrastRatio, MIN_TEXT_CONTRAST } from './folderColours';

const lum = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
};
const HEX = /^#[0-9a-f]{6}$/;

// A spread of real picker colours, dark through light, plus the hard middle greys.
const SAMPLES = [
  '#000000', '#ffffff', '#1e293b', '#0f172a', '#f8fafc', '#fde047', '#22c55e', '#3b82f6', '#ef4444',
  '#a855f7', '#f97316', '#14b8a6', '#777777', '#808080', '#888888', '#959595', '#6b7280', '#ec4899', '#84cc16'
];

describe('contrastRatio (WCAG 2)', () => {
  it('black on white is 21:1, a colour on itself 1:1', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#3b82f6', '#3b82f6')).toBeCloseTo(1, 5);
  });
  it('the floor is 4.5:1', () => {
    expect(MIN_TEXT_CONTRAST).toBe(4.5);
  });
});

describe('deriveFolderColours', () => {
  it('the back panel (and tab) is darker than the colour, the front lighter, the outline darkest', () => {
    for (const c of ['#3b82f6', '#22c55e', '#777777', '#ef4444']) {
      const f = deriveFolderColours(c, 'auto');
      expect(f.themed).toBe(false);
      for (const v of [f.back, f.front, f.outline, f.gradient.from, f.gradient.to]) expect(v).toMatch(HEX);
      expect(lum(f.back)).toBeLessThan(lum(c));
      expect(lum(f.front)).toBeGreaterThan(lum(c));
      expect(lum(f.outline)).toBeLessThan(lum(f.back));
      // The gradient runs front → the colour itself (one gradient, Tenet 4).
      expect(f.gradient).toEqual({ from: f.front, to: f.base });
    }
  });

  it('auto text is contrast-safe (>= 4.5:1) on the back AND the front, for dark and light colours alike', () => {
    for (const c of SAMPLES) {
      const f = deriveFolderColours(c, 'auto');
      expect(f.text === '#ffffff' || f.text === '#000000', c).toBe(true);
      expect(contrastRatio(f.text, f.back), `${c} back`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(f.text, f.front), `${c} front`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(f.text, f.gradient.to), `${c} gradient`).toBeGreaterThanOrEqual(4.5);
      expect(f.contrastWarning, c).toBe(false);
    }
  });

  it('a missing textColor is auto', () => {
    expect(deriveFolderColours('#1e293b')).toEqual(deriveFolderColours('#1e293b', 'auto'));
  });

  it('dark colour: auto picks light text; light colour: auto picks dark text', () => {
    expect(deriveFolderColours('#0f172a', 'auto').text).toBe('#ffffff');
    expect(deriveFolderColours('#fde047', 'auto').text).toBe('#000000');
  });

  it('an explicit choice still wins — and warns when it fails 4.5:1', () => {
    const lightOnYellow = deriveFolderColours('#fde047', 'light');
    expect(lightOnYellow.text).toBe('#ffffff');
    expect(lightOnYellow.contrastWarning).toBe(true);
    expect(lightOnYellow.contrast).toBeLessThan(4.5);

    const darkOnNavy = deriveFolderColours('#0f172a', 'dark');
    expect(darkOnNavy.text).toBe('#000000');
    expect(darkOnNavy.contrastWarning).toBe(true);

    const lightOnNavy = deriveFolderColours('#0f172a', 'light');
    expect(lightOnNavy.contrastWarning).toBe(false);
    expect(lightOnNavy.contrast).toBeGreaterThanOrEqual(4.5);

    const darkOnYellow = deriveFolderColours('#fde047', 'dark');
    expect(darkOnYellow.contrastWarning).toBe(false);
  });

  it('the panels do not depend on the text choice (toggling light/dark never shifts the folder colour)', () => {
    const a = deriveFolderColours('#3b82f6', 'auto');
    const l = deriveFolderColours('#3b82f6', 'light');
    const d = deriveFolderColours('#3b82f6', 'dark');
    for (const k of ['back', 'front', 'outline'] as const) {
      expect(l[k]).toBe(a[k]);
      expect(d[k]).toBe(a[k]);
    }
  });

  it('accepts #rgb and any case; the base is normalised', () => {
    expect(deriveFolderColours('#ABC').base).toBe('#aabbcc');
    expect(deriveFolderColours('#3B82F6').base).toBe('#3b82f6');
  });

  it('no colour: the theme surface (CSS colours), no computed contrast and no warning', () => {
    for (const c of [undefined, '']) {
      const f = deriveFolderColours(c, 'light');
      expect(f.themed).toBe(true);
      expect(f.invalid).toBe(false);
      expect(f.base).toBe('var(--bg-secondary)');
      expect(f.back).toContain('var(--bg-secondary)');
      expect(f.front).toContain('var(--bg-secondary)');
      expect(f.text).toBe('inherit');
      expect(f.contrastWarning).toBe(false);
    }
  });

  it('an unreadable colour is NOT silent: it draws as the theme and says so (invalid: true)', () => {
    for (const c of ['red', 'rgb(1,2,3)', '#12345', 'url(x)', '#zzzzzz']) {
      const f = deriveFolderColours(c, 'auto');
      expect(f.themed, c).toBe(true);
      expect(f.invalid, c).toBe(true);
      expect(f.base).toBe('var(--bg-secondary)');
    }
  });
});
