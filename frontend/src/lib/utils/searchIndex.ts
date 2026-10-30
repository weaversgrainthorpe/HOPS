import type { Entry } from '$lib/types';
import type { Container, FolderNode, LayoutDoc } from '$lib/types/layout';

/** One searchable thing: a tile or a folder, anywhere on any tab at any depth. */
export type SearchItem = {
  kind: 'tile' | 'folder';
  id: string;
  name: string;
  /** Set for tiles. */
  entry?: Entry;
  dashboardId: string;
  dashboardPath: string;
  dashboardName: string;
  tabId: string;
  /** Plain text "Tab › Folder › Sub › Name" (rendered as text, never markup). */
  path: string;
  /**
   * Folders to open, outermost first. A tile: every folder enclosing it. A folder: its enclosing
   * folders and itself (so showing it opens it).
   */
  folderIds: string[];
  /** Lower-cased match fields, computed once when the index is built. */
  lname: string;
  lhost: string;
  ldesc: string;
  lurl: string;
};

const SEP = ' › ';

/** "host:port" of a URL, or '' when it isn't a parseable URL. */
export function hostOf(url: string | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

function fields(name: string, entry?: Entry) {
  const url = typeof entry?.url === 'string' ? entry.url : '';
  return {
    lname: name.toLowerCase(),
    lhost: hostOf(url).toLowerCase(),
    ldesc: (typeof entry?.description === 'string' ? entry.description : '').toLowerCase(),
    lurl: url.toLowerCase()
  };
}

/** Index every tile and folder of the document (one dashboard, or all when none is given). Built once per open. */
export function buildSearchIndex(doc: LayoutDoc | null, onlyDashboardId?: string): SearchItem[] {
  if (!doc) return [];
  const out: SearchItem[] = [];
  for (const d of doc.dashboards ?? []) {
    if (onlyDashboardId !== undefined && d.id !== onlyDashboardId) continue;
    for (const t of d.tabs ?? []) {
      const base = { dashboardId: d.id, dashboardPath: d.path, dashboardName: d.name, tabId: t.id };
      const walk = (c: Container | undefined, chain: FolderNode[]) => {
        const kids = Array.isArray(c?.children) ? c!.children : [];
        for (const n of kids) {
          if (!n || typeof n !== 'object') continue;
          if (n.kind === 'folder' && typeof n.id === 'string') {
            const here = [...chain, n];
            const name = typeof n.name === 'string' ? n.name : '';
            out.push({
              kind: 'folder', id: n.id, name, ...base,
              path: [t.name, ...here.map((f) => f.name)].join(SEP),
              folderIds: here.map((f) => f.id),
              ...fields(name)
            });
            walk(n.content, here);
          } else if (n.kind === 'tile' && typeof n.id === 'string') {
            const name = typeof n.name === 'string' ? n.name : '';
            out.push({
              kind: 'tile', id: n.id, name, entry: n, ...base,
              path: [t.name, ...chain.map((f) => f.name), name].join(SEP),
              folderIds: chain.map((f) => f.id),
              ...fields(name, n)
            });
          }
        }
      };
      walk(t.root, []);
    }
  }
  return out;
}

/** Lower is better; -1 = no match. */
function score(r: SearchItem, q: string): number {
  if (r.lname === q) return 0;
  if (r.lname.startsWith(q)) return 1;
  if (r.lname.includes(q)) return 2;
  if (r.lhost.includes(q)) return 3;
  if (r.ldesc.includes(q)) return 4;
  if (r.lurl.includes(q)) return 5;
  return -1;
}

/**
 * Matches best first (stable within a rank, so layout order breaks ties), at most `cap`, and how
 * many matched in all — so a capped list can say it is capped.
 */
export function rankSearch(index: SearchItem[], query: string, cap: number): { items: SearchItem[]; total: number } {
  const q = query.trim().toLowerCase();
  if (!q) return { items: [], total: 0 };
  const hits: Array<[number, number, SearchItem]> = [];
  for (let i = 0; i < index.length; i++) {
    const s = score(index[i], q);
    if (s >= 0) hits.push([s, i, index[i]]);
  }
  hits.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return { items: hits.slice(0, cap).map((h) => h[2]), total: hits.length };
}
