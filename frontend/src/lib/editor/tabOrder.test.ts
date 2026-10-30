import { describe, it, expect } from 'vitest';
import { moveBlock, sortByName, mergeAfterConflict } from './tabOrder';

// Ordering logic for the Settings > Dashboards > Tab order page. Pure functions.
describe('tabOrder', () => {
  describe('moveBlock', () => {
    const order = ['a', 'b', 'c', 'd', 'e'];

    it('moves a block of ids together to the front, keeping their relative order', () => {
      expect(moveBlock(order, new Set(['b', 'd']), 0)).toEqual(['b', 'd', 'a', 'c', 'e']);
    });

    it('moves the same block to index 3 of the list with the block removed', () => {
      expect(moveBlock(order, new Set(['b', 'd']), 3)).toEqual(['a', 'c', 'e', 'b', 'd']);
    });

    it('clamps an out-of-range target to the end', () => {
      expect(moveBlock(order, new Set(['b', 'd']), 99)).toEqual(['a', 'c', 'e', 'b', 'd']);
    });

    it('clamps a negative target to the start', () => {
      expect(moveBlock(order, new Set(['c']), -5)).toEqual(['c', 'a', 'b', 'd', 'e']);
    });

    it('returns the order unchanged for an empty set', () => {
      expect(moveBlock(order, new Set(), 2)).toEqual(order);
    });

    it('does not mutate its input', () => {
      const input = ['a', 'b', 'c', 'd', 'e'];
      moveBlock(input, new Set(['b', 'd']), 0);
      expect(input).toEqual(['a', 'b', 'c', 'd', 'e']);
    });
  });

  describe('sortByName', () => {
    it('sorts names naturally and case-insensitively', () => {
      const tabs = [
        { id: 'x', name: 'Tab 10' },
        { id: 'y', name: 'tab 2' },
        { id: 'z', name: 'Tab 1' }
      ];
      expect(sortByName(tabs)).toEqual(['z', 'y', 'x']);
    });

    it('keeps the original order for equal names', () => {
      const tabs = [
        { id: 'first', name: 'Same' },
        { id: 'second', name: 'same' },
        { id: 'third', name: 'Same' }
      ];
      expect(sortByName(tabs)).toEqual(['first', 'second', 'third']);
    });
  });

  describe('mergeAfterConflict', () => {
    it('drops removed tabs, appends new ones, and reports both by name', () => {
      const userTabs = [
        { id: 'c', name: 'C' },
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' }
      ];
      const fresh = [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
        { id: 'd', name: 'D' }
      ];
      expect(mergeAfterConflict(userTabs, fresh)).toEqual({
        order: ['a', 'b', 'd'],
        added: ['D'],
        removed: ['C']
      });
    });

    it('keeps the user order when nothing changed upstream', () => {
      const userTabs = [
        { id: 'b', name: 'B' },
        { id: 'a', name: 'A' }
      ];
      const fresh = [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' }
      ];
      expect(mergeAfterConflict(userTabs, fresh)).toEqual({
        order: ['b', 'a'],
        added: [],
        removed: []
      });
    });
  });
});
