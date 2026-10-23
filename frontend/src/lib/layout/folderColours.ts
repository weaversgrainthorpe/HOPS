/**
 * A folder's colours (M6 §3.3, §3a.7, §3a.10). The folder's ONE stored colour drives its look: the back
 * panel and tab drawn darker, the front lighter, one gradient (front → the colour; Tenet 4: no filter
 * heavier than one gradient) and an outline. Text is contrast-safe: `auto` (or missing) picks light or
 * dark text that reaches MIN_TEXT_CONTRAST on BOTH panels; an explicit light/dark choice still wins,
 * and `contrastWarning` says when it fails, so edit mode can show it (never silently).
 *
 * The panels never depend on the text choice, so toggling light/dark never shifts the folder colour.
 * A folder with no colour uses the theme surface (CSS colours: no contrast is computed — the theme's
 * own text applies). A stored colour that can't be read draws as the theme too, but says so
 * (`invalid`), so the renderer can show a visible note.
 */

/** WCAG AA for normal text. */
export const MIN_TEXT_CONTRAST = 4.5;

const WHITE = '#ffffff';
const BLACK = '#000000';
const THEME = 'var(--bg-secondary)';

/** How far the back panel darkens, the front lightens and the outline darkens (share of black / white). */
const BACK_DARKEN = 0.18;
const FRONT_LIGHTEN = 0.14;
const OUTLINE_DARKEN = 0.4;

export interface FolderColours {
  /** The folder's colour (normalised #rrggbb), or the theme surface. */
  base: string;
  /** The back panel and the tab. */
  back: string;
  /** The front panel (the body; a background picture fills it, §3a.10). */
  front: string;
  /** The one gradient a look may use, front → base. */
  gradient: { from: string; to: string };
  /** The shape's edge (and the Outlined look's line). */
  outline: string;
  /** The text colour on the panels: #ffffff / #000000, or 'inherit' (theme). */
  text: string;
  /** The lowest contrast of `text` on the back and front panels (NaN when themed). */
  contrast: number;
  /** An explicit light/dark text choice fails MIN_TEXT_CONTRAST on a panel (§3a.7). */
  contrastWarning: boolean;
  /** No colour of its own (or an unreadable one): the theme's surface. */
  themed: boolean;
  /** A stored colour was given but could not be read. */
  invalid: boolean;
}

type Rgb = [number, number, number];

function parseHex(v: string): Rgb | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(c: Rgb): string {
  return '#' + c.map((x) => Math.round(Math.min(255, Math.max(0, x))).toString(16).padStart(2, '0')).join('');
}

/** `c` mixed with `to` by share `t` (0 = c, 1 = to), per sRGB channel. */
function mix(c: Rgb, to: Rgb, t: number): Rgb {
  return [0, 1, 2].map((i) => c[i] + (to[i] - c[i]) * t) as Rgb;
}

function luminance(c: Rgb): number {
  const [r, g, b] = c.map((x) => {
    const s = x / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a: Rgb, b: Rgb): number {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** The WCAG 2 contrast ratio of two #rgb / #rrggbb colours (1 when either can't be read). */
export function contrastRatio(a: string, b: string): number {
  const ca = parseHex(a), cb = parseHex(b);
  return ca && cb ? ratio(ca, cb) : 1;
}

/**
 * `base` moved toward `to` by up to `t`, but only as far as `text` keeps MIN_TEXT_CONTRAST on it (in
 * 1% steps, checked on the rounded colour that is drawn). `base` itself must already pass.
 */
function shadeKeeping(base: Rgb, to: Rgb, t: number, text: Rgb): string {
  for (let s = Math.round(t * 100); s > 0; s--) {
    const hex = toHex(mix(base, to, s / 100));
    if (ratio(parseHex(hex)!, text) >= MIN_TEXT_CONTRAST) return hex;
  }
  return toHex(base);
}

export function deriveFolderColours(color?: string | null, textColor?: 'auto' | 'light' | 'dark' | string): FolderColours {
  const given = typeof color === 'string' && color.trim() !== '';
  const rgb = given ? parseHex(color) : null;
  if (!rgb) {
    return {
      base: THEME,
      back: `color-mix(in srgb, ${THEME} ${100 - BACK_DARKEN * 100}%, ${BLACK})`,
      front: `color-mix(in srgb, ${THEME} ${100 - FRONT_LIGHTEN * 100}%, ${WHITE})`,
      gradient: { from: `color-mix(in srgb, ${THEME} ${100 - FRONT_LIGHTEN * 100}%, ${WHITE})`, to: THEME },
      outline: `color-mix(in srgb, ${THEME} ${100 - OUTLINE_DARKEN * 100}%, ${BLACK})`,
      text: 'inherit',
      contrast: NaN,
      contrastWarning: false,
      themed: true,
      invalid: given
    };
  }
  const white: Rgb = [255, 255, 255], black: Rgb = [0, 0, 0];
  // The auto text: whichever of white / black contrasts more with the colour (always >= 4.58:1). The
  // panels shade away from it only as far as it stays readable, so it passes on both (and on the
  // gradient between front and base, since luminance moves monotonically along it).
  const autoLight = ratio(rgb, white) >= ratio(rgb, black);
  const auto = autoLight ? white : black;
  const back = autoLight ? toHex(mix(rgb, black, BACK_DARKEN)) : shadeKeeping(rgb, black, BACK_DARKEN, auto);
  const front = autoLight ? shadeKeeping(rgb, white, FRONT_LIGHTEN, auto) : toHex(mix(rgb, white, FRONT_LIGHTEN));
  const base = toHex(rgb);
  const explicit = textColor === 'light' || textColor === 'dark';
  const text = explicit ? (textColor === 'light' ? WHITE : BLACK) : autoLight ? WHITE : BLACK;
  const t = parseHex(text)!;
  const contrast = Math.min(ratio(t, parseHex(back)!), ratio(t, parseHex(front)!));
  return {
    base, back, front,
    gradient: { from: front, to: base },
    outline: toHex(mix(rgb, black, OUTLINE_DARKEN)),
    text,
    contrast,
    contrastWarning: explicit && contrast < MIN_TEXT_CONTRAST,
    themed: false,
    invalid: false
  };
}
