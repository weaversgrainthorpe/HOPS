// The one hover popup (tiles and folders): what it says, where it goes, and when it shows.
// One popup for the whole page (HoverCard.svelte, mounted once in the root layout) driven by the
// `hoverCard` action on each tile or folder title. It replaces the browser's native title there,
// which can't be sized; the element keeps no `title` of its own (no double popups).
//
// Shows: after a short hover (HOVER_DELAY_MS, like the native one; at once when moving straight from
// one popup to the next) and on keyboard focus. Hides: pointer leave, a press (a click or the start of
// a drag), blur, Escape, scroll, resize. Never on a touch tap, never during an editor drag (suppressed for
// the whole drag). Never takes a click (pointer-events: none). A keyboard focus that scrolls its item into
// view keeps its popup (placed again) through that scroll only (FOCUS_SCROLL_MS), so Tab onto a tile below
// the fold still shows it; any later scroll hides it as usual.
import { get, writable, type Readable } from 'svelte/store';

export interface HoverCardContent {
  /** Line 1: the item's name. */
  name: string;
  /** Line 2, smaller and muted, when there is one. */
  description?: string;
  /** Any further notes (away address, an address problem, an edit-mode hint), smaller still. */
  lines?: string[];
}

export interface HoverCardState {
  anchor: HTMLElement;
  content: HoverCardContent;
  /** Shown for a keyboard focus (kept, and placed again, through the scroll that focus causes). */
  byKeyboard: boolean;
  /** When it was shown (Date.now()). */
  shownAt: number;
}

export const HOVER_DELAY_MS = 500;
/** Moving from one popup straight onto the next shows it at once (as native tooltips do). */
const WARM_MS = 300;
/** A scroll this soon after a keyboard show is the focus scrolling its item into view; later ones hide it. */
export const FOCUS_SCROLL_MS = 300;

const state = writable<HoverCardState | null>(null);
export const hoverCardState: Readable<HoverCardState | null> = { subscribe: state.subscribe };

let lastHidden = 0;
/** The last input was a key (so a focus is a keyboard focus), not a pointer. */
let keyboardInput = false;
let globalsReady = false;
/** An editor drag is on: no popup at all until it ends. */
let suppressed = false;

/** The editor's drag (HoverCard.svelte follows it): while on, nothing shows and a shown popup goes. */
export function setHoverCardSuppressed(on: boolean): void {
  suppressed = on;
  if (on) hideHoverCard();
}

export function hideHoverCard(): void {
  if (get(state)) lastHidden = Date.now();
  state.set(null);
}

function ensureGlobals() {
  if (globalsReady || typeof document === 'undefined') return;
  globalsReady = true;
  document.addEventListener(
    'keydown',
    (e) => {
      keyboardInput = true;
      if (e.key === 'Escape') hideHoverCard();
    },
    true
  );
  document.addEventListener('pointerdown', () => (keyboardInput = false), true);
  // Any scroll (the page or a scrolling box) moves the anchor: the popup goes rather than float loose.
  // A keyboard focus that scrolled its item into view is the exception: that popup is placed again.
  document.addEventListener(
    'scroll',
    () => {
      const s = get(state);
      const ownScroll = !!s?.byKeyboard && Date.now() - s.shownAt < FOCUS_SCROLL_MS;
      if (s && ownScroll && s.anchor.isConnected && s.anchor.contains(document.activeElement)) state.set({ ...s });
      else hideHoverCard();
    },
    true
  );
  window.addEventListener('resize', () => hideHoverCard());
}

/** Test hook: forget the keyboard/pointer history and any popup. */
export function resetHoverCard(): void {
  keyboardInput = false;
  suppressed = false;
  lastHidden = 0;
  state.set(null);
}

/** Tidy content: a blank description or line is no line at all. */
function clean(c: HoverCardContent): HoverCardContent {
  const description = c.description?.trim() ? c.description : undefined;
  const lines = (c.lines ?? []).filter((l) => !!l && !!l.trim());
  return { name: c.name, description, lines };
}

