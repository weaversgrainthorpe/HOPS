import { describe, it, expect } from 'vitest';
import cases from '../../../../backend/internal/configdoc/testdata/folder_min_cases.json';
import { folderMinCells, largestContentSize, minOpenFolderCells } from './geometry';
import type { FolderNode } from '$lib/types/layout';

// THE open-folder minimum table, shared with the Go twin (configdoc.FolderMinCells,
// LargestContentSize, FolderMinCellsOf) — Ruling 9. Conventions:
// backend/internal/configdoc/testdata/folder_min_cases.README.md.
describe('folder minimum (shared Go/TS cases)', () => {
  it('has cases', () => {
    expect(cases.minOpen.length).toBeGreaterThan(0);
    expect(cases.folders.length).toBeGreaterThan(0);
  });
  for (const c of cases.minOpen) {
    it(`minOpenFolderCells(${String(c.contentSize)})`, () => {
      expect(minOpenFolderCells(c.contentSize)).toEqual(c.want);
    });
  }
  for (const c of cases.folders) {
    it(c.name, () => {
      const f = c.folder as unknown as FolderNode;
      expect(largestContentSize(f)).toBe(c.largest);
      expect(folderMinCells(f)).toEqual(c.min);
    });
  }
});
