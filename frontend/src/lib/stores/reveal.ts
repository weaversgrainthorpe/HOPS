import { writable, get } from 'svelte/store';
import { toast } from './toast';

/**
 * A request (from search) to show one tile: switch to its tab, open the folders
 * on its path in place (outermost first; folderView.revealInFolders), then focus it. The Dashboard
 * showing `dashboardId` takes it (takeReveal), so it survives the navigation
 * to that dashboard; any navigation elsewhere clears it, and it expires after
 * REVEAL_TTL_MS with one visible notice, so it can never fire on a later visit.
 */
export interface RevealRequest {
  dashboardId: string;
  tabId: string;
  /** Every folder enclosing the tile, outermost first (empty: it is on the tab). */
  folderIds: string[];
  tileId: string;
  /** 'folder': `folderIds` ends with the folder itself and `tileId` is its id (open it, no tile to focus). */
  kind?: 'tile' | 'folder';
  /** Click the tile once shown (a tile that opens in its own dialog). */
  activate?: boolean;
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
