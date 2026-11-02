import { createSubscriber } from 'svelte/reactivity';

/** The hidden probe's class (app.css works out its height). */
export const SCREEN_ROOM_CLASS = 'screen-room-probe';

let probe: HTMLElement | null = null;

function probeEl(): HTMLElement {
  if (!probe || !probe.isConnected) {
    probe = document.createElement('div');
    probe.className = SCREEN_ROOM_CLASS;
    probe.setAttribute('aria-hidden', 'true');
    document.body.appendChild(probe);
  }
  return probe;
}

const subscribe = createSubscriber((update) => {
  if (typeof ResizeObserver === 'undefined') return;
  const ro = new ResizeObserver(() => update());
  ro.observe(probeEl());
  return () => ro.disconnect();
});

/**
 * One screen below the navbar, in px. The height comes from CSS (.screen-room-probe), the one place
 * that knows the navbar's height, its safe-area inset and the stable viewport: unlike the window's
 * height it stays put while a tablet's URL bar hides, so a grown folder's cap can't change mid-scroll.
 * It changes on a real resize or a turn of the device, and whatever reads it in a render follows.
 */
export function screenRoomPx(): number {
  if (typeof document === 'undefined') return 0;
  subscribe();
  return probeEl().getBoundingClientRect().height;
}
