import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import ReorderButtons from './ReorderButtons.svelte';

const names = ['to the top', 'up', 'down', 'to the bottom'];
const btn = (suffix: string) => screen.getByRole('button', { name: `Move Home ${suffix}` }) as HTMLButtonElement;

describe('ReorderButtons', () => {
  it('has four buttons in order, each named for what it moves', () => {
    render(ReorderButtons, { name: 'Home', first: false, last: false, onMove: () => {} });
    const labels = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'));
    expect(labels).toEqual(names.map((n) => `Move Home ${n}`));
    expect(screen.getAllByRole('button').map((b) => b.getAttribute('data-ctl'))).toEqual(['top', 'up', 'down', 'bottom']);
  });

  it('reports which move was clicked', async () => {
    const onMove = vi.fn();
    render(ReorderButtons, { name: 'Home', first: false, last: false, onMove });
    for (const n of names) await fireEvent.click(btn(n));
    expect(onMove.mock.calls.map((c) => c[0])).toEqual(['top', 'up', 'down', 'bottom']);
  });

  it('the first item cannot go up or to the top', () => {
    render(ReorderButtons, { name: 'Home', first: true, last: false, onMove: () => {} });
    expect(btn('to the top').disabled).toBe(true);
    expect(btn('up').disabled).toBe(true);
    expect(btn('down').disabled).toBe(false);
    expect(btn('to the bottom').disabled).toBe(false);
  });

  it('the last item cannot go down or to the bottom', () => {
    render(ReorderButtons, { name: 'Home', first: false, last: true, onMove: () => {} });
    expect(btn('down').disabled).toBe(true);
    expect(btn('to the bottom').disabled).toBe(true);
    expect(btn('up').disabled).toBe(false);
  });

  it('every move is off while busy', () => {
    render(ReorderButtons, { name: 'Home', first: false, last: false, busy: true, onMove: () => {} });
    expect(screen.getAllByRole('button').every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
  });
});
