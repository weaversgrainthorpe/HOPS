/**
 * Status-check overrides across the dashboards ("The page"): which levels set an
 * explicit On/Off/invalid value, and what restoring them to Inherit would change. Pure: the page
 * Supplies the layouts and the dashboard bases. All resolution goes through
 * resolveStatusChecks, so this can never drift from the dialogs or the checker.
 */
import type { FolderNode, LayoutDashboard, LayoutNode, LayoutTab } from '$lib/types/layout';
import {
  containerSetting, isCheckableTile, resolveStatusChecks, tileSetting, type DashboardBase, type Resolution
} from './statusChecks';

export type OverrideLevel = 'dashboard' | 'tab' | 'folder' | 'tile';
/** A dashboard's base: known, or null (loading or failed: never guessed). */
export type Bases = Record<string, DashboardBase | null>;
export interface Effect { start: number; stop: number }
export interface OverrideRow {
  key: string;            // `${dashboardId}:${level}:${id}`; unique
  dashboardId: string;
  level: OverrideLevel;
  id: string;             // the node, tab or dashboard id
  path: string[];         // [tab name, ...folder names, own name]; a dashboard row has []
  now: 'on' | 'off' | 'invalid';
  inherited: Resolution | null;   // null when the base is unknown
  effect: Effect | null;          // restoring this row alone; null when the base is unknown
  changes: boolean;               // effect.start + effect.stop > 0, or now === 'invalid'
}
export interface TileRef { dashboardId: string; id: string; path: string[] }

type Setting = 'inherit' | 'on' | 'off' | 'invalid';
const nowOf = (s: Setting): 'on' | 'off' | 'invalid' => (s === 'on' ? 'on' : s === 'off' ? 'off' : 'invalid');

const kids = (c: unknown): LayoutNode[] => {
  const ch = (c as { children?: unknown } | null | undefined)?.children;
  return Array.isArray(ch) ? (ch as LayoutNode[]) : [];
};
const nameOf = (n: { name?: unknown }): string => (typeof n.name === 'string' ? n.name : '');

/** One tab, folder or tile in on-screen order, with the levels above it. */
interface Item {
  level: 'tab' | 'folder' | 'tile';
  node: LayoutTab | LayoutNode;
  tab: LayoutTab;
  folders: FolderNode[];
  path: string[];
}

function walk(d: LayoutDashboard): Item[] {
  const out: Item[] = [];
  const visit = (list: LayoutNode[], tab: LayoutTab, folders: FolderNode[], path: string[]) => {
    for (const n of list) {
      if (!n || typeof n !== 'object') continue;
      const p = [...path, nameOf(n)];
      if (n.kind === 'folder') {
        out.push({ level: 'folder', node: n, tab, folders, path: p });
        visit(kids(n.content), tab, [...folders, n], p);
      } else {
        out.push({ level: 'tile', node: n, tab, folders, path: p });
      }
    }
  };
  for (const tab of Array.isArray(d.tabs) ? d.tabs : []) {
    out.push({ level: 'tab', node: tab, tab, folders: [], path: [nameOf(tab)] });
    visit(kids(tab.root), tab, [], [nameOf(tab)]);
  }
  return out;
}

const keyOf = (dashboardId: string, level: OverrideLevel, id: string) => `${dashboardId}:${level}:${id}`;
const settingOf = (it: Item): Setting =>
  it.level === 'tile'
    ? tileSetting(it.node as { statusCheck?: unknown })
    : containerSetting((it.node as { statusChecksEnabled?: unknown }).statusChecksEnabled);

/** A copy of a level with its own status-check setting taken away. */
function without<T extends object>(o: T): T {
  const c = { ...o } as Record<string, unknown>;
  delete c.statusChecksEnabled;
  delete c.statusCheck;
  return c as T;
}

/** The tiles the checker could probe (isCheckableTile): only these are ever counted or listed. */
const checkableTiles = (items: Item[]): Item[] =>
  items.filter((it) => it.level === 'tile' && isCheckableTile(it.node as { type?: unknown; url?: unknown }));

const refOf = (d: LayoutDashboard, it: Item): TileRef => ({ dashboardId: d.id, id: (it.node as LayoutNode).id, path: it.path });

/** The given tiles of one dashboard, resolved with the keyed settings removed (or as they are, with none). */
function resolveTiles(
  d: LayoutDashboard, tiles: Item[], base: DashboardBase | null, global: boolean | null, removed: Set<string>
): (Resolution | null)[] {
  // Restoring the dashboard override makes the dashboard level fall to the global setting.
  const b: DashboardBase | null = removed.has(keyOf(d.id, 'dashboard', d.id))
    ? global === null ? null : { on: global, source: 'global', dashboardId: d.id }
    : base;
  const strip = (level: 'tab' | 'folder', n: { id: string }) => (removed.has(keyOf(d.id, level, n.id)) ? without(n) : n);
  return tiles.map((it) => {
    const tile = it.node as LayoutNode;
    return resolveStatusChecks(
      b,
      strip('tab', it.tab),
      it.folders.map((f) => strip('folder', f)),
      removed.has(keyOf(d.id, 'tile', tile.id)) ? without(tile) : tile
    );
  });
}

