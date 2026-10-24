// M6 §7.7: type-ahead suggestions in the icon-name field. The ranking is a pure
// function over the names HOPS has offline (the bundled Iconify set plus the imported
// dashboard-icons), so it is tested here without a browser.
import { describe, it, expect } from 'vitest';
import {
	rankIconSuggestions,
	bundledSuggestions,
	dashboardSuggestions,
	type IconSuggestion
} from './iconSuggest';

const named = (...names: string[]): IconSuggestion[] => names.map((n) => ({ label: n, icon: n }));
const labels = (s: IconSuggestion[]) => s.map((x) => x.label);

describe('rankIconSuggestions', () => {
	const pool = named(
		'mdi:server-network',
		'mdi:server',
		'mdi:laser-pointer',
		'mdi:observer',
		'mdi:server-off',
		'mdi:serial-port',
		'mdi:server-plus',
		'mdi:server-minus',
		'mdi:home'
	);

	it('returns at most 5, prefix matches first (exact/shortest first), then contains matches', () => {
		const out = labels(rankIconSuggestions(pool, 'mdi:ser'));
		expect(out).toHaveLength(5);
		expect(out[0]).toBe('mdi:server');
		expect(out[1]).toBe('mdi:server-off'); // shorter first, then alphabetical
		// all five are prefix matches, so no contains match (laser, observer) gets in
		expect(out.every((l) => l.startsWith('mdi:ser'))).toBe(true);
	});

	it('puts contains matches after every prefix match', () => {
		const out = labels(rankIconSuggestions(pool, 'ser', 10));
		const firstContains = out.findIndex((l) => !l.split(':')[1].startsWith('ser'));
		expect(firstContains).toBeGreaterThan(0);
		expect(out.slice(firstContains).every((l) => !l.split(':')[1].startsWith('ser'))).toBe(true);
		expect(out).toContain('mdi:laser-pointer');
		expect(out).toContain('mdi:observer');
	});

	it('with a prefix in the query, a name of that set containing the rest is a contains match', () => {
		const out = labels(rankIconSuggestions([...pool, ...named('simple-icons:laser')], 'mdi:ser', 10));
		const contains = out.slice(out.findIndex((l) => !l.startsWith('mdi:ser')));
		expect(contains).toEqual(['mdi:observer', 'mdi:laser-pointer']);
		expect(out).not.toContain('simple-icons:laser');
	});

	it('treats the part after the colon as a prefix target when the query has no colon', () => {
		expect(labels(rankIconSuggestions(pool, 'hom'))).toEqual(['mdi:home']);
	});

	it('narrows as the query grows', () => {
		const a = rankIconSuggestions(pool, 'mdi:ser', 50);
		const b = rankIconSuggestions(pool, 'mdi:server-', 50);
		expect(b.length).toBeLessThan(a.length);
		expect(labels(b).every((l) => l.startsWith('mdi:server-'))).toBe(true);
	});

	it('is case-insensitive and ignores surrounding spaces', () => {
		expect(labels(rankIconSuggestions(pool, '  MDI:HOME '))).toEqual(['mdi:home']);
	});

	it('returns nothing for an empty query and for no match', () => {
		expect(rankIconSuggestions(pool, '')).toEqual([]);
		expect(rankIconSuggestions(pool, '   ')).toEqual([]);
		expect(rankIconSuggestions(pool, 'zzzz')).toEqual([]);
	});

	it('does not list the same label twice', () => {
		const out = rankIconSuggestions([...pool, ...named('mdi:server')], 'mdi:server', 10);
		expect(labels(out).filter((l) => l === 'mdi:server')).toHaveLength(1);
	});
});

describe('bundledSuggestions', () => {
	it('turns Iconify names into suggestions that set the icon name', () => {
		expect(bundledSuggestions(['mdi:home'])).toEqual([{ label: 'mdi:home', icon: 'mdi:home' }]);
	});
});

describe('dashboardSuggestions', () => {
	it('keeps only the imported dashboard-icons and sets their image URL', () => {
		const out = dashboardSuggestions([
			{ id: 'proxmox', name: 'Proxmox', icon: '', imageUrl: '/api/icons/dashboard/proxmox.svg' },
			{ id: 'mine', name: 'Mine', icon: '', imageUrl: '/uploads/icons/mine.png' },
			{ id: 'generic-server', name: 'Server', icon: 'mdi:server' }
		]);
		expect(out).toEqual([
			{ label: 'proxmox', imageUrl: '/api/icons/dashboard/proxmox.svg', source: 'dashboard-icons' }
		]);
	});
});
