import { describe, it, expect } from 'vitest';
import { importProblems } from './importResult';

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

  it('tolerates null/absent optional fields', () => {
    expect(importProblems({ success: true, message: 'ok', skipped: null })).toEqual([]);
  });
});
