import { writable, get, type Readable } from 'svelte/store';
import { session } from './editSession';
import { locate } from '$lib/editor/treeOps';

// Edit-mode selection, keyed by node id (tiles and folders alike). A plain
// click selects one item; Ctrl/Cmd-click adds or removes; Escape clears.
// Lives only for the edit session it was made in.

const state = writable<Set<string>>(new Set());
export const selectedNodes: Readable<Set<string>> = { subscribe: state.subscribe };

/** additive = Ctrl/Cmd held: toggle this id in the selection; otherwise select only it. */
export function toggleNode(id: string, additive: boolean): void {
  if (!additive) {
    state.set(new Set([id]));
    return;
  }
  state.update((cur) => {
    const next = new Set(cur);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
}

export function clearSelection(): void {
  if (get(state).size > 0) state.set(new Set());
}

/** The selected ids that still exist in the session draft (in selection order). */
export function selectionInDraft(): string[] {
  const s = get(session);
  if (!s) return [];
  return [...get(state)].filter((id) => locate(s.draft, id) !== undefined);
}

// A selection never outlives its session (or follows it to another dashboard).
let heldDashboard: string | null = null;
session.subscribe((s) => {
  const id = s ? s.dashboardId : null;
  if (id !== heldDashboard) {
    heldDashboard = id;
    clearSelection();
  }
});
