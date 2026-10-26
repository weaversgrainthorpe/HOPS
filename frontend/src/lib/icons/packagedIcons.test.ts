import { describe, it, expect } from 'vitest';
import {
	buildPackagedPool,
	searchPackaged,
	paginate,
	packagedUses,
	parsePackagedResponse,
	packagedCounts,
	PACKAGED_PAGE_SIZE,
	SOURCE_LABEL,
	type PackagedIcon
} from './packagedIcons';
import type { Icon } from '$lib/utils/api';
import type { IconUsage } from './iconManage';

const row = (id: string, name: string, extra: Partial<Icon> = {}): Icon => ({
	id,
	name,
	icon: '',
	categoryId: 'media',
	isPreset: true,
	createdAt: '',
	...extra
});

const library: Icon[] = [
	row('plex', 'Plex', { imageUrl: '/api/icons/dashboard/plex.svg', categoryId: 'media' }),
	row('sonarr', 'Sonarr', { imageUrl: '/api/icons/dashboard/sonarr.svg', categoryId: 'downloads' }),
	row('media-generic', 'Media', { icon: 'mdi:filmstrip', categoryId: 'media' }),
	row('net-generic', 'Network', { icon: 'mdi:lan-connect', categoryId: 'networking' }),
	// The user's own upload: never packaged.
	row('mine', 'My plex picture', { imageUrl: '/icons/mine.png', isPreset: false })
];

const pool = buildPackagedPool({
	dashboardNames: ['plex', 'plex-dark', 'sonarr', 'complex-thing'],
	libraryIcons: library,
	bundled: ['mdi:filmstrip', 'mdi:server', 'simple-icons:plex', 'other:thing'],
	allNames: ['mdi:server', 'mdi:filmstrip', 'mdi:plex', 'mdi:server-network', 'mdi:lan-connect', 'simple-icons:plex', 'simple-icons:jellyfin']
});

const keys = (list: PackagedIcon[]) => list.map((i) => i.key);

describe('buildPackagedPool', () => {
	it('has every source, each item labelled with its set and whether it is offline', () => {
		const plex = pool.find((i) => i.key === 'dashboard:plex')!;
		expect(plex).toMatchObject({ label: 'Plex', name: 'plex', imageUrl: '/api/icons/dashboard/plex.svg', offline: true, categoryId: 'media' });
		// A shipped file without a library row still appears (by its file name), with no category.
		expect(pool.find((i) => i.key === 'dashboard:plex-dark')).toMatchObject({ label: 'plex-dark', offline: true, categoryId: undefined });
		expect(pool.find((i) => i.key === 'preset:media-generic')).toMatchObject({ label: 'Media', name: 'mdi:filmstrip', icon: 'mdi:filmstrip', offline: true });
		expect(pool.find((i) => i.key === 'preset:net-generic')).toMatchObject({ offline: false });
		expect(pool.find((i) => i.key === 'mdi:server')).toMatchObject({ source: 'mdi', offline: true });
		expect(pool.find((i) => i.key === 'mdi:server-network')).toMatchObject({ source: 'mdi', offline: false });
		expect(pool.find((i) => i.key === 'simple-icons:jellyfin')).toMatchObject({ source: 'simple-icons', offline: false });
		expect(SOURCE_LABEL).toEqual({ dashboard: 'Dashboard Icons', preset: 'Preset library', mdi: 'Material Design', 'simple-icons': 'Simple Icons' });
	});

	it('never includes uploads, other icon sets, or duplicates', () => {
		expect(pool.some((i) => i.imageUrl === '/icons/mine.png')).toBe(false);
		expect(pool.some((i) => i.key.startsWith('other:'))).toBe(false);
		expect(new Set(keys(pool)).size).toBe(pool.length);
		expect(pool.filter((i) => i.key === 'mdi:server')).toHaveLength(1);
	});

	it('before the names list loads, the offline names are still there', () => {
		const p = buildPackagedPool({ dashboardNames: [], libraryIcons: [], bundled: ['mdi:server', 'simple-icons:plex'], allNames: null });
		expect(keys(p)).toEqual(['mdi:server', 'simple-icons:plex']);
	});

	it('without the server list, the Dashboard Icons come from the library rows', () => {
		const p = buildPackagedPool({ dashboardNames: null, libraryIcons: library, bundled: [], allNames: null });
		expect(keys(p.filter((i) => i.source === 'dashboard'))).toEqual(['dashboard:plex', 'dashboard:sonarr']);
	});
});

