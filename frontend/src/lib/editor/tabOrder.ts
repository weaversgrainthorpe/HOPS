// Ordering logic for the Settings > Dashboards > Tab order page: moving a block of ticked
// tabs, sorting by name, and keeping the user's arrangement when the dashboard changed
// elsewhere before Save. Pure functions; the page holds the state and calls these.

/** Moves the ids in `ids` as one block, keeping their relative order, to index `to` of the
 * list with the block removed. `to` is clamped to 0..rest.length. Never mutates `order`. */
export function moveBlock(order: string[], ids: ReadonlySet<string>, to: number): string[] {
  const rest = order.filter((id) => !ids.has(id));
  const block = order.filter((id) => ids.has(id));
  const at = Math.min(Math.max(to, 0), rest.length);
  return [...rest.slice(0, at), ...block, ...rest.slice(at)];
}

/** The tab ids sorted by name: natural numbers ("Tab 2" before "Tab 10"), case-insensitive.
 * Equal names keep their input order. */
export function sortByName(tabs: { id: string; name: string }[]): string[] {
  return [...tabs]
    .sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    )
    .map((t) => t.id);
}

/**
 * Re-applies the user's arrangement to the latest tabs after a conflict. `order` is the user's
 * order minus the tabs no longer in `fresh`, with the new fresh tabs appended in fresh order.
 * `added` and `removed` are tab names, so the page can tell the user what changed upstream.
 */
export function mergeAfterConflict(
  userTabs: { id: string; name: string }[],
  fresh: { id: string; name: string }[]
): { order: string[]; added: string[]; removed: string[] } {
  const freshIds = new Set(fresh.map((t) => t.id));
  const userIds = new Set(userTabs.map((t) => t.id));

  const kept = userTabs.filter((t) => freshIds.has(t.id)).map((t) => t.id);
  const added = fresh.filter((t) => !userIds.has(t.id));
  const removed = userTabs.filter((t) => !freshIds.has(t.id)).map((t) => t.name);

  return {
    order: [...kept, ...added.map((t) => t.id)],
    added: added.map((t) => t.name),
    removed
  };
}
