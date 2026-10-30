/**
 * Status checks: the TypeScript twin of the backend's configdoc.EffectiveStatusChecks, so the
 * dialogs can say what a setting does while it is still a draft. Both resolvers run every case of
 * the shared fixture backend/internal/configdoc/testdata/status_checks_cases.json.
 *
 * Only tiles are checked. A tile is On (statusCheck.enabled true) or Off (false, null or absent).
 * Everything above a tile is a gate, Enabled or Disabled: the global setting, the dashboard, the
 * tab, then its folders (outermost first). A tile is checked when it is On and every gate on its
 * path is Enabled. A gate's statusChecksEnabled false is Disabled; true, null or absent is Enabled.
 * A wrong-typed value on the tile, a folder or the tab makes the tile unchecked with source
 * "invalid" naming that level.
 */
import type { FolderNode, LayoutDashboard, LayoutNode, LayoutTab } from '$lib/types/layout';
import type { ContainerRef } from './treeOps';
import { locate } from './treeOps';

export type CheckSource = 'global' | 'dashboard' | 'tab' | 'folder' | 'tile' | 'invalid';
export type GateLevel = 'global' | 'dashboard' | 'tab' | 'folder';

export interface Resolution {
  on: boolean;
  /** Checked: "tile". Not checked: "tile" (the tile is Off), the outermost Disabled gate, or "invalid". */
  source: CheckSource;
  /** The deciding level's id; "" for the global setting. */
  sourceId: string;
}

/** The two gates above every tab: the global setting and the dashboard's own. */
export interface DashboardBase {
  dashboardId: string;
  /** The global setting status.checks_enabled. */
  global: boolean;
  /** The dashboard's own gate: false only when its settings.statusChecksEnabled is false. */
  dashboard: boolean;
}

export type TileSetting = 'on' | 'off' | 'invalid';
export type GateSetting = 'enabled' | 'disabled' | 'invalid';

type Level = { id?: unknown; statusChecksEnabled?: unknown; statusCheck?: unknown };

/** A dashboard, tab or folder gate: false is Disabled; true, null and absent are Enabled. */
export function gateSetting(v: unknown): GateSetting {
  if (v === undefined || v === null || v === true) return 'enabled';
  if (v === false) return 'disabled';
  return 'invalid';
}

/** A tile's own setting: enabled true is On; false, null, absent (or no statusCheck) is Off. */
export function tileSetting(tile: { statusCheck?: unknown }): TileSetting {
  const raw = tile.statusCheck;
  if (raw === undefined || raw === null) return 'off';
  if (typeof raw !== 'object' || Array.isArray(raw)) return 'invalid';
  const v = (raw as { enabled?: unknown }).enabled;
  if (v === true) return 'on';
  if (v === false || v === null || v === undefined) return 'off';
  return 'invalid';
}

/**
 * The two top gates from GET /api/dashboards/{id}/settings (the dashboard's stored override) and
 * the global setting. Only a stored false disables the dashboard; a wrong type there is ignored,
 * as the backend's Resolve ignores it.
 */
export function dashboardBase(dashboardId: string, override: unknown, global: boolean): DashboardBase {
  return { dashboardId, global, dashboard: override !== false };
}

const idOf = (o: Level | null | undefined): string => (typeof o?.id === 'string' ? o.id : '');

/** A wrong-typed tab or folder gate on the path, the most specific first; null when there is none. */
function invalidGate(tab: Level | null, folders: Level[]): Resolution | null {
  for (let i = folders.length - 1; i >= 0; i--) {
    if (gateSetting(folders[i].statusChecksEnabled) === 'invalid') {
      return { on: false, source: 'invalid', sourceId: idOf(folders[i]) };
    }
  }
  if (tab && gateSetting(tab.statusChecksEnabled) === 'invalid') {
    return { on: false, source: 'invalid', sourceId: idOf(tab) };
  }
  return null;
}

/** What stops the checks below a level. `more` counts the other Disabled gates on the path. */
export interface Block {
  source: GateLevel | 'invalid';
  sourceId: string;
  more: number;
}

