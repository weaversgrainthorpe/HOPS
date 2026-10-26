/**
 * Drop and merge animations (M6 §7.13, Ruling 5). Decoration only:
 *
 * - The drop's change is applied to the draft BEFORE anything here runs (commitDrop calls this after
 *   apply succeeded), so an animation can never delay, block or lose an edit, and Undo works at any
 *   moment. Everything drawn here is a detached ghost in its own layer on <body> (or a transform on
 *   the folder's own element); the draft is never read back from it.
 * - Clearly visible, about 500 ms (Ruling 5; the first version's 240–300 ms shrink in place, started
 *   where the drop already was, was hardly seen). Transforms and opacity only, run through the Web
 *   Animations API (composited: no layout thrash and no filters, Tenet 4).
 *   - Into a folder: the dropped tile flies along a curve into the folder (a hop up and in, so it
 *     visibly travels even when dropped right on it), shrinking and fading there; the folder (or its
 *     tile, or a drilled-in inner box) then gulps (scale 1 → 0.94 → 1).
 *   - Merge: the dragged tile and the target tile part a little, then are drawn together onto the new
 *     folder, which pops in (scale 0.6 → 1.05 → 1). The folder dialog opens when it has ended.
 *   - Out of a folder (§8.1: to the tab, another folder or an outer box, by drag or menu Move/Copy):
 *     the source folder (or box) puffs (a small scale-up, capped like the gulp) as the item rises out
 *     of where it was, then hops on a curve to its new spot, where the item is revealed as it lands;
 *     into a folder where it isn't drawn, it shrinks into that folder, which gulps. When the source is
 *     no longer drawn because it lives on another tab (a drag that dwelt on a tab button switched the
 *     tab), the item starts from that tab's BUTTON in the tab bar, which puffs; if that button isn't
 *     drawn either (a phone layout), the item drops in onto its spot from at least MIN_LAND_PX away,
 *     with a small settle. It never "travels" 0 px.
 * - The global "Animations" setting (display.animations, Settings → Global settings) is On / Off /
 *   Always. On plays unless the device asks for reduced motion (the setting then says so, visibly);
 *   Always plays even then; Off never. The editor reads it from each dashboard's server-computed
 *   `display` block; until it is known it is off (never a guessed animation).
 * - A browser without element.animate simply gets no animation. An animation that throws is cleaned
 *   up and said once per page (a toast), never silently swallowed; the edit is untouched either way.
 */
import { get } from 'svelte/store';
import { config } from '$lib/stores/config';
import { toast } from '$lib/stores/toast';
import { logError } from '$lib/utils/errors';

/** Into a folder: the tile's flight. */
export const DROP_MS = 440;
/** …then the folder's gulp, starting as the tile arrives (counted from the drop). */
export const GULP_DELAY_MS = 360;
export const GULP_MS = 180;
/** The gulp is a 6% squeeze, but a big folder's edges never move more than this. */
export const GULP_MAX_EDGE_PX = 6;

/** The gulp's smallest scale for a target this size: 0.94, or less of a squeeze for big folders. */
export function gulpScale(width: number, height: number): number {
  return Math.max(0.94, 1 - (2 * GULP_MAX_EDGE_PX) / Math.max(1, width, height));
}
export const INTO_TOTAL_MS = Math.max(DROP_MS, GULP_DELAY_MS + GULP_MS);
/** Out of a folder (§8.1): the item's rise and hop… */
export const OUT_MS = 480;
/** …the source's release puff, at once… */
export const RELEASE_MS = 200;
/** …and, into another folder, its gulp as the item arrives (counted from the drop). */
export const OUT_GULP_DELAY_MS = 400;
export const OUT_TOTAL_MS = Math.max(OUT_MS, RELEASE_MS, OUT_GULP_DELAY_MS + GULP_MS);

/** The release puff's largest scale for a source this size: 1.06, or less for big folders (edges move <= GULP_MAX_EDGE_PX). */
export function releaseScale(width: number, height: number): number {
  return Math.min(1.06, 1 + (2 * GULP_MAX_EDGE_PX) / Math.max(1, width, height));
}
/** Merge: the two tiles drawn together… */
export const GATHER_MS = 320;
/** …then the new folder pops, starting as they meet (counted from the drop). */
export const POP_DELAY_MS = 260;
export const POP_MS = 260;
export const MERGE_TOTAL_MS = Math.max(GATHER_MS, POP_DELAY_MS + POP_MS);
/**
 * Ruling 3: after a merge the folder dialog opens when the animation ends. This is the latest it
 * waits if the browser never reports that end (the animation plus a frame-timing margin): the merge's
 * safety net (see safetyNet), counted from when the animation starts.
 */
