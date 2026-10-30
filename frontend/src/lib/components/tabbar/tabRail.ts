// Scroll maths for the one-row tab rail: which edges are reachable, how far a page or a
// wheel gesture moves the strip, and where to scroll so a tab is visible. Pure functions;
// the component reads the DOM and passes the numbers in. Pixels throughout.

/** What the rail's scroll container reports: its offset, view width and content width. */
export interface RailMetrics {
  scrollLeft: number;
  clientWidth: number;
  scrollWidth: number;
}

/** Sub-pixel rounding tolerance for the edge checks. */
const EDGE = 1;

/** Whether the strip overflows, and whether it is at either end. */
export function railState(m: RailMetrics): { overflow: boolean; atStart: boolean; atEnd: boolean } {
  const overflow = m.scrollWidth > m.clientWidth + EDGE;
  if (!overflow) return { overflow: false, atStart: true, atEnd: true };
  return {
    overflow: true,
    atStart: m.scrollLeft <= EDGE,
    atEnd: m.scrollLeft + m.clientWidth >= m.scrollWidth - EDGE
  };
}

/** How far a page-step arrow or key moves the strip: 80% of the view, at least 1 px. */
export function pageStep(clientWidth: number): number {
  return Math.max(1, Math.round(clientWidth * 0.8));
}

/** The largest scrollLeft the strip can take. */
function maxScroll(m: RailMetrics): number {
  return Math.max(0, m.scrollWidth - m.clientWidth);
}

/**
 * The scrollLeft that shows a tab with `margin` px to spare on each side, scrolling as little
 * as possible, or null when it is already fully visible. `tab.left` is relative to the strip's
 * content start (what offsetLeft gives inside the strip). A tab wider than the view has its
 * left edge aligned (minus the margin) instead, and counts as visible when that edge already is.
 */
export function revealScrollLeft(
  tab: { left: number; width: number },
  m: RailMetrics,
  margin = 24
): number | null {
  const start = tab.left - margin;
  const end = tab.left + tab.width + margin;
  const wide = end - start > m.clientWidth;
  const view = m.scrollLeft + m.clientWidth;

  let target: number;
  if (wide) {
    if (start >= m.scrollLeft && start < view) return null;
    target = start;
  } else {
    if (start >= m.scrollLeft && end <= view) return null;
    target = start < m.scrollLeft ? start : end - m.clientWidth;
  }
  return Math.min(maxScroll(m), Math.max(0, target));
}

/**
 * The px to scroll the strip by for a wheel gesture. A mostly-horizontal gesture (or a strip
 * that does not overflow) is left to the browser (0); a vertical one scrolls the strip by deltaY,
 * except where it would push past the end it is already against.
 */
export function wheelDelta(deltaX: number, deltaY: number, m: RailMetrics): number {
  const { overflow, atStart, atEnd } = railState(m);
  if (!overflow || Math.abs(deltaX) >= Math.abs(deltaY)) return 0;
  if (deltaY > 0 && atEnd) return 0;
  if (deltaY < 0 && atStart) return 0;
  return deltaY;
}