/**
 * The gates above a level: null when they are all Enabled (the level is allowed), a Block when one
 * stops it, or undefined when the answer needs `base` and it is not known yet — never a guess.
 * `skipDashboard` leaves the dashboard gate out (the dashboard's own dialog asks what is above it).
 */
export function gatesAbove(
  base: DashboardBase | null,
  tab: Level | null,
  folders: Level[],
  skipDashboard = false
): Block | null | undefined {
  const inv = invalidGate(tab, folders);
  if (inv) return { source: 'invalid', sourceId: inv.sourceId, more: 0 };
  if (!base) return undefined;
  const closed: { source: GateLevel; sourceId: string }[] = [];
  if (!base.global) closed.push({ source: 'global', sourceId: '' });
  if (!skipDashboard && !base.dashboard) closed.push({ source: 'dashboard', sourceId: base.dashboardId });
  if (tab && gateSetting(tab.statusChecksEnabled) === 'disabled') closed.push({ source: 'tab', sourceId: idOf(tab) });
  for (const f of folders) {
    if (gateSetting(f.statusChecksEnabled) === 'disabled') closed.push({ source: 'folder', sourceId: idOf(f) });
  }
  return closed.length ? { ...closed[0], more: closed.length - 1 } : null;
}

/**
 * Resolve one tile. A wrong-typed value anywhere on the path decides first; then the outermost
 * Disabled gate (even over a tile that is Off); then the tile's own On / Off. Returns null when the
 * answer depends on the top gates and `base` is not known yet — never a guess.
 */
export function resolveStatusChecks(
  base: DashboardBase | null,
  tab: Level | null,
  folders: Level[],
  tile: Level | null
): Resolution | null {
  if (tile && tileSetting(tile) === 'invalid') return { on: false, source: 'invalid', sourceId: idOf(tile) };
  const inv = invalidGate(tab, folders);
  if (inv) return inv;
  const g = gatesAbove(base, tab, folders);
  if (g === undefined) return null;
  if (g) return { on: false, source: g.source, sourceId: g.sourceId };
  return { on: !!tile && tileSetting(tile) === 'on', source: 'tile', sourceId: idOf(tile) };
}

/**
 * True when the checker could ever probe this tile: not a note, and with a non-empty URL. The twin
 * of Go's configdoc.IsCheckableTile; anything else is skipped whatever its setting says.
 */
export function isCheckableTile(tile: { type?: unknown; url?: unknown } | null | undefined): boolean {
  if (!tile || typeof tile !== 'object') return false;
  if (tile.type === 'note') return false;
  return typeof tile.url === 'string' && tile.url !== '';
}

/** True when the tile's own setting could let it be checked (so its status is worth asking for). */
export function tileMayBeChecked(tile: { statusCheck?: unknown }): boolean {
  return tileSetting(tile) !== 'off';
}

// ------------------------------------------------------------------ names

const kids = (c: unknown): LayoutNode[] => {
  const ch = (c as { children?: unknown } | null | undefined)?.children;
  return Array.isArray(ch) ? (ch as LayoutNode[]) : [];
};

const label = (n: { name?: unknown }) => (typeof n.name === 'string' && n.name.trim() ? n.name : undefined);

function nameIn(dashboards: LayoutDashboard[], id: string): string | undefined {
  const walk = (list: LayoutNode[]): string | undefined => {
    for (const n of list) {
      if (!n || typeof n !== 'object') continue;
      if (n.id === id) return label(n) ?? (n.kind === 'folder' ? 'an untitled folder' : 'an untitled tile');
      if (n.kind === 'folder') {
        const r = walk(kids(n.content));
        if (r) return r;
      }
    }
    return undefined;
  };
  for (const d of dashboards) {
    if (d.id === id) return label(d) ?? 'this dashboard';
    for (const t of Array.isArray(d.tabs) ? d.tabs : []) {
      if (t.id === id) return label(t) ?? 'an untitled tab';
      const r = walk(kids(t.root));
      if (r) return r;
    }
  }
  return undefined;
}

