import { describe, it, expect } from 'vitest';
import { importProblems, initialChoices, choicesReady, allSkipped, summaryLines, type ImportPreviewRow } from './importResult';

describe('importProblems', () => {
  it('is empty for a clean import', () => {
    expect(importProblems({ success: true, message: 'Imported 1', assetsFailed: [] })).toEqual([]);
  });

  it('lists failed assets, skipped icon matching, skipped items and a failed backup', () => {
    const p = importProblems({
      success: true,
      message: 'Imported 1',
      assetsFailed: ['/icons/a.png: bad base64', '/icons/b.png: empty'],
      iconMatchError: 'no such table: icons',
      skipped: ['dashboards[2] is not an object'],
      warning: 'Pre-update backup failed: disk full. Config saved anyway.'
    });
    expect(p).toHaveLength(4);
    expect(p[0]).toMatch(/2 asset\(s\) could not be restored.*a\.png.*b\.png/);
    expect(p[1]).toMatch(/Icon auto-matching was skipped: no such table: icons/);
    expect(p[2]).toMatch(/Skipped 1 item\(s\): dashboards\[2\]/);
    expect(p[3]).toBe('Pre-update backup failed: disk full. Config saved anyway.');
  });

  it('lists every folder enlarged on import', () => {
    const line = 'Folder "Media" was smaller than it can be drawn (2×4); it was enlarged to 3×6 (dashboard "Home")';
    expect(importProblems({ success: true, message: 'ok', foldersEnlarged: [line] })).toEqual([line]);
  });

  it('lists what another dashboard\'s file had that could not be carried over', () => {
    const line = '2 icon(s) couldn\'t be carried over (Font Awesome, …): Radarr, Router';
    expect(importProblems({ success: true, message: 'ok', notCarried: [line] })).toEqual([line]);
  });

  it('tolerates null/absent optional fields', () => {
    expect(importProblems({ success: true, message: 'ok', skipped: null })).toEqual([]);
  });
});

describe('import choices', () => {
  const rows: ImportPreviewRow[] = [
    { index: 0, name: 'Home', path: '/home', tabs: 2, clash: { id: 'd1', name: 'Home', path: '/home' } },
    { index: 1, name: 'Garage', path: '/garage', tabs: 1, clash: null }
  ];

  it('starts with Add for a new dashboard and no choice for a clash', () => {
    expect(initialChoices(rows)).toEqual([null, 'add']);
  });

  it('is ready only when every clash has a choice', () => {
    expect(choicesReady(rows, [null, 'add'])).toBe(false);
    expect(choicesReady(rows, ['keep', 'add'])).toBe(true);
    expect(choicesReady([], [])).toBe(false);
  });

  it('is not ready when every dashboard is skipped, and says so', () => {
    expect(choicesReady(rows, ['skip', 'skip'])).toBe(false);
    expect(allSkipped(['skip', 'skip'])).toBe(true);
    expect(allSkipped(['skip', 'add'])).toBe(false);
    expect(allSkipped([null, 'skip'])).toBe(false); // a choice still to make is not "nothing"
  });

  it('turns the summary into lines the admin reads', () => {
    expect(
      summaryLines({
        added: ['Garage'],
        replaced: ['Home'],
        renamed: [{ from: 'Office', to: 'Office (2)' }],
        skipped: ['Shed', 'Loft']
      })
    ).toEqual(['Added: Garage', 'Replaced: Home', 'Kept both: Office, the new one is "Office (2)"', 'Skipped: Shed, Loft']);
    expect(summaryLines({ added: [], replaced: [], renamed: [], skipped: [] })).toEqual([]);
  });
});
