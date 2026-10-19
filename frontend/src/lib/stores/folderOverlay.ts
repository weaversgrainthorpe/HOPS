import { writable, readonly, get } from 'svelte/store';
import type { Container, LayoutDoc } from '$lib/types/layout';
import { findLayoutDashboard } from './config';
import { toast } from './toast';

// Stack of open folder ids for the current tab (bottom first).
const stack = writable<string[]>([]);
export const overlayStack = readonly(stack);

export function openFolder(id: string): void {
  stack.update((s) => (s.includes(id) ? s : [...s, id]));
}

export function closeTop(): void {
  stack.update((s) => s.slice(0, -1));
}

/** Close down to `depth` open overlays (0 closes everything). */
export function closeTo(depth: number): void {
  stack.update((s) => s.slice(0, Math.max(0, depth)));
}

export function closeAll(): void {
  stack.set([]);
}

function collectIds(c: Container | undefined, out: Set<string>): void {
  const kids = Array.isArray(c?.children) ? c!.children : [];
  for (const n of kids) {
    if (n && typeof n === 'object' && (n as { kind?: unknown }).kind === 'folder') {
      const f = n as { id?: unknown; content?: Container };
      if (typeof f.id === 'string') out.add(f.id);
      collectIds(f.content, out);
    }
  }
}

/**
 * Drop open ids whose folder no longer exists in the dashboard, from the
 * bottom-most missing one upward (everything above a vanished folder goes too).
 * With `tabId`, only that tab counts (panels resolve in the current tab only).
 * Returns the dropped ids; a missing doc/dashboard drops everything.
 */
export function reconcile(doc: LayoutDoc | null, dashboardId: string, tabId?: string): string[] {
  const ids = new Set<string>();
  const dash = findLayoutDashboard(dashboardId, doc);
  for (const t of dash?.tabs ?? []) if (tabId === undefined || t.id === tabId) collectIds(t.root, ids);
  const current = get(stack);
  const firstMissing = current.findIndex((id) => !ids.has(id));
  if (firstMissing === -1) return [];
  stack.set(current.slice(0, firstMissing));
  return current.slice(firstMissing);
}

/**
 * A request (from search) to show one tile: switch to its tab, open each
 * collapsed folder on its path (outermost first), then focus it. The Dashboard
 * showing `dashboardId` takes it (takeReveal), so it survives the navigation
 * to that dashboard; any navigation elsewhere clears it, and it expires after
 * REVEAL_TTL_MS with one visible notice, so it can never fire on a later visit.
 */
export interface RevealRequest {
  dashboardId: string;
  tabId: string;
  /** Collapsed folders enclosing the tile, outermost first. */
  folderIds: string[];
  tileId: string;
}
export const REVEAL_TTL_MS = 5000;
const reveal = writable<RevealRequest | null>(null);
export const revealRequest = {
  subscribe: reveal.subscribe,
  /** Clears (or, in tests, sets) the request without a TTL. */
  set: (r: RevealRequest | null) => {
    clearRevealTimer();
    reveal.set(r);
  }
};
let revealTimer: ReturnType<typeof setTimeout> | null = null;

function clearRevealTimer(): void {
  if (revealTimer !== null) clearTimeout(revealTimer);
  revealTimer = null;
}

export function requestReveal(r: RevealRequest): void {
  clearRevealTimer();
  reveal.set(r);
  revealTimer = setTimeout(() => {
    revealTimer = null;
    if (get(reveal) !== r) return;
    reveal.set(null);
    toast.error("Couldn't show that tile: its dashboard didn't open in time");
  }, REVEAL_TTL_MS);
}

/** Take the pending request if it is for `dashboardId` (it is then gone). */
export function takeReveal(dashboardId: string): RevealRequest | null {
  const r = get(reveal);
  if (!r || r.dashboardId !== dashboardId) return null;
  clearRevealTimer();
  reveal.set(null);
  return r;
}

/**
 * Call on every navigation with the destination's dashboard id (null when the
 * destination is not a dashboard): a request for any other dashboard is dropped.
 */
export function revealNavigation(toDashboardId: string | null): void {
  const r = get(reveal);
  if (r && r.dashboardId !== toDashboardId) {
    clearRevealTimer();
    reveal.set(null);
  }
}