/** The name of the level a status response names ("Settings" for the global setting). */
export function levelNameIn(dashboards: LayoutDashboard[], source: CheckSource | string, sourceId: string): string {
  if (source === 'global') return 'Settings';
  return nameIn(dashboards, sourceId) ?? `${source === 'invalid' ? 'item' : source} ${sourceId}`;
}

/**
 * Where a gate is, as the sentences say it: "in Settings", or "on <level> <name>" (an untitled one
 * reads "on an untitled folder").
 */
export function gatePlace(source: GateLevel, name: string | undefined): string {
  if (source === 'global') return 'in Settings';
  const n = name?.trim();
  return n ? `on ${source} ${n}` : `on an untitled ${source}`;
}

/** The badge tooltip for a tile that is not checked. */
export function disabledTooltip(dashboards: LayoutDashboard[], source?: string, sourceId?: string): string {
  if (!source || source === 'tile') return 'Status check is Off for this tile';
  if (source === 'invalid') {
    return `Not checked: invalid status-check setting on ${levelNameIn(dashboards, source, sourceId ?? '')}`;
  }
  if (source === 'global' || source === 'dashboard' || source === 'tab' || source === 'folder') {
    const name = source === 'global' ? undefined : nameIn(dashboards, sourceId ?? '') ?? sourceId;
    return `Not checked: status monitoring is disabled ${gatePlace(source, name)}`;
  }
  return 'Not checked';
}

// ------------------------------------------------------------------ dialog context

/** What a dialog needs to show its row: the dashboard and the levels above the edited one. */
export interface StatusContext {
  dashboardId: string;
  dashboardName: string;
  /** The tab above (null for the tab and dashboard dialogs). */
  tab: LayoutTab | null;
  /** Folders above, outermost first. */
  folders: FolderNode[];
}

function folderById(d: LayoutDashboard, id: string): FolderNode | undefined {
  const loc = locate(d, id);
  if (!loc) return undefined;
  let list = kids(d.tabs.find((t) => t.id === loc.tabId)?.root);
  for (const fid of loc.folderChain) list = kids((list.find((n) => n.id === fid) as FolderNode | undefined)?.content);
  const n = list[loc.index];
  return n && n.kind === 'folder' ? n : undefined;
}

/** Context for the item `nodeId` of the draft (its tab and folder chain). */
export function contextForNode(d: LayoutDashboard, nodeId: string): StatusContext | undefined {
  const loc = locate(d, nodeId);
  if (!loc) return undefined;
  const folders = loc.folderChain.map((id) => folderById(d, id)).filter((f): f is FolderNode => !!f);
  return { dashboardId: d.id, dashboardName: d.name, tab: d.tabs.find((t) => t.id === loc.tabId) ?? null, folders };
}

/** Context for a new item going into `ref`. */
export function contextForContainer(d: LayoutDashboard, ref: ContainerRef): StatusContext | undefined {
  const tab = d.tabs.find((t) => t.id === ref.tabId);
  if (!tab) return undefined;
  if (!ref.folderId) return { dashboardId: d.id, dashboardName: d.name, tab, folders: [] };
  const above = contextForNode(d, ref.folderId);
  const f = folderById(d, ref.folderId);
  if (!above || !f) return undefined;
  return { ...above, folders: [...above.folders, f] };
}

/** Context for a tab's own dialog (and the dashboard's: only its id and name are used). */
export function contextForTab(d: Pick<LayoutDashboard, 'id' | 'name'>): StatusContext {
  return { dashboardId: d.id, dashboardName: d.name, tab: null, folders: [] };
}

/** The name of a gate in a dialog context (the dashboard, the tab or a folder); undefined if untitled. */
export function contextGateName(ctx: StatusContext, b: Block): string | undefined {
  if (b.source === 'global') return undefined;
  if (b.source === 'dashboard') return ctx.dashboardName?.trim() || 'this dashboard';
  const lv: { id: string; name?: unknown } | undefined =
    ctx.tab && ctx.tab.id === b.sourceId ? ctx.tab : ctx.folders.find((f) => f.id === b.sourceId);
  if (lv) return label(lv);
  return b.sourceId;
}
