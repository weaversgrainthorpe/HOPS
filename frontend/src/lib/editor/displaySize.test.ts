// On a tab an item shows its own size; inside a folder it shows the folder's contents size.
// Its own size is never changed by being in a folder.
import { describe, it, expect } from 'vitest';
import { displaySize, tileSizeOf } from './editorActions';
import type { FolderNode, LayoutNode } from '$lib/types/layout';

const tile = (size?: unknown): LayoutNode =>
  ({ kind: 'tile', id: 't', name: 't', url: 'http://x', ...(size === undefined ? {} : { size }) }) as unknown as LayoutNode;
const folder = (over: Partial<FolderNode> = {}): FolderNode =>
  ({ kind: 'folder', id: 'f', name: 'f', display: 'expanded', size: 'medium', contentSize: 'medium', content: { children: [] }, ...over }) as FolderNode;

describe('displaySize', () => {
  it('on the tab: the item\'s own size', () => {
    expect(displaySize(tile('large'), undefined)).toBe('large');
    expect(displaySize(tile('small'), undefined)).toBe('small');
    expect(displaySize(folder({ size: 'large' }), undefined)).toBe('large');
  });
  it('inside a folder: the folder\'s contents size, for tiles and sub-folders alike', () => {
    const parent = folder({ contentSize: 'small' });
    expect(displaySize(tile('large'), parent)).toBe('small');
    expect(displaySize(folder({ size: 'large' }), parent)).toBe('small');
    expect(displaySize(tile('small'), folder({ contentSize: 'large' }))).toBe('large');
  });
  it('a missing or unknown size is Medium', () => {
    expect(displaySize(tile(), undefined)).toBe('medium');
    expect(displaySize(tile('custom'), undefined)).toBe('medium');
    expect(displaySize(tile('large'), folder({ contentSize: undefined as never }))).toBe('medium');
  });
});

describe('tileSizeOf: the tile dialog shows Small, Medium or Large only (no "Custom")', () => {
  it('is the stored size, Medium when missing or unknown', () => {
    expect(tileSizeOf({ size: 'large' })).toBe('large');
    expect(tileSizeOf({ size: 'small' })).toBe('small');
    expect(tileSizeOf({})).toBe('medium');
    expect(tileSizeOf({ size: 'custom' as never })).toBe('medium');
  });
});
