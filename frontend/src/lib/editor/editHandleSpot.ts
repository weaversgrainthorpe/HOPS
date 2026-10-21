/**
 * Where a folder's edit handle sits (walkthrough §4B), so it never overlaps the handle of an item
 * inside it — on touch every handle is always shown, so stacking alone is not enough.
 *
 * - header: a titled folder puts it in its header, above its body (no inner item is under it).
 * - above / right: an untitled folder hangs it OUTSIDE its box (never over its content), on the
 *   side its enclosing folder's handle does not use: a parent whose handle is at its top (header
 *   or above) gets a child hanging out to the right, and vice versa.
 *
 * Tiles keep theirs in their own top-right corner, inside their box, so a folder's handle (in its
 * header or outside its box) never meets them.
 */
export type FolderHandleSpot = 'header' | 'above' | 'right';

/** `chain`: the folder's enclosing folders, outermost first, ending with the folder itself. */
export function folderHandleSpot(chain: { showTitle?: boolean }[]): FolderHandleSpot {
  let parent: FolderHandleSpot | null = null;
  for (const f of chain) {
    if (f.showTitle !== false) parent = 'header';
    else parent = parent === 'header' || parent === 'above' ? 'right' : 'above';
  }
  return parent ?? 'header';
}
