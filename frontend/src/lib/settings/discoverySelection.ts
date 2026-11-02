// Which discovery results a selection action applies to. Only rows the admin
// can see count: a tick on a row hidden by the filter is kept (switching to
// "All" shows it still ticked) but is never counted or promoted while hidden.

export interface SelectableRow {
  id: string;
  curateState?: string;
}

function isOpen(r: SelectableRow): boolean {
  return r.curateState !== 'promoted';
}

/** Ticked, not yet promoted rows among the rows shown. These are what Promote adds. */
export function promotableRows<T extends SelectableRow>(
  visible: readonly T[],
  selected: Record<string, boolean>
): T[] {
  return visible.filter((r) => selected[r.id] && isOpen(r));
}

/** Ticked, not yet promoted rows that the filter hides. */
export function hiddenTickedCount(
  all: readonly SelectableRow[],
  visible: readonly SelectableRow[],
  selected: Record<string, boolean>
): number {
  const shown = new Set(visible.map((r) => r.id));
  return all.reduce((n, r) => n + (!shown.has(r.id) && selected[r.id] && isOpen(r) ? 1 : 0), 0);
}

/** The plain line shown next to the filter when hidden rows are ticked. Empty when none. */
export function hiddenTickedMessage(n: number): string {
  if (n <= 0) return '';
  return n === 1
    ? "1 ticked result isn't shown by this filter and won't be added."
    : `${n} ticked results aren't shown by this filter and won't be added.`;
}
