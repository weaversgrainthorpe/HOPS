/**
 * Layered status checks (M4 design §4b, Ruling 12): the TypeScript twin of the backend's
 * configdoc.EffectiveStatusChecks, so the dialogs can show the source and the effect of a
 * setting while it is still a draft. Both resolvers run every case of the shared fixture
 * backend/internal/configdoc/testdata/status_checks_cases.json (Ruling 2).
 *
 * The most specific level that sets it wins: the tile, its folders (innermost first), the
 * tab, the dashboard's override, then the global setting. A tile with no setting of its own
 * (no statusCheck, no enabled, or enabled null) inherits from its containers. A wrong-typed value on the tile, a folder or the
 * tab makes the tile off with source "invalid" naming that level.
 */
import type { FolderNode, LayoutDashboard, LayoutNode, LayoutTab } from '$lib/types/layout';
import type { ContainerRef } from './treeOps';
import { locate } from './treeOps';

export type CheckSource = 'global' | 'dashboard' | 'tab' | 'folder' | 'tile' | 'invalid';

export interface Resolution {
  on: boolean;
  source: CheckSource;
  /** The deciding level's id; "" for the global setting. */
  sourceId: string;
}

/** What the dashboard level resolves to: its own override, or the global value. */
export interface DashboardBase {
  on: boolean;
  source: 'dashboard' | 'global';
  dashboardId: string;
}

/** A tab or folder's own setting: absent = inherit. */
export type ContainerSetting = 'inherit' | 'on' | 'off' | 'invalid';
/** A tile's own setting: the same as a folder's; absent (no statusCheck / no enabled) is inherit. */
export type TileSetting = ContainerSetting;
export type LevelSetting = TileSetting;

type Level = { id?: unknown; statusChecksEnabled?: unknown; statusCheck?: unknown };

export function containerSetting(v: unknown): ContainerSetting {
  if (v === undefined || v === null) return 'inherit';
  if (v === true) return 'on';
  if (v === false) return 'off';
  return 'invalid';
}

export function tileSetting(tile: { statusCheck?: unknown }): TileSetting {
  const raw = tile.statusCheck;
  if (raw === undefined || raw === null) return 'inherit';
  if (typeof raw !== 'object' || Array.isArray(raw)) return 'invalid';
  return containerSetting((raw as { enabled?: unknown }).enabled);
}

/**
 * The dashboard level from GET /api/dashboards/{id}/settings: a boolean override decides;
 * anything else (null, or a wrong type, which the backend's Resolve ignores) falls to the
 * global value, which is then what `effective` holds.
 */
export function dashboardBase(dashboardId: string, override: unknown, effectiveOrGlobal: boolean): DashboardBase {
  if (typeof override === 'boolean') return { on: override, source: 'dashboard', dashboardId };
  return { on: effectiveOrGlobal, source: 'global', dashboardId };
}

const idOf = (o: Level | null | undefined): string => (typeof o?.id === 'string' ? o.id : '');

/**
 * Resolve one tile (or, with tile = null, what a level below `folders` inherits). Returns null
 * only when the answer depends on the dashboard level and `base` is not known yet — never a
 * guessed value.
 */
export function resolveStatusChecks(
  base: DashboardBase | null,
  tab: Level | null,
  folders: Level[],
  tile: Level | null
): Resolution | null {
  // Any invalid value on the path makes the tile off, most specific first.
  if (tile && tileSetting(tile) === 'invalid') return { on: false, source: 'invalid', sourceId: idOf(tile) };
  for (let i = folders.length - 1; i >= 0; i--) {
    if (containerSetting(folders[i].statusChecksEnabled) === 'invalid') {
      return { on: false, source: 'invalid', sourceId: idOf(folders[i]) };
    }
  }
  if (tab && containerSetting(tab.statusChecksEnabled) === 'invalid') {
    return { on: false, source: 'invalid', sourceId: idOf(tab) };
  }
  if (tile) {
    const s = tileSetting(tile);
    if (s === 'on') return { on: true, source: 'tile', sourceId: idOf(tile) };
    if (s === 'off') return { on: false, source: 'tile', sourceId: idOf(tile) };
  }
  for (let i = folders.length - 1; i >= 0; i--) {
    const s = containerSetting(folders[i].statusChecksEnabled);
    if (s !== 'inherit') return { on: s === 'on', source: 'folder', sourceId: idOf(folders[i]) };
  }
  if (tab) {
    const s = containerSetting(tab.statusChecksEnabled);
    if (s !== 'inherit') return { on: s === 'on', source: 'tab', sourceId: idOf(tab) };
  }
  if (!base) return null;
  return base.source === 'dashboard'
    ? { on: base.on, source: 'dashboard', sourceId: base.dashboardId }
    : { on: base.on, source: 'global', sourceId: '' };
}

