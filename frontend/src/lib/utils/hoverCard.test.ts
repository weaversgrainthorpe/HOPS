import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { get } from 'svelte/store';
import {
  hoverCard,
  hoverCardState,
  placeCard,
  tileHoverContent,
  folderHoverContent,
  resetHoverCard,
  setHoverCardSuppressed,
  HOVER_DELAY_MS
} from './hoverCard';

describe('hover card content', () => {
  it('a tile with a name only', () => {
    expect(tileHoverContent({ name: 'NAS' })).toEqual({ name: 'NAS', description: undefined, lines: [] });
  });
  it('a tile with a description: the name first, the description second', () => {
    expect(tileHoverContent({ name: 'NAS', description: 'Files' })).toEqual({ name: 'NAS', description: 'Files', lines: [] });
  });
  it('a blank description is no line', () => {
    expect(tileHoverContent({ name: 'NAS', description: '   ' }).description).toBeUndefined();
  });
  it('away: the away address and the home-check note, in the old wording, then an address problem', () => {
    const c = tileHoverContent(
      { name: 'NAS', description: 'Files' },
      { away: { url: 'https://nas.example', checkedAtHome: true }, urlProblem: 'No address: this tile will not open' }
    );
    expect(c.lines).toEqual([
      'Opens away address: https://nas.example',
      'Status checked at home address',
      'No address: this tile will not open'
    ]);
  });
  it('away without status checks: no home-check note', () => {
    expect(tileHoverContent({ name: 'NAS' }, { away: { url: 'https://n', checkedAtHome: false } }).lines).toEqual([
      'Opens away address: https://n'
    ]);
  });
  it('a folder: its name and description; an unnamed one is "Untitled folder"', () => {
    expect(folderHoverContent({ name: 'Media', description: 'Films' })).toEqual({ name: 'Media', description: 'Films', lines: [] });
    expect(folderHoverContent({ name: ' ' }).name).toBe('Untitled folder');
    expect(folderHoverContent({ name: 'M' }, ['Back to M']).lines).toEqual(['Back to M']);
  });
});

describe('placeCard', () => {
  const view = { width: 1000, height: 800 };
  const card = { width: 200, height: 80 };
  it('goes below, centred on the anchor', () => {
    expect(placeCard({ left: 400, right: 500, top: 100, bottom: 200 }, card, view)).toEqual({ left: 350, top: 208, side: 'below' });
  });
  it('flips above when there is no room below', () => {
    expect(placeCard({ left: 400, right: 500, top: 650, bottom: 750 }, card, view)).toEqual({ left: 350, top: 562, side: 'above' });
  });
  it('clamps to the left and right edges', () => {
    expect(placeCard({ left: 0, right: 40, top: 100, bottom: 140 }, card, view).left).toBe(8);
    expect(placeCard({ left: 960, right: 1000, top: 100, bottom: 140 }, card, view).left).toBe(792);
  });
  it('neither side fits: the roomier side, held on screen', () => {
    const p = placeCard({ left: 0, right: 100, top: 30, bottom: 770 }, card, view);
    expect(p.top).toBeGreaterThanOrEqual(8);
    expect(p.top + card.height).toBeLessThanOrEqual(792);
  });
});

