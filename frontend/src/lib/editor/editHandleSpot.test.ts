import { describe, it, expect } from 'vitest';
import { folderHandleSpot } from './editHandleSpot';

const titled = { showTitle: true };
const untitled = { showTitle: false };

describe('folderHandleSpot: where a folder puts its edit handle so it never overlaps an inner item\'s (§4B)', () => {
  it('a titled folder: in its header (above the body, so no inner item is under it)', () => {
    expect(folderHandleSpot([titled])).toBe('header');
    expect(folderHandleSpot([{}])).toBe('header'); // showTitle defaults to true
    expect(folderHandleSpot([untitled, titled])).toBe('header');
  });

  it('an untitled folder hangs its handle OUTSIDE its box (never over its content)', () => {
    expect(folderHandleSpot([untitled])).toBe('above');
  });

  it('nested: an untitled folder hangs out on the side its enclosing folder does not use', () => {
    // The parent's handle is at its top (header or above): hang out to the right instead.
    expect(folderHandleSpot([titled, untitled])).toBe('right');
    expect(folderHandleSpot([untitled, untitled])).toBe('right');
    // The parent's handle hangs out to the right: hang out above.
    expect(folderHandleSpot([titled, untitled, untitled])).toBe('above');
    expect(folderHandleSpot([untitled, untitled, untitled])).toBe('above');
  });
});