/** True when the tile's own setting could let it be checked (so its status is worth asking for). */
export function tileMayBeChecked(tile: { statusCheck?: unknown }): boolean {
  const s = tileSetting(tile);
  return s === 'on' || s === 'inherit' || s === 'invalid';
}

export interface RowText {
  text: string;
  tone: 'normal' | 'pending' | 'warn';
}

const onOff = (b: boolean) => (b ? 'on' : 'off');
const LEVEL_WORD: Record<CheckSource, string> = {
  global: 'the global setting', dashboard: 'the dashboard', tab: 'the tab', folder: 'the folder',
  tile: 'the tile', invalid: 'a level above'
};

/**
 * The one line every status-check row shows (tile, folder and tab dialogs alike). `parent` is
 * what this level would get if it inherited (null = not known yet); `nameOf` names a level.
 */
export function statusRowText(
  own: LevelSetting,
  parent: Resolution | null,
  nameOf: (r: Resolution) => string
): RowText {
  if (own === 'invalid') {
    return { text: 'Invalid setting here: treated as off. Choose Inherit, On or Off to fix it.', tone: 'warn' };
  }
  if (!parent) return { text: 'Checking…', tone: 'pending' };
  if (parent.source === 'invalid') {
    return { text: `Off: invalid setting on ${nameOf(parent)} (open it and choose Inherit, On or Off)`, tone: 'warn' };
  }
  if (own === 'inherit') return { text: `Inherited from ${nameOf(parent)}: ${onOff(parent.on)}`, tone: 'normal' };
  const mine = own === 'on';
  const tail = mine === parent.on ? ' too' : '';
  return {
    text: `Overridden here: ${onOff(mine)} (${LEVEL_WORD[parent.source]} is ${onOff(parent.on)}${tail})`,
    tone: 'normal'
  };
}

// ------------------------------------------------------------------ names

const kids = (c: unknown): LayoutNode[] => {
  const ch = (c as { children?: unknown } | null | undefined)?.children;
  return Array.isArray(ch) ? (ch as LayoutNode[]) : [];
};

function nameIn(dashboards: LayoutDashboard[], id: string): string | undefined {
  const label = (n: { name?: unknown }) => (typeof n.name === 'string' && n.name.trim() ? n.name : undefined);
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

/** The badge tooltip for a tile whose checks resolve off. */
export function disabledTooltip(dashboards: LayoutDashboard[], source?: string, sourceId?: string): string {
  if (!source) return 'Status checks are off for this tile';
  if (source === 'global') return 'Status checks are off for this tile (Settings)';
  const name = levelNameIn(dashboards, source, sourceId ?? '');
  if (source === 'invalid') return `Status checks are off for this tile: invalid setting on ${name}`;
  return `Status checks are off for this tile (set on ${name})`;
}

// ------------------------------------------------------------------ dialog context

/** What a dialog needs to show its row: the dashboard and the levels above the edited one. */
export interface StatusContext {
  dashboardId: string;
  dashboardName: string;
  /** The tab above (null for the tab dialog itself). */
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

/** Context for a tab's own dialog. */
export function contextForTab(d: Pick<LayoutDashboard, 'id' | 'name'>): StatusContext {
  return { dashboardId: d.id, dashboardName: d.name, tab: null, folders: [] };
}

/** Name a level of a dialog context (the dashboard, the tab, a folder, or "Settings"). */
export function contextNameOf(ctx: StatusContext): (r: Resolution) => string {
  return (r) => {
    if (r.source === 'global') return 'Settings';
    if (r.source === 'dashboard') return ctx.dashboardName?.trim() || 'this dashboard';
    const lv: { id: string; name?: unknown } | undefined =
      ctx.tab && ctx.tab.id === r.sourceId ? ctx.tab : ctx.folders.find((f) => f.id === r.sourceId);
    if (lv) {
      if (typeof lv.name === 'string' && lv.name.trim()) return lv.name;
      return lv === ctx.tab ? 'an untitled tab' : 'an untitled folder';
    }
    return `${r.source} ${r.sourceId}`;
  };
}