export const MERGE_DIALOG_CAP_MS = MERGE_TOTAL_MS + 100;
/** The least height of the drop's hop, so a tile dropped right on its folder still visibly travels. */
const MIN_HOP_PX = 56;
/** Out of a folder with nothing of the source drawn: the drop-in starts at least this far from the spot. */
export const MIN_LAND_PX = 56;
/** …and settles this far past it before coming to rest. */
const SETTLE_PX = 6;
/**
 * How far each merged tile first moves away from the other (at least), before they are drawn
 * together: comfortably past the 40 px "visibly moves" bar, and held there for a moment (gatherFrames).
 */
const MIN_PART_PX = 60;

/**
 * The safety net for an animation whose end the browser never reports: `fire` runs `ms` after it is
 * armed, which is when the animations have been started (on their first frame), never at the drop.
 * When it is due and any of them is still playing — running and short of its end on its timeline —
 * it looks again once what remains has had time to play (plus `margin`), instead of cutting it short.
 * So a busy device (slow frames: a Pi Zero, a loaded machine) still sees every animation to its end,
 * while one that has reached its end (or stopped: paused, idle) without reporting it is ended. An
 * animation only moves on when the page draws frames; without frames nothing of it is seen either,
 * and it carries on (and ends) when they come back. Returns its clear.
 */
export function safetyNet(anims: readonly Animation[], ms: number, margin: number, fire: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const look = () => {
    let left = -1;
    for (const a of anims) {
      try {
        const t = Number(a.currentTime ?? Number.NaN);
        const end = Number(a.effect?.getComputedTiming().endTime ?? Number.NaN);
        if (a.playState === 'running' && Number.isFinite(t) && Number.isFinite(end) && t < end) left = Math.max(left, end - t);
      } catch {
        /* can't tell: not playing */
      }
    }
    if (left >= 0) {
      timer = setTimeout(look, left + margin);
      return;
    }
    fire();
  };
  timer = setTimeout(look, ms);
  return () => clearTimeout(timer);
}

/** The "Animations" setting (Ruling 5). */
export type AnimationsMode = 'on' | 'off' | 'always';

export type Box = { left: number; top: number; width: number; height: number };

export interface AnimationEnv {
  reducedMotion(): boolean;
  /** Start a WAAPI animation; null when the browser has no element.animate. */
  animate(el: HTMLElement, frames: Keyframe[], opts: KeyframeAnimationOptions): Animation | null;
  raf(cb: FrameRequestCallback): number;
  /**
   * The rendered element of a node (not one inside a dialog or an inert copy), or of a drilled-in
   * inner box (a sub-folder drawn as a level of its folder, data-nested-folder).
   */
  findNode(id: string): HTMLElement | null;
  measure(el: Element): Box;
  /** The element's own (computed) opacity, which a reveal ends at. */
  opacity(el: Element): number;
  /**
   * A tab's button in the dashboard's tab bar (data-tab-button), when it is drawn and NOT the tab now
   * shown (aria-selected); null otherwise.
   */
  findTabButton(tabId: string): HTMLElement | null;
  /**
   * §9: every item drawn on the page now (data-node-id, not inside a dialog or an inert copy), in
   * document order: the edit glide measures them once before an edit is drawn and once after.
   */
  drawnNodes(): HTMLElement[];
  /** §9: the page a folder shows (data-folder-page-content), when it is drawn. */
  findPage(folderId: string): HTMLElement | null;
}

const domEnv: AnimationEnv = {
  reducedMotion: () =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  animate: (el, frames, opts) => (typeof el.animate === 'function' ? el.animate(frames, opts) : null),
  raf: (cb) => requestAnimationFrame(cb),
  findNode: (id) => {
    const live = (attr: string) =>
      Array.from(document.querySelectorAll<HTMLElement>(`[${attr}]`)).find(
        (n) => n.getAttribute(attr) === id && !n.closest('[inert], [role="dialog"]')
      ) ?? null;
    return live('data-node-id') ?? live('data-nested-folder');
  },
  measure: (el) => el.getBoundingClientRect(),
  opacity: (el) => Number.parseFloat(getComputedStyle(el).opacity),
  findTabButton: (tabId) =>
    Array.from(document.querySelectorAll<HTMLElement>('[data-tab-button]')).find(
      (n) => n.getAttribute('data-tab-button') === tabId && n.getAttribute('aria-selected') !== 'true' &&
        !n.closest('[inert], [role="dialog"]')
    ) ?? null,
  drawnNodes: () =>
    Array.from(document.querySelectorAll<HTMLElement>('[data-node-id]')).filter((n) => !n.closest('[inert], [role="dialog"]')),
  findPage: (folderId) =>
    Array.from(document.querySelectorAll<HTMLElement>('[data-folder-page-content]')).find(
      (n) => n.getAttribute('data-folder-page-content') === folderId && !n.closest('[inert], [role="dialog"]')
    ) ?? null
};
let env: AnimationEnv = domEnv;
let failureSaid = false;
/** Every drop / merge / out animation now running: its cleanup, given why it ended. */
const live = new Set<(why: Ended) => void>();
/** Why an animation ended (on each ghost as data-ended when it is removed). */
export type Ended = 'finished' | 'safety-net' | 'failed' | 'interrupted' | 'setting';

