/**
 * Status-check overrides across the dashboards (rc5 design, "The page"): which levels set an
 * explicit On/Off/invalid value, and what restoring them to Inherit would change. Pure: the page
 * (Task 5) supplies the layouts and the dashboard bases. All resolution goes through
 * resolveStatusChecks, so this can never drift from the dialogs or the checker.
 */
import type { FolderNode, LayoutDashboard, LayoutNode, LayoutTab } from '$lib/types/layout';
import {
  containerSetting, resolveStatusChecks, tileSetting, type DashboardBase, type Resolution
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

/** Every tile of one dashboard, resolved with the keyed settings removed (or as they are, with none). */
function resolveTiles(
  d: LayoutDashboard, items: Item[], base: DashboardBase | null, global: boolean | null, removed: Set<string>
): { ref: TileRef; res: Resolution | null }[] {
  // Restoring the dashboard override makes the dashboard level fall to the global setting.
  const b: DashboardBase | null = removed.has(keyOf(d.id, 'dashboard', d.id))
    ? global === null ? null : { on: global, source: 'global', dashboardId: d.id }
    : base;
  const strip = (level: 'tab' | 'folder', n: { id: string }) => (removed.has(keyOf(d.id, level, n.id)) ? without(n) : n);
  return items.filter((it) => it.level === 'tile').map((it) => {
    const tile = it.node as LayoutNode;
    const res = resolveStatusChecks(
      b,
      strip('tab', it.tab),
      it.folders.map((f) => strip('folder', f)),
      removed.has(keyOf(d.id, 'tile', tile.id)) ? without(tile) : tile
    );
    return { ref: { dashboardId: d.id, id: tile.id, path: it.path }, res };
  });
}

function diff(d: LayoutDashboard, items: Item[], base: DashboardBase | null, global: boolean | null, removed: Set<string>) {
  const before = resolveTiles(d, items, base, global, new Set());
  const after = resolveTiles(d, items, base, global, removed);
  const start: TileRef[] = [];
  const stop: TileRef[] = [];
  before.forEach((b, i) => {
    const a = after[i];
    if (!b.res || !a.res) return; // unknown: never counted
    if (!b.res.on && a.res.on) start.push(a.ref);
    else if (b.res.on && !a.res.on) stop.push(a.ref);
  });
  return { start, stop };
}

export function findOverrides(dashboards: LayoutDashboard[], bases: Bases, global: boolean | null): OverrideRow[] {
  const rows: OverrideRow[] = [];
  for (const d of dashboards) {
    const base = bases[d.id] ?? null;
    const items = walk(d);
    const effectOf = (key: string, canKnow: boolean): Effect | null => {
      if (!canKnow) return null;
      const { start, stop } = diff(d, items, base, global, new Set([key]));
      return { start: start.length, stop: stop.length };
    };
    const push = (r: Omit<OverrideRow, 'key' | 'dashboardId' | 'changes' | 'effect'>, canKnow: boolean) => {
      const key = keyOf(d.id, r.level, r.id);
      const effect = effectOf(key, canKnow);
      rows.push({
        ...r, key, dashboardId: d.id, effect,
        changes: r.now === 'invalid' || (effect ? effect.start + effect.stop > 0 : false)
      });
    };

    if (base && base.source === 'dashboard') {
      push({
        level: 'dashboard', id: d.id, path: [], now: base.on ? 'on' : 'off',
        inherited: global === null ? null : { on: global, source: 'global', sourceId: '' }
      }, global !== null);
    }
    for (const it of items) {
      const s = settingOf(it);
      if (s === 'inherit') continue;
      const id = (it.node as { id: string }).id;
      // What this level would get if it inherited: the levels above it, tile = null.
      const tab = it.level === 'tab' ? null : it.tab; // it.folders already excludes the folder itself
      push({
        level: it.level, id, path: it.path, now: nowOf(s),
        inherited: base ? resolveStatusChecks(base, tab, it.folders, null) : null
      }, !!base);
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
    const r = diff(d, walk(d), base, global, mine);
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
