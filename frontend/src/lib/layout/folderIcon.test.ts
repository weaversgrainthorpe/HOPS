import { describe, it, expect } from 'vitest';
import { minimisedShowsOwnIcon } from './folderIcon';
import type { FolderNode } from '$lib/types/layout';

const f = (o: Partial<FolderNode>) => o as FolderNode;

describe('minimisedShowsOwnIcon', () => {
  it('is true for own with an icon', () => {
    expect(minimisedShowsOwnIcon(f({ minimisedIcon: 'own', icon: 'mdi:home' }))).toBe(true);
  });
  it('is true for own with an uploaded icon', () => {
    expect(minimisedShowsOwnIcon(f({ minimisedIcon: 'own', iconUrl: '/icons/a.png' }))).toBe(true);
  });
  it('is false for own with no icon', () => {
    expect(minimisedShowsOwnIcon(f({ minimisedIcon: 'own' }))).toBe(false);
  });
  it('is false when absent', () => {
    expect(minimisedShowsOwnIcon(f({ icon: 'mdi:home' }))).toBe(false);
  });
  it('is false for contents', () => {
    expect(minimisedShowsOwnIcon(f({ minimisedIcon: 'contents', icon: 'mdi:home' }))).toBe(false);
  });
});