/**
 * §9: the one engine. The visual flourishes (flourishes.ts) share this module's environment, its
 * gating (animationsAllowed) and its cancel registry, so cancelDropAnimations() stops them too.
 */
export function animationEnv(): AnimationEnv {
  return env;
}
/** §9: register a running flourish's stop; cancelDropAnimations() calls it. Returns its unregister. */
export function trackAnimation(stop: (why: Ended) => void): () => void {
  live.add(stop);
  return () => live.delete(stop);
}
/**
 * §9 "don't double-animate": items that already have their own animation for the edit being drawn
 * (the dropped or merged item, the folder that gulps or pops, a folder opening) are claimed; the
 * edit glide and pop-in skip them. A claim lasts until the frame after the next one: the glide that
 * reads it runs on the next frame, after the change has been drawn.
 */
const claims = new Set<string>();
let claimClear = 0;
export function claimFlourish(ids: Iterable<string | undefined>): void {
  for (const id of ids) if (id) claims.add(id);
  const mine = ++claimClear;
  try {
    env.raf(() => env.raf(() => {
      if (mine === claimClear) claims.clear();
    }));
  } catch {
    /* no frames: the claims stay until the next glide reads them, which is harmless */
  }
}
/** The ids claimed for the edit being drawn (read by the glide). */
export function claimedIds(): ReadonlySet<string> {
  return claims;
}
/** Called with every reset (tests): the flourishes forget their claims and pending work. */
const resetHooks = new Set<() => void>();
export function onAnimationReset(fn: () => void): void {
  resetHooks.add(fn);
}

/**
 * Stop every running drop, merge and out animation now: the ghosts are removed and every animation
 * on a real element (reveal, puff, gulp, pop) is cancelled, so each is drawn as it is (never left
 * hidden or squeezed). Each one's onEnd still runs once. Called when a new drag starts, the route
 * changes, the animation environment changes, or the editor's canvas goes away.
 */
export function cancelDropAnimations(): void {
  for (const stop of Array.from(live)) stop('interrupted');
}

/** Tests: replace parts of the browser environment (null restores it). Running animations stop. */
export function setAnimationEnv(partial: Partial<AnimationEnv> | null): void {
  cancelDropAnimations();
  // A part given as undefined keeps the browser's own.
  const own = Object.fromEntries(Object.entries(partial ?? {}).filter(([, v]) => v !== undefined));
  env = partial ? { ...domEnv, ...own } : domEnv;
}

export function resetDropAnimationForTests(): void {
  cancelDropAnimations();
  env = domEnv;
  failureSaid = false;
  claims.clear();
  resetHooks.forEach((f) => f());
  if (typeof document !== 'undefined') document.querySelectorAll('[data-testid="drop-anim"]').forEach((e) => e.remove());
}

/** The global "Animations" setting as the server computed it into the dashboard's display block. */
export function animationsSetting(dashboardId: string): AnimationsMode {
  const v: unknown = get(config)?.dashboards.find((x) => x.id === dashboardId)?.display?.animations;
  return v === 'on' || v === 'always' ? v : 'off'; // unknown: off, never a guessed animation
}

/** Always; or On while the device does not ask for reduced motion. */
export function animationsAllowed(dashboardId: string): boolean {
  const mode = animationsSetting(dashboardId);
  if (mode === 'always') return true;
  if (mode !== 'on') return false;
  try {
    return !env.reducedMotion();
  } catch {
    return false; // can't tell: no motion
  }
}

export type DropAnimation =
  | { kind: 'into'; from: Box; to: Box | (() => Box | null); label: string; folderId: string; onEnd?: () => void }
  | {
      kind: 'out';
      /**
       * Where the item was in its folder (measured before the change was drawn; see outStarts), or
       * the button of the tab it came from (sourceTab). With arrive 'drop': where the drag's ghost was
       * (or null when unknown), which the drop-in starts from when it is far enough from the spot.
       */
      from: Box | null; label: string;
      /** The folder (or drilled-in box) it left: it puffs. */
      sourceId: string;
      /** It starts from this tab's button (its source isn't drawn: it is on that tab), which puffs instead. */
      sourceTab?: string;
      /**
       * 'drop': nothing of the source is drawn, so the item drops in onto its new spot from at least
       * MIN_LAND_PX away (from above when the ghost was on it) and settles. Default 'hop'.
       */
      arrive?: 'hop' | 'drop';
      /** The item where it is now (the moved one, or the copy): it lands there when it is drawn. */
      landedId?: string;
      /** The folder it went into, if any: it gulps, and is where it lands when the item isn't drawn. */
      intoId?: string;
      /** False: the source does not puff / the destination does not gulp (another item of a multi-select does). */
      puff?: boolean;
      gulp?: boolean;
      onEnd?: () => void;
    }
  | { kind: 'merge'; from: Box; to: Box; label: string; targetLabel: string; folderId: string; onEnd?: () => void };

