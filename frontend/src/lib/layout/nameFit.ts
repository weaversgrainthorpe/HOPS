/**
 * Fitting a tile's name to its width (TileContent): the widest word, in em at the name's weight, so a
 * long word can shrink to fit before it breaks; and a word's camel-case parts, where a Small name may
 * break ("Home / Assistant") instead of mid-word.
 */

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

/** One word's width in em at the name's weight (measured once, cached). */
function wordEm(word: string): number {
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

const words = (name: string) => String(name ?? '').trim().split(/\s+/).filter(Boolean);

/**
 * A word's camel-case parts: it may break where a capital follows a lower-case letter
 * ("HomeAssistant" → "Home", "Assistant"), so a long name breaks between its words, never mid-word.
 */
export function camelParts(word: string): string[] {
  return String(word ?? '').split(/(?<=[a-z])(?=[A-Z])/);
}

/** The width of `name`'s widest word, in em at the name's weight (1 for an empty name). */
export function longestWordEm(name: string): number {
  const ws = words(name);
  return ws.length === 0 ? 1 : Math.max(...ws.map(wordEm));
}

/** The width of `name`'s widest camel-case part (see camelParts), in em (1 for an empty name). */
export function widestSegmentEm(name: string): number {
  const ws = words(name).flatMap(camelParts).filter(Boolean);
  return ws.length === 0 ? 1 : Math.max(...ws.map(wordEm));
}
