import type { Page } from '@playwright/test';

// Measure the app's animations through the Web Animations API itself, not by sampling frames.
//
// Why: sampling getBoundingClientRect() in a requestAnimationFrame loop measures how often the page
// got a frame, not the animation. Under load (the full suite, a busy machine) frames are starved:
// a 300 ms animation may be sampled two or three times, so the peak of a scale or a hop is missed and
// the "on screen" time between the first and last sample comes out short. The animation still played
// in full; the sampler just didn't see it.
//
// Instead, every element.animate() call is recorded as it is made: its target, its declared timing
// and keyframes (the travel and scale it really draws), and how it ended: 'finished' (ran to its end
// on the document timeline) or 'cancelled' (cut short: interrupted, the fallback timer, the setting).
// Times are document-timeline times (the clock the animation itself runs on), so the time an
// animation ran is measured on the same clock that drives it, and a page.clock install can't skew it.

export type Kf = { offset: number; transform?: string; opacity?: number };
export type WaapiRecord = {
  n: number;
  /** What it animates: 'ghost:<kind>' (a drop animation ghost), 'gulp' / 'pop' / 'release', a flourish kind, or 'other'. */
  what: string;
  /** The target's node id (data-node-id, data-nested-folder, data-folder-page-content), or 'saved' / 'status' / ''. */
  id: string;
  duration: number;
  delay: number;
  /** delay + duration: when it is declared to end, from its start. */
  endTime: number;
  keyframes: Kf[];
  /** A ghost's box when its animation started (inline: ghosts are position:fixed at left/top). */
  box?: { left: number; top: number; width: number; height: number };
  /** Document-timeline times: when it was created, when it started playing, when it ended. */
  createdAt: number;
  startTime: number | null;
  endedAt: number | null;
  state: 'running' | 'finished' | 'cancelled';
};

/** Install the recorder (before the page loads). */
export async function recordWaapi(page: Page) {
  await page.addInitScript(() => {
    type Rec = Record<string, unknown> & { state: string };
    const recs: Rec[] = [];
    (window as unknown as { __waapi: Rec[] }).__waapi = recs;
    const now = () => Number(document.timeline.currentTime ?? 0);
    const orig = Element.prototype.animate;
    Element.prototype.animate = function (this: Element, frames: Keyframe[] | PropertyIndexedKeyframes | null, opts?: number | KeyframeAnimationOptions) {
      const a = orig.call(this, frames, opts);
      try {
        const el = this as HTMLElement;
        const t = a.effect!.getComputedTiming();
        const rec: Rec = {
          n: recs.length, what: 'other', id: '',
          duration: Number(t.duration), delay: Number(t.delay ?? 0), endTime: Number(t.endTime),
          keyframes: (a.effect as KeyframeEffect).getKeyframes().map((k) => ({
            offset: Number(k.computedOffset),
            ...(k.transform !== undefined ? { transform: String(k.transform) } : {}),
            ...(k.opacity !== undefined ? { opacity: Number(k.opacity) } : {})
          })),
          createdAt: now(), startTime: null, endedAt: null, state: 'running'
        };
        if (el.dataset?.testid === 'drop-anim') {
          rec.box = { left: parseFloat(el.style.left), top: parseFloat(el.style.top), width: parseFloat(el.style.width), height: parseFloat(el.style.height) };
        }
        recs.push(rec);
        // What it is: resolved once the caller has marked the element (data-flourish is set just after animate()).
        queueMicrotask(() => {
          rec.what =
            el.dataset?.testid === 'drop-anim' ? `ghost:${el.dataset.kind}` :
            el.dataset?.testid === 'flourish-ghost' ? (el.dataset.kind ?? 'flourish-ghost') :
            el.getAttribute('data-flourish') ??
            (el.hasAttribute('data-drop-gulp') ? 'gulp' : el.hasAttribute('data-drop-pop') ? 'pop' :
              el.hasAttribute('data-drop-release') ? 'release' : 'other');
          rec.id = el.getAttribute('data-node-id') ?? el.getAttribute('data-nested-folder') ?? el.getAttribute('data-folder-page-content') ??
            (el.hasAttribute('data-saved-tick') ? 'saved' : el.classList.contains('status-badge') ? 'status' : '');
        });
        a.ready.then(() => { rec.startTime = a.startTime === null ? null : Number(a.startTime); }, () => {});
        a.finished.then(
          () => { if (rec.state === 'running') { rec.state = 'finished'; rec.endedAt = now(); } },
          () => { if (rec.state === 'running') { rec.state = 'cancelled'; rec.endedAt = now(); } }
        );
      } catch {
        /* recording must never change what the page does */
      }
      return a;
    };
  });
}

