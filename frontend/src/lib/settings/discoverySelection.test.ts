import { describe, it, expect } from 'vitest';
import { promotableRows, hiddenTickedCount, hiddenTickedMessage, untickUnchangedDefaults } from './discoverySelection';

const all = [
  { id: 'a' },
  { id: 'b' },
  { id: 'c', curateState: 'promoted' },
  { id: 'd' },
  { id: 'e' }
];
const visible = [all[0], all[2], all[3]]; // a, c (promoted), d
const selected = { a: true, b: true, c: true, d: false, e: true };

describe('discovery selection with a filter', () => {
  it('promotes only ticked, unpromoted rows that are shown', () => {
    expect(promotableRows(visible, selected).map((r) => r.id)).toEqual(['a']);
  });
  it('counts ticked hidden rows, ignoring promoted ones', () => {
    expect(hiddenTickedCount(all, visible, selected)).toBe(2); // b, e
  });
  it('keeps hidden ticks: with every row shown they all count again', () => {
    expect(promotableRows(all, selected).map((r) => r.id)).toEqual(['a', 'b', 'e']);
    expect(hiddenTickedCount(all, all, selected)).toBe(0);
  });
  it('says nothing when no hidden row is ticked', () => {
    expect(hiddenTickedMessage(0)).toBe('');
  });
  it('words the line for one and many', () => {
    expect(hiddenTickedMessage(1)).toBe("1 ticked result isn't shown by this filter and won't be added.");
    expect(hiddenTickedMessage(16)).toBe("16 ticked results aren't shown by this filter and won't be added.");
  });
});

describe('default ticks after the comparison loads', () => {
  it('unticks only rows ticked by default that are unchanged since the last scan', () => {
    const selected: Record<string, boolean> = { a: true, b: true, c: true, d: true };
    const autoTicked = new Set(['a', 'b', 'd']); // c was ticked by the admin
    const states = { a: 'unchanged', b: 'new', c: 'unchanged', d: 'changed' };
    untickUnchangedDefaults(selected, autoTicked, states);
    expect(selected).toEqual({ a: false, b: true, c: true, d: true });
    expect([...autoTicked].sort()).toEqual(['b', 'd']);
  });
});