const folderOf = (a: DropAnimation): string | undefined => (a.kind === 'out' ? a.intoId : a.folderId);

const ok = (b: Box | null | undefined): b is Box =>
  !!b && [b.left, b.top, b.width, b.height].every(Number.isFinite) && b.width > 0 && b.height > 0;

const n = (v: number) => (Math.round(v * 1000) / 1000).toFixed(3);

/** A ghost tile drawn at `box` in the animation layer (inline styles: it lives outside any component). */
function ghost(box: Box, label: string, kind: string): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute('data-testid', 'drop-anim');
  el.setAttribute('data-kind', kind);
  el.setAttribute('aria-hidden', 'true');
  el.style.cssText = [
    'position:fixed', `left:${box.left}px`, `top:${box.top}px`, `width:${box.width}px`, `height:${box.height}px`,
    // Below dialogs (ruling 3: no animation is ever drawn over one), above the page, navbar and toolbar.
    'box-sizing:border-box', 'pointer-events:none', 'z-index:calc(var(--z-modal, 1000) - 10)',
    'display:flex', 'align-items:center', 'justify-content:center', 'padding:0.25rem',
    'border-radius:0.75rem', 'border:2px solid var(--accent)',
    'background:color-mix(in srgb, var(--bg-secondary) 85%, transparent)', 'color:var(--text-primary)',
    'box-shadow:0 8px 24px rgba(0,0,0,0.3)', 'opacity:0.9', 'transform-origin:50% 50%', 'will-change:transform,opacity'
  ].join(';');
  const span = document.createElement('span');
  span.textContent = label;
  span.style.cssText = 'font-weight:600;font-size:0.875rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%';
  el.appendChild(span);
  document.body.appendChild(el);
  return el;
}

const centre = (b: Box) => ({ x: b.left + b.width / 2, y: b.top + b.height / 2 });
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2); // ease-in-out cubic
const tf = (x: number, y: number, s: number) => `translate(${n(x)}px, ${n(y)}px) scale(${n(s)})`;
const STEPS = 10;

/**
 * The drop's flight from (0, 0) to (dx, dy): a quadratic curve through a hop above the higher end,
 * eased, shrinking to `s` and fading out over the last part.
 */
function flightFrames(dx: number, dy: number, s: number, hop: number): Keyframe[] {
  // The control point, so the curve's top (at its middle) is `hop` px above the higher end.
  const cx = dx / 2, cy = (4 * (Math.min(0, dy) - hop) - dy) / 2;
  const out: Keyframe[] = [];
  for (let i = 0; i <= STEPS; i++) {
    const t = ease(i / STEPS);
    const x = 2 * (1 - t) * t * cx + t * t * dx;
    const y = 2 * (1 - t) * t * cy + t * t * dy;
    const scale = 1 + (s - 1) * t * t;
    const opacity = t < 0.6 ? 0.95 : 0.95 * (1 - (t - 0.6) / 0.4);
    out.push({ transform: tf(x, y, scale), opacity: Number(n(Math.max(0, opacity))), offset: i / STEPS });
  }
  return out;
}

/**
 * A merged tile's path from (0, 0): first `part` px away along (ux, uy), then onto (dx, dy), where
 * the two meet, shrinking to 0.6 and fading as they arrive.
 */
function gatherFrames(dx: number, dy: number, ux: number, uy: number, part: number): Keyframe[] {
  return [
    { transform: tf(0, 0, 1), opacity: 0.95, offset: 0 },
    { transform: tf(ux * part, uy * part, 1.02), opacity: 0.95, offset: 0.28 },
    // A short hold, parted, so the move apart is seen (and a 60 fps sampler can't miss its peak).
    { transform: tf(ux * part, uy * part, 1.02), opacity: 0.95, offset: 0.42, easing: 'ease-in' },
    { transform: tf(dx * 0.85, dy * 0.85, 0.75), opacity: 0.9, offset: 0.85 },
    { transform: tf(dx, dy, 0.6), opacity: 0, offset: 1 }
  ];
}

/** The translation from one box's centre to another's. */
const towards = (a: Box, b: Box) => ({
  dx: b.left + b.width / 2 - (a.left + a.width / 2),
  dy: b.top + b.height / 2 - (a.top + a.height / 2)
});

/**
 * Out of a folder (§8.1), from (0, 0): it rises `rise` px out of the source (growing to full size),
 * then hops on an eased quadratic curve to (dx, dy), ending at scale (sx, sy). `land`: 'spot' fades
 * only at the very end (the item is revealed under it), 'into' shrinks and fades into a folder, 'away'
 * fades out over the second half (nowhere on screen to land).
 */