/** The action: `use:hoverCard={content}` (null = no popup on this element). */
export function hoverCard(node: HTMLElement, content: HoverCardContent | null) {
  ensureGlobals();
  let current = content ? clean(content) : null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const active = () => get(state)?.anchor === node;
  const cancel = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const show = (byKeyboard = false) => {
    cancel();
    if (current && !suppressed && node.isConnected) state.set({ anchor: node, content: current, byKeyboard, shownAt: Date.now() });
  };
  const hide = () => {
    cancel();
    if (active()) hideHoverCard();
  };

  const onEnter = (e: PointerEvent) => {
    if (e.pointerType === 'touch' || !current) return;
    cancel();
    if (suppressed) return;
    if (Date.now() - lastHidden < WARM_MS) show();
    else timer = setTimeout(() => show(), HOVER_DELAY_MS);
  };
  const onLeave = () => hide();
  const onFocusIn = () => {
    if (keyboardInput) show(true);
  };
  const onFocusOut = (e: FocusEvent) => {
    if (e.relatedTarget instanceof Node && node.contains(e.relatedTarget)) return;
    hide();
  };

  node.addEventListener('pointerenter', onEnter);
  node.addEventListener('pointerleave', onLeave);
  node.addEventListener('pointerdown', onLeave);
  node.addEventListener('click', onLeave);
  node.addEventListener('dragstart', onLeave);
  node.addEventListener('focusin', onFocusIn);
  node.addEventListener('focusout', onFocusOut);

  return {
    update(next: HoverCardContent | null) {
      current = next ? clean(next) : null;
      if (!active()) return;
      const s = get(state);
      if (current) state.set({ anchor: node, content: current, byKeyboard: s?.byKeyboard ?? false, shownAt: s?.shownAt ?? Date.now() });
      else hide();
    },
    destroy() {
      hide();
      node.removeEventListener('pointerenter', onEnter);
      node.removeEventListener('pointerleave', onLeave);
      node.removeEventListener('pointerdown', onLeave);
      node.removeEventListener('click', onLeave);
      node.removeEventListener('dragstart', onLeave);
      node.removeEventListener('focusin', onFocusIn);
      node.removeEventListener('focusout', onFocusOut);
    }
  };
}

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Where the popup goes: below its anchor, centred on it; above when there's no room below; the side
 * with more room when neither fits (then held on screen). Always clamped inside the viewport's sides.
 */
export function placeCard(
  anchor: Box,
  card: { width: number; height: number },
  view: { width: number; height: number },
  gap = 8,
  margin = 8
): { left: number; top: number; side: 'below' | 'above' } {
  const below = anchor.bottom + gap;
  const above = anchor.top - gap - card.height;
  let side: 'below' | 'above';
  let top: number;
  if (below + card.height <= view.height - margin) {
    side = 'below';
    top = below;
  } else if (above >= margin) {
    side = 'above';
    top = above;
  } else {
    side = view.height - anchor.bottom >= anchor.top ? 'below' : 'above';
    top = side === 'below' ? below : above;
    top = Math.max(margin, Math.min(top, view.height - card.height - margin));
  }
  const centre = (anchor.left + anchor.right) / 2;
  const maxLeft = Math.max(margin, view.width - card.width - margin);
  const left = Math.max(margin, Math.min(centre - card.width / 2, maxLeft));
  return { left: Math.round(left), top: Math.round(top), side };
}

/** A tile's popup: its name, its description, then the notes its old hover text carried (same wording). */
export function tileHoverContent(
  entry: { name: string; description?: string },
  opts: { away?: { url: string; checkedAtHome: boolean }; urlProblem?: string } = {}
): HoverCardContent {
  const lines: string[] = [];
  if (opts.away) {
    lines.push(`Opens away address: ${opts.away.url}`);
    if (opts.away.checkedAtHome) lines.push('Status checked at home address');
  }
  if (opts.urlProblem) lines.push(opts.urlProblem);
  return clean({ name: entry.name, description: entry.description, lines });
}

/** A folder's popup: its name ("Untitled folder" when it has none), its description, any notes. */
export function folderHoverContent(folder: { name?: string; description?: string }, lines: string[] = []): HoverCardContent {
  return clean({ name: folder.name?.trim() ? folder.name : 'Untitled folder', description: folder.description, lines });
}