describe('hoverCard action', () => {
  let el: HTMLButtonElement;
  let action: ReturnType<typeof hoverCard>;
  beforeEach(() => {
    vi.useFakeTimers();
    resetHoverCard();
    el = document.createElement('button');
    document.body.appendChild(el);
    action = hoverCard(el, { name: 'NAS', description: 'Files' });
  });
  afterEach(() => {
    action.destroy();
    el.remove();
    vi.useRealTimers();
  });
  const enter = (pointerType = 'mouse') => {
    const e = new Event('pointerenter') as Event & { pointerType: string };
    Object.defineProperty(e, 'pointerType', { value: pointerType });
    el.dispatchEvent(e);
  };

  it('shows after the hover delay, not before; hides on leave', () => {
    enter();
    vi.advanceTimersByTime(HOVER_DELAY_MS - 1);
    expect(get(hoverCardState)).toBeNull();
    vi.advanceTimersByTime(1);
    expect(get(hoverCardState)?.content.name).toBe('NAS');
    el.dispatchEvent(new Event('pointerleave'));
    expect(get(hoverCardState)).toBeNull();
  });
  it('never on a touch tap', () => {
    enter('touch');
    vi.advanceTimersByTime(HOVER_DELAY_MS * 2);
    expect(get(hoverCardState)).toBeNull();
  });
  it('a press (a click or a drag starting) cancels and hides it', () => {
    enter();
    el.dispatchEvent(new Event('pointerdown'));
    vi.advanceTimersByTime(HOVER_DELAY_MS * 2);
    expect(get(hoverCardState)).toBeNull();
  });
  it('keyboard focus shows it at once; a pointer focus does not; blur hides it', () => {
    document.dispatchEvent(new Event('pointerdown'));
    el.dispatchEvent(new FocusEvent('focusin'));
    expect(get(hoverCardState)).toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
    el.dispatchEvent(new FocusEvent('focusin'));
    expect(get(hoverCardState)?.anchor).toBe(el);
    el.dispatchEvent(new FocusEvent('focusout'));
    expect(get(hoverCardState)).toBeNull();
  });
  it('Escape and scroll hide it', () => {
    enter();
    vi.advanceTimersByTime(HOVER_DELAY_MS);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(get(hoverCardState)).toBeNull();
    el.dispatchEvent(new Event('pointerleave'));
    vi.advanceTimersByTime(1000);
    enter();
    vi.advanceTimersByTime(HOVER_DELAY_MS);
    expect(get(hoverCardState)).not.toBeNull();
    document.dispatchEvent(new Event('scroll'));
    expect(get(hoverCardState)).toBeNull();
  });
  it('a content change while shown updates it; null removes it', () => {
    enter();
    vi.advanceTimersByTime(HOVER_DELAY_MS);
    action.update({ name: 'NAS 2' });
    expect(get(hoverCardState)?.content.name).toBe('NAS 2');
    action.update(null);
    expect(get(hoverCardState)).toBeNull();
  });
  it('unmounted while waiting: the pending timer is cancelled, nothing shows', () => {
    enter();
    action.destroy();
    vi.advanceTimersByTime(HOVER_DELAY_MS * 2);
    expect(get(hoverCardState)).toBeNull();
    action = hoverCard(el, { name: 'NAS' }); // for afterEach
  });
  it('while an editor drag is on: never shows (hover or focus), and a shown one goes', () => {
    enter();
    vi.advanceTimersByTime(HOVER_DELAY_MS);
    expect(get(hoverCardState)).not.toBeNull();
    setHoverCardSuppressed(true);
    expect(get(hoverCardState)).toBeNull();
    el.dispatchEvent(new Event('pointerleave'));
    vi.advanceTimersByTime(1000);
    enter();
    vi.advanceTimersByTime(HOVER_DELAY_MS * 2);
    expect(get(hoverCardState)).toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
    el.dispatchEvent(new FocusEvent('focusin'));
    expect(get(hoverCardState)).toBeNull();
    setHoverCardSuppressed(false);
    el.dispatchEvent(new FocusEvent('focusin'));
    expect(get(hoverCardState)).not.toBeNull();
  });
  it('keyboard focus that scrolls its item into view keeps the popup (re-placed); a hover popup goes on scroll', () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
    el.focus();
    el.dispatchEvent(new FocusEvent('focusin'));
    const before = get(hoverCardState);
    expect(before).not.toBeNull();
    document.dispatchEvent(new Event('scroll'));
    const after = get(hoverCardState);
    expect(after?.anchor).toBe(el);
    expect(after).not.toBe(before); // a new state: the popup measures and places itself again
    // Later, an ordinary scroll (not the focus's own) puts it away, focus or not.
    vi.advanceTimersByTime(400);
    document.dispatchEvent(new Event('scroll'));
    expect(get(hoverCardState)).toBeNull();
    el.blur();
    el.dispatchEvent(new FocusEvent('focusout'));
    expect(get(hoverCardState)).toBeNull();
  });
});
