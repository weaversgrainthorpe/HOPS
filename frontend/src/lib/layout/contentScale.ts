/**
 * The dashboard's "Tile content size" (stored as `contentScale`, in %): what is drawn inside every
 * tile and minimised folder on the dashboard (icon, name, description) scales by it. Boxes, grid
 * positions and folder boxes never change. Twin of configdoc/contentscale.go.
 */
export const CONTENT_SCALE = { min: 75, max: 125, step: 5, normal: 100 } as const;

const valid = (v: unknown): v is number =>
  typeof v === 'number' &&
  Number.isInteger(v) &&
  v >= CONTENT_SCALE.min &&
  v <= CONTENT_SCALE.max &&
  v % CONTENT_SCALE.step === 0;

/**
 * The scale as drawn, in %: a missing field is 100. A value the server would refuse is drawn at 100
 * too: a draw-time fallback (like sizeOf), never a conversion of stored data. The server refuses it.
 */
export function contentScaleOf(v: unknown): number {
  return valid(v) ? v : CONTENT_SCALE.normal;
}

/** Why the server would refuse this value, or null (a missing field is fine: it means 100). */
export function contentScaleProblem(v: unknown): string | null {
  if (v === undefined || valid(v)) return null;
  return 'The tile content size must be a whole number from 75 to 125, in steps of 5. It is drawn at 100% until it is fixed.';
}

// ---- a name's longest word, in em: a single long word shrinks its font to fit the tile's width

/** The name's weight and family, as TileContent draws it (600, the page's font). */
let ctx: CanvasRenderingContext2D | null | undefined;
const cache = new Map<string, number>();
/** An average semibold letter is about 0.6 em wide: the estimate when there is no canvas to measure with. */
const EST_EM_PER_CHAR = 0.6;

function measurer(): CanvasRenderingContext2D | null {
  if (ctx !== undefined) return ctx;
  ctx = null;
  try {
    if (typeof document === 'undefined') return ctx;
    const c = document.createElement('canvas').getContext('2d');
    if (c && typeof c.measureText === 'function') {
      const family = getComputedStyle(document.body).fontFamily || 'system-ui, sans-serif';
      c.font = `600 100px ${family}`;
      ctx = c;
    }
  } catch {
    // No canvas (tests, a locked-down browser): the estimate below is used, which only sizes text.
    ctx = null;
  }
  return ctx;
}

/** The width of `name`'s longest word, in em at the name's weight (1 for an empty name). */
export function longestWordEm(name: string): number {
  const words = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 1;
  const word = words.reduce((a, b) => (b.length > a.length ? b : a));
  const hit = cache.get(word);
  if (hit !== undefined) return hit;
  const m = measurer();
  let em = word.length * EST_EM_PER_CHAR;
  if (m) {
    const w = m.measureText(word).width / 100;
    if (Number.isFinite(w) && w > 0) em = w;
  }
  em = Math.max(1, Math.round(em * 1000) / 1000);
  cache.set(word, em);
  return em;
}
