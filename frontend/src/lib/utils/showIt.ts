import { get } from 'svelte/store';
import { goto } from '$app/navigation';
import { page } from '$app/stores';
import { config, resolveDashboardRoute, dashboardHref } from '$lib/stores/config';
import { requestReveal, revealRequest } from '$lib/stores/reveal';
import { toast } from '$lib/stores/toast';

/** Where a tile or folder lives: enough to open its dashboard and reveal it there. */
export interface ShowTarget {
  kind: 'tile' | 'folder';
  id: string;
  dashboardId: string;
  dashboardPath: string;
  dashboardName: string;
  tabId: string;
  /** Folders to open, outermost first. */
  folderIds: string[];
}

/**
 * "Show it" (search, the dead-link report): the Dashboard switches to the tile's tab, opens the
 * folders on its path in place (outermost first), drills down, flips to its page, scrolls to it and
 * highlights it. Navigates first when it lives on another dashboard (or we're not on one).
 * `activate` also clicks the tile once shown.
 */
export function showOnDashboard(r: ShowTarget, activate = false): void {
  requestReveal({
    dashboardId: r.dashboardId,
    tabId: r.tabId,
    folderIds: r.folderIds,
    tileId: r.id,
    kind: r.kind,
    activate: activate && r.kind === 'tile'
  });
  const cfg = get(config);
  const seg = get(page).params?.dashboard;
  const here = cfg && seg ? resolveDashboardRoute(seg, cfg) : undefined;
  if (here?.id !== r.dashboardId) {
    goto(dashboardHref(r.dashboardPath)).catch((e) => {
      revealRequest.set(null);
      toast.error(`Couldn't open "${r.dashboardName}": ${e instanceof Error ? e.message : 'navigation failed'}`);
    });
  }
}
