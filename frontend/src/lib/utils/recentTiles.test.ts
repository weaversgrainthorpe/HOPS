import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { get } from 'svelte/store';
import {
	recordIn,
	rankRecent,
	decayedCount,
	liveTiles,
	RECENT_MAX_ENTRIES,
	RECENT_HALF_LIFE_MS,
	RECENT_SHOW,
	loadRecent,
	recordTileOpen,
	clearRecent,
	recentOn,
	setRecentOn,
	recentVersion,
	readRecentOn
} from './recentTiles';
import type { LayoutDashboard } from '$lib/types/layout';

const DAY = 24 * 60 * 60 * 1000;
const T0 = 1_800_000_000_000;

describe('frecency (pure)', () => {
	it('records a new tile with count 1 and bumps an existing one', () => {
		let l = recordIn([], 'a', T0);
		expect(l).toEqual([{ id: 'a', count: 1, last: T0 }]);
		l = recordIn(l, 'a', T0);
		expect(l[0].count).toBe(2);
	});

	it('decays a count by half every half-life', () => {
		const e = { id: 'a', count: 4, last: T0 };
		expect(decayedCount(e, T0)).toBe(4);
		expect(decayedCount(e, T0 + RECENT_HALF_LIFE_MS)).toBeCloseTo(2);
		expect(decayedCount(e, T0 + 2 * RECENT_HALF_LIFE_MS)).toBeCloseTo(1);
		// A clock that went backwards never inflates a count.
		expect(decayedCount(e, T0 - DAY)).toBe(4);
	});

	it('ranks by count weighted by recency: often beats once, but old use fades', () => {
		let l = recordIn([], 'often', T0);
		l = recordIn(l, 'often', T0 + 1);
		l = recordIn(l, 'often', T0 + 2);
		l = recordIn(l, 'once', T0 + 3);
		expect(rankRecent(l, T0 + 4, () => true)).toEqual(['often', 'once']);
		// Weeks later, one fresh open beats three old ones.
		const later = T0 + 6 * RECENT_HALF_LIFE_MS;
		l = recordIn(l, 'fresh', later);
		expect(rankRecent(l, later, () => true)[0]).toBe('fresh');
	});

	it('equal use: the most recent first', () => {
		let l = recordIn([], 'a', T0);
		l = recordIn(l, 'b', T0 + 1000);
		l = recordIn(l, 'c', T0 + 2000);
		expect(rankRecent(l, T0 + 3000, () => true)).toEqual(['c', 'b', 'a']);
	});

	it('shows at most the limit (8 by default)', () => {
		let l: ReturnType<typeof recordIn> = [];
		for (let i = 0; i < 20; i++) l = recordIn(l, `t${i}`, T0 + i);
		expect(rankRecent(l, T0 + 100, () => true)).toHaveLength(RECENT_SHOW);
		expect(RECENT_SHOW).toBe(8);
		expect(rankRecent(l, T0 + 100, () => true, 3)).toEqual(['t19', 't18', 't17']);
	});

	it('keeps at most 50 entries, dropping the weakest', () => {
		let l = recordIn([], 'keep', T0);
		for (let i = 0; i < 5; i++) l = recordIn(l, 'keep', T0);
		for (let i = 0; i < 80; i++) l = recordIn(l, `t${i}`, T0 + 1000 + i);
		expect(l.length).toBe(RECENT_MAX_ENTRIES);
		const ids = l.map((e) => e.id);
		expect(ids).toContain('keep');
		expect(ids).toContain('t79');
		expect(ids).not.toContain('t0');
	});

	it('drops tiles that no longer exist (pruning, not an error)', () => {
		let l = recordIn([], 'gone', T0);
		l = recordIn(l, 'here', T0 + 1);
		expect(rankRecent(l, T0 + 2, (id) => id === 'here')).toEqual(['here']);
	});

	it('liveTiles finds link tiles on every tab and in folders, not notes', () => {
		const tile = (id: string, extra: Record<string, unknown> = {}) => ({ id, kind: 'tile', type: 'link', name: id, ...extra });
		const d = {
			id: 'd',
			tabs: [
				{ id: 't1', root: { children: [tile('a'), tile('n', { type: 'note' }), { id: 'f', kind: 'folder', content: { children: [tile('b')] } }] } },
				{ id: 't2', root: { children: [tile('c')] } },
				{ id: 't3' }
			]
		} as unknown as LayoutDashboard;
		const m = liveTiles(d);
		expect([...m.keys()].sort()).toEqual(['a', 'b', 'c']);
		expect(liveTiles(null).size).toBe(0);
	});
});

describe('storage (per browser)', () => {
	beforeEach(() => {
		localStorage.clear();
		setRecentOn(false);
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('is off by default and records nothing while off', () => {
		localStorage.clear();
		expect(readRecentOn()).toBe(false);
		recordTileOpen('d', 'a', T0);
		expect(loadRecent('d')).toEqual([]);
	});

	it('records per dashboard when on, and clear empties it', () => {
		setRecentOn(true);
		const v0 = get(recentVersion);
		recordTileOpen('d1', 'a', T0);
		recordTileOpen('d2', 'b', T0);
		expect(loadRecent('d1').map((e) => e.id)).toEqual(['a']);
		expect(loadRecent('d2').map((e) => e.id)).toEqual(['b']);
		expect(get(recentVersion)).toBeGreaterThan(v0);
		clearRecent();
		expect(loadRecent('d1')).toEqual([]);
		expect(loadRecent('d2')).toEqual([]);
	});

	it('remembers the on/off choice', () => {
		setRecentOn(true);
		expect(get(recentOn)).toBe(true);
		expect(readRecentOn()).toBe(true);
		setRecentOn(false);
		expect(readRecentOn()).toBe(false);
	});

	it('corrupt stored history reads as empty', () => {
		localStorage.setItem('hops_recent_tiles', '{not json');
		expect(loadRecent('d')).toEqual([]);
		localStorage.setItem('hops_recent_tiles', JSON.stringify({ v: 1, d: { d: [{ id: 5 }, null, { id: 'ok', count: 1, last: T0 }] } }));
		expect(loadRecent('d').map((e) => e.id)).toEqual(['ok']);
	});

	it('storage unavailable: nothing throws, and the choice still applies for this page', () => {
		const boom = () => {
			throw new Error('blocked');
		};
		vi.spyOn(Storage.prototype, 'getItem').mockImplementation(boom);
		vi.spyOn(Storage.prototype, 'setItem').mockImplementation(boom);
		vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(boom);
		expect(() => setRecentOn(true)).not.toThrow();
		expect(get(recentOn)).toBe(true);
		expect(readRecentOn()).toBe(false);
		expect(() => recordTileOpen('d', 'a', T0)).not.toThrow();
		expect(loadRecent('d')).toEqual([]);
		expect(() => clearRecent()).not.toThrow();
	});
});