describe('searchPackaged', () => {
	it('searches every source at once, exact names first, Dashboard Icons leading a tie', () => {
		const r = searchPackaged(pool, 'plex', '');
		expect(keys(r).slice(0, 3)).toEqual(['dashboard:plex', 'mdi:plex', 'simple-icons:plex']);
		// Then prefix matches, then contains matches.
		expect(keys(r)).toEqual(['dashboard:plex', 'mdi:plex', 'simple-icons:plex', 'dashboard:plex-dark', 'dashboard:complex-thing']);
	});

	it('matches the display name and the Iconify name, case-insensitively', () => {
		expect(keys(searchPackaged(pool, 'NETWORK', ''))).toEqual(['preset:net-generic', 'mdi:server-network']);
		expect(keys(searchPackaged(pool, 'mdi:server', ''))).toEqual(['mdi:server', 'mdi:server-network']);
		expect(keys(searchPackaged(pool, 'filmstrip', ''))).toEqual(['preset:media-generic', 'mdi:filmstrip']);
	});

	it('filters by source', () => {
		expect(keys(searchPackaged(pool, 'plex', 'dashboard'))).toEqual(['dashboard:plex', 'dashboard:plex-dark', 'dashboard:complex-thing']);
		expect(keys(searchPackaged(pool, 'plex', 'simple-icons'))).toEqual(['simple-icons:plex']);
		expect(keys(searchPackaged(pool, 'plex', 'preset'))).toEqual([]);
		expect(searchPackaged(pool, '', 'mdi').every((i) => i.source === 'mdi')).toBe(true);
	});

	it('filters by built-in category (only icons that have one)', () => {
		expect(keys(searchPackaged(pool, '', '', 'media'))).toEqual(['dashboard:plex', 'preset:media-generic']);
	});

	it('an empty query lists everything in source order', () => {
		const r = searchPackaged(pool, '  ', '');
		expect(r).toHaveLength(pool.length);
		const order = r.map((i) => i.source);
		expect(order.indexOf('preset')).toBeGreaterThan(order.lastIndexOf('dashboard'));
		expect(order.indexOf('mdi')).toBeGreaterThan(order.lastIndexOf('preset'));
		expect(order.indexOf('simple-icons')).toBeGreaterThan(order.lastIndexOf('mdi'));
	});
});

describe('paginate', () => {
	const list = Array.from({ length: 101 }, (_, i) => i);
	it('slices a page and reports its range', () => {
		expect(PACKAGED_PAGE_SIZE).toBeLessThanOrEqual(60);
		const p = paginate(list, 1, 48);
		expect(p).toMatchObject({ page: 1, pages: 3, start: 1, end: 48, total: 101 });
		expect(p.items).toEqual(list.slice(0, 48));
		expect(paginate(list, 3, 48)).toMatchObject({ page: 3, start: 97, end: 101, items: list.slice(96) });
	});
	it('clamps the page and handles an empty list', () => {
		expect(paginate(list, 9, 48).page).toBe(3);
		expect(paginate(list, 0, 48).page).toBe(1);
		expect(paginate([], 2, 48)).toMatchObject({ page: 1, pages: 1, start: 0, end: 0, total: 0, items: [] });
	});
});

describe('packagedUses', () => {
	const usage: IconUsage = {
		fetchedAt: 'x',
		icons: {},
		packaged: {
			images: { '/api/icons/dashboard/plex.svg': [{ kind: 'tile', name: 'Plex', dashboard: 'Home', dashboardId: 'd1' }] },
			names: { 'mdi:filmstrip': [{ kind: 'tab', name: 'Media', dashboard: 'Home', dashboardId: 'd1' }] }
		}
	};
	const get = (k: string) => pool.find((i) => i.key === k)!;
	it('finds images by URL and Iconify icons by name; unused is an empty list', () => {
		expect(packagedUses(usage, get('dashboard:plex'))).toHaveLength(1);
		expect(packagedUses(usage, get('preset:media-generic'))).toHaveLength(1);
		expect(packagedUses(usage, get('mdi:filmstrip'))).toHaveLength(1);
		expect(packagedUses(usage, get('mdi:server'))).toEqual([]);
	});
	it('is unknown (null) when the usage was not loaded or lacks the packaged part', () => {
		expect(packagedUses(null, get('dashboard:plex'))).toBeNull();
		expect(packagedUses({ fetchedAt: 'x', icons: {} }, get('dashboard:plex'))).toBeNull();
	});
});

describe('parsePackagedResponse', () => {
	it('reads a good answer', () => {
		const r = parsePackagedResponse({ fetchedAt: 't', dashboardIcons: { count: 2, names: ['a', 'b'] }, dashboardRows: 1, presetRows: 170 });
		expect(r).toEqual({ fetchedAt: 't', dashboardNames: ['a', 'b'], dashboardCount: 2, dashboardRows: 1, presetRows: 170 });
	});
	it('throws on anything else (never read as zero)', () => {
		expect(() => parsePackagedResponse(null)).toThrow();
		expect(() => parsePackagedResponse({ fetchedAt: 't', dashboardIcons: { count: 3, names: ['a'] }, dashboardRows: 1, presetRows: 1 })).toThrow();
		expect(() => parsePackagedResponse({ fetchedAt: 't', dashboardIcons: { count: 1, names: ['a'] }, presetRows: 1 })).toThrow();
		expect(() => parsePackagedResponse({ fetchedAt: 't', dashboardIcons: { count: 1, names: [1] }, dashboardRows: 1, presetRows: 1 })).toThrow();
	});
});

describe('packagedCounts', () => {
	it('counts the offline Iconify icons per set', () => {
		expect(packagedCounts(['mdi:a', 'mdi:b', 'simple-icons:c', 'other:d'])).toEqual({ mdi: 2, 'simple-icons': 1, total: 4 });
	});
});