export const waapi = (page: Page) =>
  page.evaluate(() => JSON.parse(JSON.stringify((window as unknown as { __waapi: unknown[] }).__waapi)) as WaapiRecord[]);
export const clearWaapi = (page: Page) =>
  page.evaluate(() => { (window as unknown as { __waapi: unknown[] }).__waapi.length = 0; });

/** Wait (on the page's own schedule, however slow) until every recorded animation has ended (an endless one never does: skipped). */
export async function waapiSettled(page: Page, timeout = 10_000) {
  await page.waitForFunction(
    () => (window as unknown as { __waapi: { state: string; endTime: number }[] }).__waapi.every((r) => r.state !== 'running' || !Number.isFinite(r.endTime)),
    undefined, { timeout, polling: 50 }
  );
}

/** A transform's translation and scale (translate / translateX / translateY / scale, or none). */
export function parseTransform(t: string | undefined): { x: number; y: number; sx: number; sy: number } {
  const out = { x: 0, y: 0, sx: 1, sy: 1 };
  if (!t || t === 'none') return out;
  for (const m of t.matchAll(/(translate|translateX|translateY|scale)\(([^)]*)\)/g)) {
    const v = m[2].split(',').map((s) => parseFloat(s));
    if (m[1] === 'translate') { out.x += v[0]; out.y += v[1] ?? 0; }
    else if (m[1] === 'translateX') out.x += v[0];
    else if (m[1] === 'translateY') out.y += v[0];
    else { out.sx *= v[0]; out.sy *= v[1] ?? v[0]; }
  }
  return out;
}

/**
 * What one animation draws, from its keyframes: the furthest its centre travels from where it starts
 * (counting only keyframes at least `minOpacity` opaque), the largest size change against where it
 * starts or ends (a ratio, as `|scale - 1|`), and its opacity range.
 */
export function drawn(r: WaapiRecord, minOpacity = 0) {
  const ks = r.keyframes.map((k) => ({ ...parseTransform(k.transform), op: k.opacity ?? 1 }));
  const first = ks[0], last = ks[ks.length - 1];
  let travel = 0, scale = 0, minOp = 1, maxOp = 0;
  for (const k of ks) {
    if (k.op >= minOpacity) travel = Math.max(travel, Math.hypot(k.x - first.x, k.y - first.y));
    scale = Math.max(scale,
      Math.abs(k.sx / last.sx - 1), Math.abs(k.sy / last.sy - 1),
      Math.abs(k.sx / first.sx - 1), Math.abs(k.sy / first.sy - 1));
    minOp = Math.min(minOp, k.op);
    maxOp = Math.max(maxOp, k.op);
  }
  return { travel, scale, minOp, maxOp, first, last };
}

/** How long it ran on the document timeline, start to its end (0 if it never ended). */
export const ran = (r: WaapiRecord) =>
  r.endedAt === null ? 0 : r.endedAt - (r.startTime ?? r.createdAt);

/**
 * It reached its declared end: it finished; or (only on a starved machine, where the browser is
 * late to report an end) it was ended by its safety net at or after its declared end on its own
 * timeline, so all of it played. A net (or anything else) that ends it BEFORE its declared end is
 * never accepted: that animation was cut short.
 */
export const reachedEnd = (r: WaapiRecord) =>
  r.state === 'finished' ||
  (r.state === 'cancelled' && r.endedAt !== null && r.endedAt >= (r.startTime ?? r.createdAt) + r.endTime);

/** How a drop animation's ghost ended is accepted as its end: 'finished', or 'safety-net' when every animation reached its declared end. */
export const endedAtItsEnd = (ended: string | undefined, recs: WaapiRecord[]) =>
  ended === 'finished' || (ended === 'safety-net' && recs.length > 0 && recs.every(reachedEnd));
