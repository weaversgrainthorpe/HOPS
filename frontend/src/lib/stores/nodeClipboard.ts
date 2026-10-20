import { writable, get, type Readable } from 'svelte/store';
import type { LayoutNode } from '$lib/types/layout';
import type { ContainerRef } from '$lib/editor/treeOps';
import { adaptNode, deleteNodes, locate, moveNodes, originOf, pasteSnapshot, type NodeOrigin } from '$lib/editor/treeOps';
import { apply, session, dirty } from './editSession';
import { layoutDoc, findLayoutDashboard } from './config';
import { selectedNodes, clearSelection, toggleNode } from './nodeSelection';
import { toast } from './toast';
import { adaptedFor, documentIds, transferAndRebase, findIn, placementsFor, plain, type Cell } from '$lib/editor/editorActions';

// Edit-mode clipboard for tiles and folders (Ctrl+C / Ctrl+X / Ctrl+V and the
// item menu). Held in memory only. Copy keeps a snapshot of the nodes; the
// paste of a copy uses copyNodes (fresh ids, deep), the paste of a cut moves
// the originals (moveNodes on the same dashboard, the transfer endpoint across
// dashboards). Nothing reaches the server except a cross-dashboard paste,
// which is only allowed while the session has no unsaved changes.

export interface NodeClipboard {
  mode: 'copy' | 'cut';
  /** A snapshot taken at Copy/Cut time: later edits to the originals never change a pasted copy. */
  nodes: LayoutNode[];
  /** Where each node sat (its container's mode and tab's free side), for converting on paste. */
  origins: NodeOrigin[];
  sourceDashboardId: string;
}

const state = writable<NodeClipboard | null>(null);
export const nodeClipboard: Readable<NodeClipboard | null> = { subscribe: state.subscribe };

export function clearNodeClipboard(): void {
  state.set(null);
}

/** The selection that still exists, minus items inside a selected folder (those go with it). */
function topLevelSelection(): LayoutNode[] {
  const s = get(session);
  if (!s) return [];
  const ids = [...get(selectedNodes)].filter((id) => locate(s.draft, id));
  const set = new Set(ids);
  return ids
    .filter((id) => !locate(s.draft, id)!.folderChain.some((f) => set.has(f)))
    .map((id) => findIn(s.draft, id)!)
    .filter(Boolean);
}

function take(mode: 'copy' | 'cut'): boolean {
  const s = get(session);
  if (!s) {
    toast.error('Not editing: click Edit first.');
    return false;
  }
  const nodes = topLevelSelection();
  if (nodes.length === 0) {
    toast.info(`Select a tile or folder to ${mode} first.`);
    return false;
  }
  const origins = nodes.map((n) => originOf(s.draft, n.id));
  state.set({ mode, nodes: plain(nodes), origins, sourceDashboardId: s.dashboardId });
  const what = nodes.length === 1 ? `"${nodes[0].name || 'Untitled'}"` : `${nodes.length} items`;
  toast.info(mode === 'copy' ? `Copied ${what}` : `Cut ${what} — paste to move it`);
  return true;
}

export function copySelection(): boolean {
  return take('copy');
}

export function cutSelection(): boolean {
  return take('cut');
}

/**
 * Paste into a container (the tab root or a folder). The first item goes at `cell` when it is
 * free there, the rest at the first free cells. Across dashboards: the transfer endpoint, refused
 * with a toast while this session has unsaved changes.
 */
export async function pasteInto(to: ContainerRef, cell?: Cell): Promise<boolean> {
  const s = get(session);
  if (!s) {
    toast.error('Not editing: click Edit first.');
    return false;
  }
  const clip = get(state);
  if (!clip || clip.nodes.length === 0) {
    toast.info('Nothing to paste: copy or cut a tile or folder first.');
    return false;
  }
  const ids = clip.nodes.map((n) => n.id);
  if (clip.sourceDashboardId !== s.dashboardId) return pasteAcross(clip, ids, to);

  if (clip.mode === 'copy') {
    // Clones of the snapshot, with fresh ids: works even if the originals were edited or deleted since.
    let newIds: string[] = [];
    const ok = apply(ids.length === 1 ? 'Paste' : `Paste ${ids.length} items`, (d) => {
      const adapted = clip.nodes.map((n, i) => adaptNode(d, n, clip.origins[i], to));
      const r = pasteSnapshot(d, clip.nodes, clip.origins, to, placementsFor(d, to, adapted, cell), documentIds());
      newIds = r.newIds;
      return r.dashboard;
    });
    if (ok) selectOnly(newIds);
    return ok;
  }

  if (ids.some((id) => !locate(s.draft, id))) {
    toast.error('The cut items are no longer on this dashboard, so there is nothing to move.');
    return false;
  }
  const ok = apply(ids.length === 1 ? 'Move' : `Move ${ids.length} items`, (d) => {
    const nodes = adaptedFor(d, ids, to);
    // The moved items vacate their own cells before the new ones are chosen.
    return moveNodes(d, ids, to, placementsFor(deleteNodes(d, ids), to, nodes, cell));
  });
  if (ok) {
    state.set(null);
    selectOnly(ids);
  }
  return ok;
}

function selectOnly(ids: string[]): void {
  clearSelection();
  ids.forEach((id) => toggleNode(id, true));
}

async function pasteAcross(clip: NodeClipboard, ids: string[], to: ContainerRef): Promise<boolean> {
  const s = get(session)!;
  if (get(dirty)) {
    toast.error(
      'Save or discard your changes first: pasting from another dashboard saves both dashboards straight away.'
    );
    return false;
  }
  const source = findLayoutDashboard(clip.sourceDashboardId, get(layoutDoc));
  if (!source || typeof source.revision !== 'number') {
    toast.error("The dashboard these items came from is no longer available, so they can't be pasted.");
    return false;
  }
  const ok = await transferAndRebase(
    {
      mode: clip.mode === 'copy' ? 'copy' : 'move',
      sourceId: clip.sourceDashboardId,
      sourceRevision: source.revision,
      nodeIds: ids,
      targetId: s.dashboardId,
      targetRevision: s.baseRevision,
      target: to.folderId ? { tabId: to.tabId, folderId: to.folderId } : { tabId: to.tabId }
    },
    `${clip.mode === 'copy' ? 'Copied' : 'Moved'} ${ids.length === 1 ? '1 item' : `${ids.length} items`} from another dashboard and saved`,
    'Paste failed'
  );
  if (ok && clip.mode === 'cut') state.set(null);
  return ok;
}
