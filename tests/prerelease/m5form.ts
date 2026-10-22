/**
 * Test-only: put a spec's hand-written v3 dashboard into the M5 stored form (layoutVersion 1) before
 * it is imported. The server has no v3→v3 update (M5 §2a) and refuses any other form, so the specs'
 * older fixtures (12-column grids, free tabs, folder contents with placements) go through this.
 *
 * - every tab is a 24-column grid: a 12-column tab is doubled; a free tab is divided by one
 *   dashboard cell (round(designWidth / 12 / 8) / 2 design units, 6.5 at 1280);
 * - a tile on a tab takes its Size's span (S 1, M 2, L 4); a folder keeps its (converted) box;
 *   anything that would overlap or leave the grid goes to the first free cell, in reading order;
 * - folder contents become an ordered list (reading order of their old placements) with no
 *   placements; folders get `size` and `contentSize` (Medium unless set);
 * - `layout`, `designWidth`, `defaultLayout` and content `columns` are removed.
 * A dashboard already in the M5 form passes through unchanged in shape.
 */
type Json = Record<string, unknown>;
type P = { x: number; y: number; w: number; h: number; z?: number };

export const LAYOUT_VERSION = 1;
const COLS = 24;
const SPAN: Record<string, number> = { small: 1, medium: 2, large: 4 };
const span = (size: unknown) => SPAN[String(size)] ?? 2;
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

function readingOrder(kids: Json[]): Json[] {
  return kids
    .map((n, i) => ({ n, i, p: n.placement as P | undefined }))
    .sort((a, b) => {
      if (!a.p || !b.p) return (a.p ? 0 : 1) - (b.p ? 0 : 1) || a.i - b.i;
      return a.p.y - b.p.y || a.p.x - b.p.x || a.i - b.i;
    })
    .map((e) => e.n);
}

/** A node as it sits inside a folder: no placement; a sub-folder in the M5 shape. */
function inFolder(n: Json): Json {
  const out: Json = { ...n };
  delete out.placement;
  delete out.layout;
  if (out.kind === 'folder') return folderShape(out);
  return out;
}

function folderShape(f: Json): Json {
  const out: Json = { ...f, size: f.size ?? 'medium', contentSize: f.contentSize ?? 'medium' };
  delete out.layout;
  const content = (f.content ?? {}) as Json;
  const kids = Array.isArray(content.children) ? (content.children as Json[]) : [];
  out.content = { children: readingOrder(kids).map(inFolder) };
  return out;
}

const overlaps = (a: P, b: P) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function firstFree(taken: P[], w: number, h: number): P {
  for (let y = 0; ; y++) {
    for (let x = 0; x + w <= COLS; x++) {
      const c = { x, y, w, h };
      if (!taken.some((t) => overlaps(c, t))) return c;
    }
  }
}

function tabShape(t: Json): Json {
  const root = (t.root ?? {}) as Json;
  const cols = num(root.columns, COLS);
  const free = t.layout === 'free' || cols > COLS;
  const side = free ? Math.max(1, Math.round(num(t.designWidth, 1280) / 12 / 8)) / 2 : 1;
  const scale = (v: number) => (free ? Math.round(v / side) : cols === 12 ? v * 2 : v);
  const kids = Array.isArray(root.children) ? (root.children as Json[]) : [];
  const taken: P[] = [];
  const children = readingOrder(kids).map((n) => {
    const p = (n.placement ?? { x: 0, y: 0, w: 2, h: 2 }) as P;
    let w = n.kind === 'tile' ? span(n.size) : Math.max(1, scale(num(p.w, 2)));
    let h = n.kind === 'tile' ? span(n.size) : Math.max(1, scale(num(p.h, 2)));
    w = Math.min(w, COLS);
    h = Math.max(1, h);
    let q: P = { x: Math.max(0, Math.min(scale(num(p.x, 0)), COLS - w)), y: Math.max(0, scale(num(p.y, 0))), w, h };
    if (taken.some((o) => overlaps(o, q))) q = firstFree(taken, w, h);
    if (p.z !== undefined) q.z = p.z;
    taken.push(q);
    const node: Json = n.kind === 'folder' ? folderShape(n) : { ...n };
    delete node.layout;
    node.placement = q;
    return node;
  });
  const out: Json = { ...t, root: { columns: COLS, children } };
  delete out.layout;
  delete out.designWidth;
  return out;
}

/** One dashboard in the M5 stored form. */
export function toM5Dashboard<T extends Json>(d: T): T {
  const out: Json = { ...d, tabs: ((d.tabs ?? []) as Json[]).map(tabShape) };
  delete out.defaultLayout;
  if (out.settings && typeof out.settings === 'object') {
    const s = { ...(out.settings as Json) };
    delete s.defaultLayout;
    out.settings = s;
  }
  return out as T;
}

/** An import bundle's `config` for these dashboards, in the M5 form. */
export function m5Config(dashboards: Json[]): Json {
  return { layoutVersion: LAYOUT_VERSION, dashboards: dashboards.map(toM5Dashboard) };
}
