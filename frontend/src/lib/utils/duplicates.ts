import type { LayoutDoc, LayoutDashboard, LayoutNode, Container } from '$lib/types/layout';

/**
 * Duplicate finder: tiles that point at the same address. The address is compared after
 * normalising: scheme and host lower-cased, default port removed, trailing slash removed.
 * `www.` is NOT stripped (a different host), and the away address is ignored for grouping.
 */

/** The comparison key for an address, or null when it is empty or not a parseable URL. */
export function normalizeAddress(raw: string | undefined | null): string | null {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s) return null;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  const scheme = u.protocol.toLowerCase(); // "https:"
  const host = u.hostname.toLowerCase();
  const defaults: Record<string, string> = { 'http:': '80', 'https:': '443', 'ssh:': '22', 'ftp:': '21' };
  const port = u.port && u.port !== defaults[scheme] ? `:${u.port}` : '';
  const path = u.pathname.replace(/\/+$/, '');
  const userinfo = u.username ? `${u.username}${u.password ? ':' + u.password : ''}@` : '';
  return `${scheme}//${userinfo}${host}${port}${path}${u.search}${u.hash}`;
}

export interface DupTile {
  id: string;
  name: string;
  icon: string;
  iconUrl?: string;
  openMode: string;
  url: string;
  awayUrl: string;
  dashboardId: string;
  dashboardPath: string;
  dashboardName: string;
  tabId: string;
  /** Enclosing folders, outermost first. */
  folderIds: string[];
  /** Dashboard, tab, then each folder name. */
  path: string[];
}

export interface DupGroup {
  /** The normalised address shared by every tile. */
  address: string;
  tiles: DupTile[];
}

export interface DupReport {
  groups: DupGroup[];
  /** Every tile looked at, with or without an address. */
  totalTiles: number;
}

export function findDuplicates(doc: LayoutDoc | null | undefined): DupReport {
  const by = new Map<string, DupTile[]>();
  let totalTiles = 0;
  for (const d of doc?.dashboards ?? []) {
    for (const t of d.tabs ?? []) {
      const walk = (c: Container | undefined, chain: Array<{ id: string; name: string }>) => {
        const kids = Array.isArray(c?.children) ? c!.children : [];
        for (const n of kids) {
          if (!n || typeof n !== 'object') continue;
          if (n.kind === 'folder') {
            walk(n.content, [...chain, { id: n.id, name: typeof n.name === 'string' ? n.name : '' }]);
          } else if (n.kind === 'tile') {
            totalTiles++;
            const key = normalizeAddress(n.url);
            if (key === null) continue;
            const tile: DupTile = {
              id: n.id,
              name: typeof n.name === 'string' ? n.name : '',
              icon: typeof n.icon === 'string' ? n.icon : '',
              ...(typeof n.iconUrl === 'string' && n.iconUrl ? { iconUrl: n.iconUrl } : {}),
              openMode: typeof n.openMode === 'string' ? n.openMode : '',
              url: n.url,
              awayUrl: typeof n.awayUrl === 'string' ? n.awayUrl : '',
              dashboardId: d.id,
              dashboardPath: d.path,
              dashboardName: d.name,
              tabId: t.id,
              folderIds: chain.map((f) => f.id),
              path: [d.name, t.name, ...chain.map((f) => f.name)]
            };
            const list = by.get(key);
            if (list) list.push(tile);
            else by.set(key, [tile]);
          }
        }
      };
      walk(t.root, []);
    }
  }
  const groups: DupGroup[] = [];
  for (const [address, tiles] of by) if (tiles.length > 1) groups.push({ address, tiles });
  return { groups, totalTiles };
}

/** A copy of the dashboard without the tiles whose ids are given (any tab, any folder depth). */
export function removeTiles(d: LayoutDashboard, ids: ReadonlySet<string>): LayoutDashboard {
  const prune = (c: Container): Container => ({
    ...c,
    children: (c.children ?? [])
      .filter((n) => !(n.kind === 'tile' && ids.has(n.id)))
      .map((n): LayoutNode => (n.kind === 'folder' ? { ...n, content: prune(n.content) } : n))
  });
  return { ...d, tabs: d.tabs.map((t) => ({ ...t, root: prune(t.root) })) };
}
