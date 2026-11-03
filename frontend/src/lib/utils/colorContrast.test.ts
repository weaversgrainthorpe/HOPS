import { describe, it, expect } from 'vitest';
import { autoTextFor, parseHex, textColourOn, MIN_TEXT_CONTRAST, contrastRatio } from './colorContrast';
import { deriveFolderColours } from '$lib/layout/folderColours';

// Item 16: ONE Auto text-colour rule everywhere: whichever of white or black contrasts more.
const TABLE: [string, '#ffffff' | '#000000'][] = [
  ['#3b82f6', '#000000'], // the blue in the report: black 5.7:1 beats white 3.7:1
  ['#ffffff', '#000000'],
  ['#000000', '#ffffff'],
  ['#0f172a', '#ffffff'],
  ['#1e293b', '#ffffff'],
  ['#f59e0b', '#000000'], // amber: the old luminance rule gave white (2.1:1)
  ['#ef4444', '#000000'],
  ['#22c55e', '#000000'],
  ['#6366f1', '#000000'], // indigo: black 4.7:1 beats white 4.5:1
  ['#8b5cf6', '#000000'],
  ['#64748b', '#ffffff'],
  ['#ec4899', '#000000'],
  ['#2563eb', '#ffffff'],
  ['#fff', '#000000'],
  ['#777777', '#000000']
];

describe('the one Auto text rule', () => {
  it.each(TABLE)('%s gives %s from every caller (tile and folder)', (colour, want) => {
    expect(autoTextFor(parseHex(colour)!)).toBe(want === '#ffffff' ? 'light' : 'dark');
    expect(textColourOn(colour, 'auto').text).toBe(want);
    expect(textColourOn(colour, undefined).text).toBe(want);
    expect(deriveFolderColours(colour, 'auto').text).toBe(want);
    expect(deriveFolderColours(colour).text).toBe(want);
  });

  it('Auto always reaches the readable minimum on the colour itself', () => {
    for (const [c] of TABLE) expect(textColourOn(c, 'auto').contrast).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
  });

  it('#3b82f6 gives black text for both a tile and a folder', () => {
    expect(textColourOn('#3b82f6', 'auto').text).toBe('#000000');
    expect(deriveFolderColours('#3b82f6', 'auto').text).toBe('#000000');
  });
});

describe('textColourOn (a tile)', () => {
  it('an explicit Light or Dark choice wins, and is warned about when hard to read', () => {
    const light = textColourOn('#3b82f6', 'light');
    expect(light.text).toBe('#ffffff');
    expect(light.contrastWarning).toBe(true);
    expect(light.contrast).toBeCloseTo(contrastRatio('#ffffff', '#3b82f6'), 5);
    const dark = textColourOn('#3b82f6', 'dark');
    expect(dark.text).toBe('#000000');
    expect(dark.contrastWarning).toBe(false);
  });

  it('Auto is never warned about', () => {
    for (const [c] of TABLE) expect(textColourOn(c, 'auto').contrastWarning).toBe(false);
  });

  it('no colour: the theme text, whatever the choice', () => {
    for (const m of ['auto', 'light', 'dark', undefined]) {
      expect(textColourOn(undefined, m)).toMatchObject({ text: 'inherit', themed: true, invalid: false, contrastWarning: false });
      expect(textColourOn('', m).text).toBe('inherit');
    }
  });

  it('a colour that cannot be read: the theme text, and says so', () => {
    for (const bad of ['not-a-color', '3b82f6', 'rgb(1,2,3)', '#12345']) {
      expect(textColourOn(bad, 'auto')).toMatchObject({ text: 'inherit', themed: true, invalid: true });
    }
  });
});

describe('parseHex', () => {
  it('reads #rgb and #rrggbb only (what CSS draws)', () => {
    expect(parseHex('#fff')).toEqual([255, 255, 255]);
    expect(parseHex('#3B82F6')).toEqual([59, 130, 246]);
    expect(parseHex('3b82f6')).toBeNull();
    expect(parseHex(42)).toBeNull();
  });
});