function outFrames(dx: number, dy: number, sx: number, sy: number, rise: number, hop: number, land: 'spot' | 'into' | 'away'): Keyframe[] {
  const R = 0.2; // the rise's share of the time
  const out: Keyframe[] = [
    { transform: tf2(0, 0, 0.8, 0.8), opacity: 0.4, offset: 0 },
    { transform: tf2(0, -rise, 1, 1), opacity: 0.95, offset: R }
  ];
  const ey = dy + rise; // the hop's end, from the risen point
  const cx = dx / 2, cy = (4 * (Math.min(0, ey) - hop) - ey) / 2;
  for (let i = 1; i <= STEPS; i++) {
    const t = ease(i / STEPS);
    const x = 2 * (1 - t) * t * cx + t * t * dx;
    const y = -rise + 2 * (1 - t) * t * cy + t * t * ey;
    const k = land === 'into' ? t * t : t;
    const opacity =
      land === 'spot' ? (t < 0.85 ? 0.95 : 0.95 * (1 - (t - 0.85) / 0.15)) :
      land === 'into' ? (t < 0.6 ? 0.95 : 0.95 * (1 - (t - 0.6) / 0.4)) :
      (t < 0.4 ? 0.95 : 0.95 * (1 - (t - 0.4) / 0.6));
    out.push({
      transform: tf2(x, y, 1 + (sx - 1) * k, 1 + (sy - 1) * k),
      opacity: Number(n(Math.max(0, opacity))),
      offset: Number(n(R + (1 - R) * (i / STEPS)))
    });
  }
  return out;
}
/** A transform with one scale when both are equal (so scale(s) reads the same as the other paths). */
const tf2 = (x: number, y: number, sx: number, sy: number) =>
  Math.abs(sx - sy) < 1e-9 ? tf(x, y, sx) : `translate(${n(x)}px, ${n(y)}px) scale(${n(sx)}, ${n(sy)})`;

/**
 * Out of a folder with nothing of the source drawn (§8.1, arrive 'drop'): the item, drawn at its new
 * spot, drops in from (x0, y0) at scale s0, overshoots by SETTLE_PX along its path and settles there;
 * it fades only at the very end (the item is revealed under it).
 */
function landFrames(x0: number, y0: number, s0: number): Keyframe[] {
  const len = Math.max(1, Math.hypot(x0, y0));
  const ox = (-x0 / len) * SETTLE_PX, oy = (-y0 / len) * SETTLE_PX;
  return [
    { transform: tf(x0, y0, s0), opacity: 0.4, offset: 0 },
    { transform: tf(x0 * 0.85, y0 * 0.85, s0 + (1 - s0) * 0.15), opacity: 0.95, offset: 0.15, easing: 'ease-in' },
    { transform: tf(ox, oy, 1.02), opacity: 0.95, offset: 0.62, easing: 'ease-out' },
    { transform: tf(0, 0, 1), opacity: 0.95, offset: 0.85 },
    { transform: tf(0, 0, 1), opacity: 0, offset: 1 }
  ];
}

/** A multi-select out of folders animates at most this many items; the rest simply appear. */
export const OUT_MAX_ITEMS = 12;

/**
 * An item leaving a folder, and where it starts: where it is drawn now, else its source folder (or
 * box); null when neither is drawn. `tabId`: the tab it leaves from (its button is the start then).
 */
export type OutStart = { id: string; sourceId: string; tabId?: string; from: Box | null };

/**
 * Out of a folder (§8.1): measure where each leaving item starts (at most OUT_MAX_ITEMS), BEFORE the
 * change is drawn. Empty when animations won't play (no layout reads for nothing).
 */
export function outStarts(dashboardId: string, leaving: { id: string; sourceId: string; tabId?: string }[]): OutStart[] {
  if (typeof document === 'undefined' || leaving.length === 0 || !animationsAllowed(dashboardId)) return [];
  return leaving.slice(0, OUT_MAX_ITEMS).map(({ id, sourceId, tabId }) => {
    for (const at of [id, sourceId]) {
      const el = env.findNode(at);
      const b = el ? env.measure(el) : null;
      if (ok(b)) return { id, sourceId, tabId, from: { left: b.left, top: b.top, width: b.width, height: b.height } };
    }
    return { id, sourceId, tabId, from: null };
  });
}

/** A drawn tab button's box (not the shown tab's), or null. */
function tabButtonBox(tabId: string | undefined): Box | null {
  const el = tabId ? env.findTabButton(tabId) : null;
  const b = el ? env.measure(el) : null;
  return ok(b) ? { left: b.left, top: b.top, width: b.width, height: b.height } : null;
}

/**
 * Play the out animation of each measured item (after the change is in the draft): each from its own
 * spot, each source puffing once and the destination gulping once. An item whose source isn't drawn
 * starts from its source tab's button (which puffs once) when that tab isn't the one shown; else it
 * drops in onto its new spot (from `fallbackFrom`, the drag's ghost, when given).
 */
