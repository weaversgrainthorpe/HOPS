/**
 * The M5 folder drop and dwell targets (spec §3.4, §3a.4), pure: no DOM, no stores. The drag
 * controller's one resolver (resolveDrop) and its dwell timers use these; hitTest supplies the
 * rendered boxes they read (Ruling 13: rendered geometry).
 */
import type { HitResult } from './hitTest';

export type FlowPage = NonNullable<HitResult['flowPage']>;
type Box = { left: number; top: number; width: number; height: number };

/**
 * Where a drop on an open folder's page goes in the folder's order, from the pointer (px from the
 * page's content origin):
 * - over an item: before it;
 * - in a row of items but over none of them: before the next one to the right, else after the row's last;
 * - above the first row: before the page's first item;
 * - anywhere else (below the items, an empty page): the end of THIS page, not of the folder.
 * The index counts the items that stay (treeOps.moveBetween takes the moved ones out first). `order`
 * is the folder's children ids; `moving` the ids being moved (empty for a copy). `before` / `after`
 * name the item the insertion marker is drawn against.
 */
export function flowIndex(
  order: readonly string[], moving: ReadonlySet<string>, fp: FlowPage, dx: number, dy: number
): { index: number; before?: string; after?: string } {
  const others = order.filter((id) => !moving.has(id));
  const boxes = fp.boxes.filter((b) => others.includes(b.id));
  const before = (id: string) => ({ index: others.indexOf(id), before: id });
  const after = (id: string) => ({ index: others.indexOf(id) + 1, after: id });
  const inX = (b: Box) => dx >= b.left && dx < b.left + b.width;
  const inY = (b: Box) => dy >= b.top && dy < b.top + b.height;
  const under = boxes.find((b) => inX(b) && inY(b));
  if (under) return before(under.id);
  const row = boxes.filter(inY);
  if (row.length > 0) {
    const next = row.find((b) => b.left >= dx);
    return next ? before(next.id) : after(row[row.length - 1].id);
  }
  if (boxes.length > 0 && dy < Math.min(...boxes.map((b) => b.top))) return before(boxes[0].id);
  // The end of this page: past every item drawn on it (the dragged ones too: they are still in place).
  const pageEnd = fp.page * fp.perPage + fp.count;
  const index = order.slice(0, pageEnd).filter((id) => !moving.has(id)).length;
  const last = boxes[boxes.length - 1];
  return last ? { index, after: last.id } : { index };
}

/** The insertion marker (viewport px) for a flowIndex slot: a bar at the edge of the item it names. */
export function flowMarker(
  slot: { before?: string; after?: string }, fp: FlowPage, origin: { left: number; top: number }, emptyHeightPx: number
): { left: number; top: number; height: number } {
  const id = slot.before ?? slot.after;
  const b = id !== undefined ? fp.boxes.find((x) => x.id === id) : undefined;
  if (!b) return { left: origin.left, top: origin.top, height: emptyHeightPx };
  return { left: origin.left + (slot.before !== undefined ? b.left : b.left + b.width), top: origin.top + b.top, height: b.height };
}

/** The dwell key for holding over a page bar's ‹ / › that would show `page` of the folder `folderId`. */
export function pageDwellKey(folderId: string, page: number): string {
  return `page:${JSON.stringify([folderId, page])}`;
}

/** The dwell key for holding over a crumb of open folder `folderId` that goes back up to `to`. */
export function crumbDwellKey(folderId: string, to: string): string {
  return `fcrumb:${JSON.stringify([folderId, to])}`;
}

/** The [folderId, x] a page / crumb dwell key carries, or null when it is not one (a caller bug). */
export function dwellArgs<T extends number | string>(arg: string): [string, T] | null {
  try {
    const v = JSON.parse(arg) as unknown;
    return Array.isArray(v) && v.length === 2 && typeof v[0] === 'string' ? (v as [string, T]) : null;
  } catch {
    return null;
  }
}
