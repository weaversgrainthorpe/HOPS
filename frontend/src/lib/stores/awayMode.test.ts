import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';

const KEY = 'hops_away_mode';

describe('awayMode store (per browser)', () => {
	beforeEach(() => {
		vi.resetModules();
		localStorage.clear();
	});
	it('defaults to Home', async () => {
		const { awayMode } = await import('./awayMode');
		expect(get(awayMode)).toBe(false);
	});
	it('persists Away and reads it back on the next load', async () => {
		const m1 = await import('./awayMode');
		m1.setAway(true);
		expect(localStorage.getItem(KEY)).toBe('away');
		vi.resetModules();
		const m2 = await import('./awayMode');
		expect(get(m2.awayMode)).toBe(true);
		m2.setAway(false);
		expect(localStorage.getItem(KEY)).toBe('home');
	});
	it('an unknown stored value is Home', async () => {
		localStorage.setItem(KEY, 'banana');
		const { awayMode } = await import('./awayMode');
		expect(get(awayMode)).toBe(false);
	});
	it('works when storage throws (private mode): Home, no crash', async () => {
		const g = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
		const s = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
		const { awayMode, setAway } = await import('./awayMode');
		expect(get(awayMode)).toBe(false);
		expect(() => setAway(true)).not.toThrow();
		expect(get(awayMode)).toBe(true);
		g.mockRestore();
		s.mockRestore();
	});
});