export function playOutOfFolders(
  dashboardId: string,
  starts: OutStart[],
  o: { landed: (id: string) => string | undefined; label: (id: string) => string; intoId?: string; fallbackFrom?: (id: string) => Box | null }
): void {
  const puffed = new Set<string>();
  let gulped = false;
  for (const st of starts) {
    try {
      const common = { kind: 'out' as const, label: o.label(st.id), sourceId: st.sourceId, landedId: o.landed(st.id), intoId: o.intoId, gulp: !gulped };
      if (st.from) {
        playDropAnimation(dashboardId, { ...common, from: st.from, puff: !puffed.has(st.sourceId) });
        puffed.add(st.sourceId);
      } else {
        const tab = tabButtonBox(st.tabId);
        if (tab) {
          const key = `tab:${st.tabId}`;
          playDropAnimation(dashboardId, { ...common, from: tab, sourceTab: st.tabId, puff: !puffed.has(key) });
          puffed.add(key);
        } else {
          playDropAnimation(dashboardId, { ...common, from: o.fallbackFrom?.(st.id) ?? null, arrive: 'drop', puff: false });
        }
      }
      gulped = true;
    } catch (e) {
      sayAnimationFailure(e); // playDropAnimation never throws; this covers the arguments
    }
  }
}

/**
 * Say an animation failure once per page (a toast, and the log); the edit it decorated is untouched.
 * Also used by the drag controller when building an animation's arguments throws.
 */
export function sayAnimationFailure(e: unknown): void {
  logError('Drop animation', e);
  if (!failureSaid) {
    failureSaid = true;
    toast.info("Animations couldn't play here, so they are skipped. Your change was made as usual.");
  }
}

/**
 * Play the drop's animation, if allowed. Returns whether it started; when it did, `onEnd` runs once
 * when it has ended (finished, cancelled, failed, or at its safety net). Never throws: the
 * draft change it decorates has already been made.
 */