/** Which of `tiles` start and stop, given their resolutions now (`before`) and with `removed` restored. */
function diff(
  d: LayoutDashboard, tiles: Item[], before: (Resolution | null)[], base: DashboardBase | null,
  global: boolean | null, removed: Set<string>
) {
  const after = resolveTiles(d, tiles, base, global, removed);
  const start: TileRef[] = [];
  const stop: TileRef[] = [];
  tiles.forEach((it, i) => {
    const b = before[i];
    const a = after[i];
    if (!b || !a) return; // unknown: never counted
    if (!b.on && a.on) start.push(refOf(d, it));
    else if (b.on && !a.on) stop.push(refOf(d, it));
  });
  return { start, stop };
}

export function findOverrides(dashboards: LayoutDashboard[], bases: Bases, global: boolean | null): OverrideRow[] {
  const rows: OverrideRow[] = [];
  for (const d of dashboards) {
    const base = bases[d.id] ?? null;
    const items = walk(d);
    const tiles = checkableTiles(items);
    // Each tile resolved once as it is now; every row's effect is measured against this.
    const before = resolveTiles(d, tiles, base, global, new Set());
    const push = (r: Omit<OverrideRow, 'key' | 'dashboardId' | 'changes' | 'effect'>, effect: Effect | null) => {
      rows.push({
        ...r, key: keyOf(d.id, r.level, r.id), dashboardId: d.id, effect,
        changes: r.now === 'invalid' || (effect ? effect.start + effect.stop > 0 : false)
      });
    };
    // Restoring a container re-resolves only the tiles under it (or, for the dashboard, all of them).
    const containerEffect = (key: string, under: (it: Item) => boolean): Effect => {
      const idx = tiles.flatMap((it, i) => (under(it) ? [i] : []));
      const { start, stop } = diff(d, idx.map((i) => tiles[i]), idx.map((i) => before[i]), base, global, new Set([key]));
      return { start: start.length, stop: stop.length };
    };

    if (base && base.source === 'dashboard') {
      push({
        level: 'dashboard', id: d.id, path: [], now: base.on ? 'on' : 'off',
        inherited: global === null ? null : { on: global, source: 'global', sourceId: '' }
      }, global === null ? null : containerEffect(keyOf(d.id, 'dashboard', d.id), () => true));
    }
    for (const it of items) {
      const s = settingOf(it);
      if (s === 'inherit') continue;
      if (it.level === 'tile' && !isCheckableTile(it.node as { type?: unknown; url?: unknown })) continue;
      const id = (it.node as { id: string }).id;
      // What this level would get if it inherited: the levels above it, tile = null.
      const tab = it.level === 'tab' ? null : it.tab; // it.folders already excludes the folder itself
      const inherited = base ? resolveStatusChecks(base, tab, it.folders, null) : null;
      let effect: Effect | null = null;
      if (base && inherited) {
        if (it.level === 'tile') {
          // A tile without its own setting resolves to exactly `inherited`, so compare directly.
          const now = before[tiles.indexOf(it)];
          effect = { start: now && !now.on && inherited.on ? 1 : 0, stop: now && now.on && !inherited.on ? 1 : 0 };
        } else {
          const node = it.node;
          effect = containerEffect(keyOf(d.id, it.level, id), it.level === 'tab'
            ? (t) => t.tab === node
            : (t) => t.folders.includes(node as FolderNode));
        }
      }
      push({ level: it.level, id, path: it.path, now: nowOf(s), inherited }, effect);
    }
  }
  return rows;
}

/** Which tiles would start and which would stop being checked if the keyed rows went back to Inherit. */
export function previewRestore(
  dashboards: LayoutDashboard[], bases: Bases, global: boolean | null, keys: string[]
): { start: TileRef[]; stop: TileRef[] } {
  const start: TileRef[] = [];
  const stop: TileRef[] = [];
  const wanted = new Set(keys);
  for (const d of dashboards) {
    const base = bases[d.id] ?? null;
    if (!base) continue;
    const mine = new Set<string>();
    for (const k of wanted) {
      if (!k.startsWith(`${d.id}:`)) continue;
      // The dashboard row can only be restored when the global value it falls to is known.
      if (k === keyOf(d.id, 'dashboard', d.id) && global === null) continue;
      mine.add(k);
    }
    if (!mine.size) continue;
    const tiles = checkableTiles(walk(d));
    const r = diff(d, tiles, resolveTiles(d, tiles, base, global, new Set()), base, global, mine);
    start.push(...r.start);
    stop.push(...r.stop);
  }
  return { start, stop };
}

/** A copy of the dashboard with the keyed tab, folder and tile settings back to Inherit. */
export function withInheritanceRestored(d: LayoutDashboard, keys: string[]): LayoutDashboard {
  const out = structuredClone(d);
  const wanted = new Set(keys);
  for (const it of walk(out)) {
    const n = it.node as unknown as Record<string, unknown> & { id: string };
    if (!wanted.has(keyOf(out.id, it.level, n.id))) continue;
    if (it.level === 'tile') {
      const sc = n.statusCheck;
      if (sc && typeof sc === 'object' && !Array.isArray(sc)) {
        const rest = { ...(sc as Record<string, unknown>) };
        delete rest.enabled;
        if (Object.keys(rest).length) n.statusCheck = rest;
        else delete n.statusCheck;
      } else {
        delete n.statusCheck; // an invalid scalar: restoring means no setting at all
      }
    } else {
      delete n.statusChecksEnabled;
    }
  }
  return out;
}
