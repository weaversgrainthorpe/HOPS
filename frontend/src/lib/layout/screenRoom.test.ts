// The room below the navbar, measured from a hidden probe whose height CSS works out: the stable
// viewport less the navbar. jsdom has no layout, so the sizes are stubbed; the sum itself is checked
// in a real browser (e2e/folder-drill-room.spec.ts).
import { describe, it, expect, afterEach, vi } from 'vitest';
import { flushSync } from 'svelte';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SCREEN_ROOM_CLASS, screenRoomPx } from './screenRoom';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.querySelectorAll(`.${SCREEN_ROOM_CLASS}`).forEach((n) => n.remove());
});

describe('screenRoomPx', () => {
  it('is the height of one hidden probe, however often it is read', () => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ height: 729 } as DOMRect);
    expect(screenRoomPx()).toBe(729);
    expect(screenRoomPx()).toBe(729);
    const probes = document.querySelectorAll(`.${SCREEN_ROOM_CLASS}`);
    expect(probes).toHaveLength(1);
    expect(probes[0].getAttribute('aria-hidden')).toBe('true');
  });

  it('without a ResizeObserver it still measures, and never throws', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ height: 500 } as DOMRect);
    flushSync(() => expect(screenRoomPx()).toBe(500));
  });
});

describe('the one source of the navbar height (app.css)', () => {
  const css = readFileSync(resolve(__dirname, '../../app.css'), 'utf8');
  const navbar = readFileSync(resolve(__dirname, '../components/Navbar.svelte'), 'utf8');

  it('the probe uses a stable viewport height, never one that follows the URL bar', () => {
    const rule = /\.screen-room-probe\s*{[^}]*}/.exec(css)![0];
    expect(rule).toContain('100svh');
    expect(rule).toContain('var(--navbar-height)');
    expect(rule).not.toContain('dvh');
  });

  it('the height counts the bar, its border and the safe-area inset, and the navbar draws that bar', () => {
    expect(css).toMatch(/--navbar-height:\s*calc\(var\(--navbar-bar\) \+ 1px \+ env\(safe-area-inset-top, 0px\)\)/);
    expect(navbar).toContain('height: var(--navbar-bar)');
    expect(navbar).not.toMatch(/\.nav-content\s*{[^}]*height:\s*\d/);
  });
});