export function playDropAnimation(dashboardId: string, a: DropAnimation): boolean {
  if (typeof document === 'undefined' || !animationsAllowed(dashboardId)) return false;
  // Only the drop-in may start without a box (it is drawn at the spot it lands on).
  if (!ok(a.from) && !(a.kind === 'out' && a.arrive === 'drop')) return false;
  if (a.kind === 'merge' && !ok(a.to)) return false;
  // §9: the edit glide leaves alone what this animation draws.
  claimFlourish(a.kind === 'out' ? [a.sourceId, a.landedId, a.intoId] : [a.folderId]);
  const made: HTMLElement[] = [];
  const cleanups: (() => void)[] = [];
  /** Every animation started, on a ghost or a REAL element: all cancelled at the end. */
  const anims: Animation[] = [];
  let done = false;
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  const cleanup = (why: Ended = 'finished') => {
    if (done) return;
    done = true;
    live.delete(cleanup);
    made.forEach((e) => {
      e.dataset.ended = why;
      e.remove();
    });
    // Cancel what is still applied to real elements (a reveal at opacity 0, a puff, a gulp), so none
    // is ever left mid-way; a finished one is unaffected.
    for (const an of anims) {
      try {
        an.onfinish = null;
        an.oncancel = null;
        an.cancel();
      } catch {
        /* already gone with its element */
      }
    }
    cleanups.forEach((f) => {
      try {
        f();
      } catch {
        /* the element is already gone */
      }
    });
    try {
      a.onEnd?.();
    } catch (e) {
      sayAnimationFailure(e);
    }
  };
  const fail = (e: unknown) => {
    cleanup('failed');
    sayAnimationFailure(e);
  };
  live.add(cleanup);
  /** Arm the safety net once the animations have been started (see safetyNet). */
  const armNet = (ms: number, margin = 300) => {
    if (!done) cleanups.push(safetyNet(anims, ms, margin, () => cleanup('safety-net')));
  };
  // The setting turned Off (or no longer allowed) mid-animation: stop at once.
  cleanups.push(config.subscribe(() => {
    if (!done && !animationsAllowed(dashboardId)) cleanup('setting');
  }));
  /** Start one animation; false when the browser can't animate (no element.animate). */
  let pending = 0;
  const run = (el: HTMLElement, frames: Keyframe[], opts: KeyframeAnimationOptions): boolean => {
    const anim = env.animate(el, frames, { easing: 'ease-in-out', ...opts });
    if (!anim) return false;
    anims.push(anim);
    pending++;
    const end = () => {
      if (--pending <= 0) cleanup();
    };
    anim.onfinish = end;
    anim.oncancel = end;
    return true;
  };

  /** The folder's own element (or a given one) starts its part (gulp / pop / puff), marked by `attr` while it runs. */
  const onFolder = (attr: string, frames: Keyframe[], duration: number, delayFromDrop: number, fill: FillMode, id = folderOf(a), given?: HTMLElement) => {
    const el = done ? null : (given ?? (id ? env.findNode(id) : null));
    if (!el) return;
    el.setAttribute(attr, '');
    cleanups.push(() => el.removeAttribute(attr));
    const elapsed = Math.max(0, (typeof performance !== 'undefined' ? performance.now() : 0) - t0);
    run(el, frames, { duration, delay: Math.max(0, delayFromDrop - elapsed), fill, easing: 'ease-in-out' });
  };

  try {
    if (a.kind === 'out' && a.arrive === 'drop') {
      // Nothing of the source is drawn: the item drops in onto its new spot and settles there.
      const from = ok(a.from) ? a.from : null;
      const g = ghost(from ?? { left: 0, top: 0, width: 1, height: 1 }, a.label, 'out');
      if (!from) g.style.visibility = 'hidden'; // until it is placed on its spot, on the next frame
      made.push(g);
      pending++;
      env.raf(() => {
        try {
          if (done) return;
          const el = a.landedId ? env.findNode(a.landedId) : null;
          const to = el ? env.measure(el) : null;
          if (!el || !ok(to)) {
            pending--;
            return cleanup(); // not drawn here: nothing to land on (the change is made all the same)
          }
          // The ghost is drawn at the spot; it starts where the drag's ghost was, unless that is too
          // close to see a move — then from MIN_LAND_PX above the spot.
          Object.assign(g.style, { left: `${to.left}px`, top: `${to.top}px`, width: `${to.width}px`, height: `${to.height}px`, visibility: '' });
          let x0 = 0, y0 = -MIN_LAND_PX, s0 = 0.9;
          if (from) {
            const t = towards(to, from);
            if (Math.hypot(t.dx, t.dy) >= MIN_LAND_PX) {
              x0 = t.dx;
              y0 = t.dy;
            }
            s0 = Math.max(0.5, Math.min(1.5, from.width / to.width));
          }
          if (!run(g, landFrames(x0, y0, s0), { duration: OUT_MS, easing: 'linear', fill: 'forwards' })) {
            pending--;
            return cleanup();
          }
          const own = env.opacity(el);
          const end = Number.isFinite(own) ? Math.min(1, Math.max(0, own)) : 1;
          run(el, [{ opacity: 0 }, { opacity: 0, offset: 0.85 }, { opacity: end }], { duration: OUT_MS, easing: 'linear' });
          armNet(OUT_TOTAL_MS + 300);
        } catch (e) {
          fail(e);
          return;
        }
        if (--pending <= 0) cleanup();
      });
      return !done;
    }

    if (a.kind === 'out') {
      const aFrom = a.from as Box; // checked above: only the drop-in starts without one
      const g = ghost(aFrom, a.label, 'out');
      made.push(g);
      pending++; // held until the frame below has started what it starts
      env.raf(() => {
        try {
          if (done) return;
          const measured = (id: string | undefined) => {
            const el = id ? env.findNode(id) : null;
            const b = el ? env.measure(el) : null;
            return el && ok(b) ? { el, b } : null;
          };
          // The source (or the button of the tab it came from) puffs at once: a small scale-up, its
          // edges moving at most GULP_MAX_EDGE_PX.
          const tabEl = a.sourceTab !== undefined ? env.findTabButton(a.sourceTab) : null;
          const tabB = tabEl ? env.measure(tabEl) : null;
          const source = a.puff === false ? null
            : a.sourceTab !== undefined ? (tabEl && ok(tabB) ? { el: tabEl, b: tabB } : null)
            : measured(a.sourceId);
          if (source) {
            const s = releaseScale(source.b.width, source.b.height);
            onFolder('data-drop-release', [
              { transform: 'scale(1)' }, { transform: `scale(${n(s)})`, offset: 0.4 }, { transform: 'scale(1)' }
            ], RELEASE_MS, 0, 'none', a.sourceId, source.el);
          }
          const landed = measured(a.landedId);
          const into = landed ? null : measured(a.intoId);
          const to = landed?.b ?? into?.b ?? null;
          const land = landed ? 'spot' : into ? 'into' : 'away';
          const rise = Math.max(28, 0.3 * aFrom.height);
          const hop = Math.max(MIN_HOP_PX, 0.5 * aFrom.height);
          let dx = 0, dy = -rise, sx = 1, sy = 1;
          if (to) {
            ({ dx, dy } = towards(aFrom, to));
            if (land === 'spot') {
              sx = to.width / aFrom.width;
              sy = to.height / aFrom.height;
            } else {
              sx = sy = Math.max(0.12, Math.min(0.35, 0.4 * Math.min(to.width / aFrom.width, to.height / aFrom.height)));
            }
          }
          if (!run(g, outFrames(dx, dy, sx, sy, rise, hop, land), { duration: OUT_MS, easing: 'linear', fill: 'forwards' })) {
            pending--;
            return cleanup();
          }
          // The item at its new spot stays hidden under the ghost and is revealed as it lands.
          // It ends at the element's own opacity (a see-through tile stays see-through).
          if (landed) {
            const own = env.opacity(landed.el);
            const end = Number.isFinite(own) ? Math.min(1, Math.max(0, own)) : 1;
            run(landed.el, [{ opacity: 0 }, { opacity: 0, offset: 0.85 }, { opacity: end }], { duration: OUT_MS, easing: 'linear' });
          }
          // Into another folder: it gulps as the item arrives.
          const dest = a.intoId && a.gulp !== false ? (into ?? measured(a.intoId)) : null;
          if (dest) {
            const gulp = gulpScale(dest.b.width, dest.b.height);
            onFolder('data-drop-gulp', [
              { transform: 'scale(1)' }, { transform: `scale(${gulp})`, offset: 0.45 }, { transform: 'scale(1)' }
            ], GULP_MS, OUT_GULP_DELAY_MS, 'none', a.intoId);
          }
          armNet(OUT_TOTAL_MS + 300);
        } catch (e) {
          fail(e);
          return;
        }
        if (--pending <= 0) cleanup();
      });
      return !done;
    }

    if (a.kind === 'into') {
      const g = ghost(a.from, a.label, 'into');
      made.push(g);
      const resolve = a.to;
      pending++; // held until the frame below has started what it starts
      env.raf(() => {
        try {
          if (done) return;
          const to = typeof resolve === 'function' ? resolve() : resolve;
          if (!ok(to)) {
            pending--;
            return cleanup();
          }
          const { dx, dy } = towards(a.from, to);
          const s = Math.max(0.12, Math.min(0.35, 0.4 * Math.min(to.width / a.from.width, to.height / a.from.height)));
          const hop = Math.max(MIN_HOP_PX, 0.5 * a.from.height);
          if (!run(g, flightFrames(dx, dy, s, hop), { duration: DROP_MS, easing: 'linear', fill: 'forwards' })) {
            pending--;
            return cleanup();
          }
          // A big open folder must not wobble: its edges move at most GULP_MAX_EDGE_PX.
          const gulp = gulpScale(to.width, to.height);
          onFolder('data-drop-gulp', [
            { transform: 'scale(1)' }, { transform: `scale(${gulp})`, offset: 0.45 }, { transform: 'scale(1)' }
          ], GULP_MS, GULP_DELAY_MS, 'none');
          armNet(INTO_TOTAL_MS + 300);
        } catch (e) {
          fail(e);
          return;
        }
        if (--pending <= 0) cleanup();
      });
      return !done;
    }

    // Merge: both tiles drawn together onto the new folder (measured once it is drawn), then it pops.
    const target = a.to as Box;
    const dragged = ghost(a.from, a.label, 'merge');
    const targetGhost = ghost(target, a.targetLabel, 'merge');
    made.push(dragged, targetGhost);
    pending++;
    env.raf(() => {
      try {
        if (done) return;
        const el = env.findNode(a.folderId);
        const fb = el ? env.measure(el) : null;
        const meet = centre(ok(fb) ? fb : target);
        const pa = centre(a.from), pb = centre(target);
        let ux = pa.x - pb.x, uy = pa.y - pb.y;
        const len = Math.hypot(ux, uy);
        if (len < 1) {
          ux = -1;
          uy = 0; // on top of each other: part sideways
        } else {
          ux /= len;
          uy /= len;
        }
        const part = Math.max(MIN_PART_PX, 0.45 * Math.min(a.from.width, target.width));
        const opts: KeyframeAnimationOptions = { duration: GATHER_MS, easing: 'ease-in-out', fill: 'forwards' };
        const gathered =
          run(dragged, gatherFrames(meet.x - pa.x, meet.y - pa.y, ux, uy, part), opts) &&
          run(targetGhost, gatherFrames(meet.x - pb.x, meet.y - pb.y, -ux, -uy, part), opts);
        if (!gathered) {
          pending--;
          return cleanup();
        }
        onFolder('data-drop-pop', [
          { transform: 'scale(0.6)', opacity: 0 },
          { transform: 'scale(1.05)', opacity: 1, offset: 0.6 },
          { transform: 'scale(1)', opacity: 1 }
        ], POP_MS, POP_DELAY_MS, 'backwards');
        // Ruling 3: the folder dialog opens at this end (onEnd), so its cap is this net.
        armNet(MERGE_DIALOG_CAP_MS, MERGE_DIALOG_CAP_MS - MERGE_TOTAL_MS);
      } catch (e) {
        fail(e);
        return;
      }
      if (--pending <= 0) cleanup();
    });
    return true;
  } catch (e) {
    fail(e);
    return false;
  }
}
