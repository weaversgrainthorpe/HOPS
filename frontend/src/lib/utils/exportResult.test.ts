import { describe, it, expect, vi, afterEach } from 'vitest';
import { missingAssetsFromHeader, missingAssetsWarning, MISSING_ASSETS_HEADER, IMPORT_WARNING_HEADER, importWarningFromHeader } from './exportResult';
import { exportConfig } from './api';

const header = (list: unknown) => encodeURIComponent(JSON.stringify(list));

describe('an export that left pictures out says so', () => {
  it('no header: nothing missing, no warning', () => {
    expect(missingAssetsFromHeader(null)).toEqual([]);
    expect(missingAssetsWarning([])).toBeNull();
  });

  it('names each picture and why', () => {
    const missing = missingAssetsFromHeader(header([
      { path: '/icons/a b.png', reason: 'the file is missing from the data folder' },
      { path: '/backgrounds/x.jpg', reason: 'could not be read' }
    ]));
    expect(missingAssetsWarning(missing)).toBe(
      "Exported, but 2 pictures couldn't be read and are not in the file: /icons/a b.png (the file is missing from the data folder); /backgrounds/x.jpg (could not be read)."
    );
    expect(missingAssetsWarning(missing.slice(0, 1))).toMatch(/^Exported, but 1 picture couldn't be read and is not in the file/);
  });

  it('an unreadable header is a warning too, never "nothing missing"', () => {
    expect(missingAssetsWarning(missingAssetsFromHeader('%E0%A4%A'))).toMatch(/couldn't be read/);
  });
});

describe('exportConfig reads the missing-pictures header', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns the file and what it left out', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', {
      status: 200,
      headers: { [MISSING_ASSETS_HEADER]: header([{ path: '/icons/gone.png', reason: 'could not be read' }]) }
    })));
    const { blob, missing } = await exportConfig('json');
    expect(await blob.text()).toBe('{}');
    expect(missing).toEqual([{ path: '/icons/gone.png', reason: 'could not be read' }]);
  });

  it('returns why the file could not be imported back, or null when it can', async () => {
    const why = 'This export is 60 MB, bigger than the largest file HOPS imports (50 MB). Use Settings › Backups.';
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200, headers: { [IMPORT_WARNING_HEADER]: encodeURIComponent(why) } })));
    expect((await exportConfig('json')).importWarning).toBe(why);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    expect((await exportConfig('json')).importWarning).toBeNull();
  });

  it('a garbled import warning still warns', () => {
    expect(importWarningFromHeader('%E0%A4%A')).toMatch(/may not be able to import this file back/);
  });
});
