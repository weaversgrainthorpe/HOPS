/**
 * The ONE text-colour rule for every tab, tile and folder (item 16). A coloured item's text is white or
 * black; "Auto" picks whichever of the two contrasts more with the item's colour (the most readable),
 * and an explicit Light or Dark choice wins but is warned about when it falls below
 * MIN_TEXT_CONTRAST. Every Auto text decision in the app goes through `autoTextFor` (tiles via
 * `textColourOn`, folders of every look via deriveFolderColours), so the same colour always gives the
 * same text colour. Coloured dashboard tabs use `textColourOn` too.
 */

/** A tile's or a folder's text colour choice. Missing = 'auto'. */
export type TextColorMode = 'auto' | 'light' | 'dark';

/** WCAG AA for normal text. */
export const MIN_TEXT_CONTRAST = 4.5;

export const TEXT_WHITE = '#ffffff';
export const TEXT_BLACK = '#000000';

export type Rgb = [number, number, number];

/**
 * The rgb part of a #rgb / #rgba / #rrggbb / #rrggbbaa colour (as CSS draws it), or null when it can't be
 * read. An alpha part is ignored: the item draws its colour exactly as stored, and the text is chosen on
 * its rgb (a Heimdall import can bring #rrggbbaa).
 */
export function parseHex(v: unknown): Rgb | null {
  if (typeof v !== 'string') return null;
  const m = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(v.trim());
  if (!m) return null;
  const h = m[1].length <= 4 ? [...m[1].slice(0, 3)].map((c) => c + c).join('') : m[1].slice(0, 6);
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** WCAG 2 relative luminance. */
export function luminance(c: Rgb): number {
  const [r, g, b] = c.map((x) => {
    const s = x / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The WCAG 2 contrast ratio of two colours. */
export function ratio(a: Rgb, b: Rgb): number {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** The WCAG 2 contrast ratio of two #rgb / #rrggbb colours (1 when either can't be read). */
export function contrastRatio(a: string, b: string): number {
  const ca = parseHex(a), cb = parseHex(b);
  return ca && cb ? ratio(ca, cb) : 1;
}

const WHITE_RGB: Rgb = [255, 255, 255];
const BLACK_RGB: Rgb = [0, 0, 0];

/**
 * THE Auto rule: light (white) or dark (black) text, whichever contrasts more with `c` (a tie goes to
 * white). Either way the text reaches at least 4.58:1.
 */
export function autoTextFor(c: Rgb): 'light' | 'dark' {
  return ratio(c, WHITE_RGB) >= ratio(c, BLACK_RGB) ? 'light' : 'dark';
}

export interface TextOn {
  /** '#ffffff' / '#000000', or 'inherit' (no colour of its own, or one that can't be read: the theme's text). */
  text: string;
  /** The contrast of `text` on the colour (NaN when themed). */
  contrast: number;
  /** An explicit Light or Dark choice falls below MIN_TEXT_CONTRAST on the colour. */
  contrastWarning: boolean;
  /** No colour of its own (or an unreadable one): the theme's surface and text. */
  themed: boolean;
  /** A colour was given but could not be read. */
  invalid: boolean;
}

/**
 * The text colour on a plain fill of `color` (a tile) under choice `mode`. A tile with no colour, or
 * one that can't be read, has the theme's surface, so its text is the theme's (never a guess); an
 * unreadable colour says so (`invalid`) so edit mode can show it.
 */
export function textColourOn(color: string | null | undefined, mode?: string | null): TextOn {
  const given = typeof color === 'string' && color.trim() !== '';
  const rgb = given ? parseHex(color) : null;
  if (!rgb) return { text: 'inherit', contrast: NaN, contrastWarning: false, themed: true, invalid: given };
  const explicit = mode === 'light' || mode === 'dark';
  const pick = explicit ? (mode as 'light' | 'dark') : autoTextFor(rgb);
  const text = pick === 'light' ? TEXT_WHITE : TEXT_BLACK;
  const contrast = ratio(pick === 'light' ? WHITE_RGB : BLACK_RGB, rgb);
  return { text, contrast, contrastWarning: explicit && contrast < MIN_TEXT_CONTRAST, themed: false, invalid: false };
}
