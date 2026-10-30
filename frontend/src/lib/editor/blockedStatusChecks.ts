/**
 * Blocked status checks across the dashboards: the tiles whose own status check is On but which
 * are not checked because a Disabled gate (the dashboard, a tab or a folder) or a wrong-typed one
 * stops them. Pure: the page supplies the layouts and runs this only while the global setting is
 * Enabled (when it is Disabled nothing is checked and the page says only that). All resolution
 * goes through gatesAbove, so this can never drift from the dialogs or the checker.
 */
import type { FolderNode, LayoutDashboard, LayoutNode, LayoutTab } from '$lib/types/layout';
import { dashboardBase, gatesAbove, isCheckableTile, levelNameIn, tileSetting, type Block } from './statusChecks';

export interface BlockedRow {
  key: string;            // `${dashboardId}:${tileId}`; unique
  dashboardId: string;
  tileId: string;
  tabId: string;
  /** Folder ids from the outermost to the tile's own. */
  folderIds: string[];
  /** Names from the tab down to the tile: tab, folders..., tile. */
  path: string[];
  /** The outermost Disabled gate (or a wrong-typed one), and how many more Disabled gates there are. */
  blockedBy: Block & { name: string };
}

const kids = (c: unknown): LayoutNode[] => {
  const ch = (c as { children?: unknown } | null | undefined)?.children;
  return Array.isArray(ch) ? (ch as LayoutNode[]) : [];
};
const nameOf = (n: { name?: unknown }): string => (typeof n.name === 'string' ? n.name : '');

/** The dashboard's stored gate, as the config holds it (settings.statusChecksEnabled). */
export function dashboardGateOf(d: LayoutDashboard): unknown {
  const s = (d as { settings?: unknown }).settings;
  return s && typeof s === 'object' && !Array.isArray(s) ? (s as { statusChecksEnabled?: unknown }).statusChecksEnabled : undefined;
}

export function findBlocked(dashboards: LayoutDashboard[]): BlockedRow[] {
  const rows: BlockedRow[] = [];
  for (const d of dashboards) {
    // Run only while the global setting is Enabled, so the global gate is open here.
    const base = dashboardBase(d.id, dashboardGateOf(d), true);
    const visit = (list: LayoutNode[], tab: LayoutTab, folders: FolderNode[], path: string[]) => {
      for (const n of list) {
        if (!n || typeof n !== 'object') continue;
        const p = [...path, nameOf(n)];
        if (n.kind === 'folder') {
          visit(kids(n.content), tab, [...folders, n], p);
          continue;
        }
        if (!isCheckableTile(n as { type?: unknown; url?: unknown })) continue;
        if (tileSetting(n as { statusCheck?: unknown }) !== 'on') continue;
        const b = gatesAbove(base, tab, folders);
        if (!b) continue;
        rows.push({
          key: `${d.id}:${n.id}`, dashboardId: d.id, tileId: n.id, tabId: tab.id,
          folderIds: folders.map((f) => f.id), path: p,
          blockedBy: { ...b, name: levelNameIn([d], b.source, b.sourceId) }
        });
      }
    };
    for (const tab of Array.isArray(d.tabs) ? d.tabs : []) visit(kids(tab.root), tab, [], [nameOf(tab)]);
  }
  return rows;
}
