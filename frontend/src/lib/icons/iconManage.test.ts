import { describe, it, expect } from 'vitest';
import {
	usageSummary,
	usePlace,
	filterIcons,
	categoryCounts,
	userCategories,
	nameFromFile,
	nameProblem,
	newCategoryId,
	parseUsageResponse,
	uploadTypeProblem,
	uploadSummary,
	isUploadedIcon,
	type IconUse
} from './iconManage';
import type { Icon, IconCategory } from '$lib/utils/api';

const use = (kind: IconUse['kind'], name: string, dashboard: string, extra: Partial<IconUse> = {}): IconUse => ({
	kind,
	name,
	dashboard,
	dashboardId: dashboard.toLowerCase(),
	...extra
});

const icon = (id: string, name: string, extra: Partial<Icon> = {}): Icon => ({
	id,
	name,
	icon: '',
	categoryId: 'mine',
	imageUrl: `/icons/${id}.png`,
	isPreset: false,
	createdAt: '',
	...extra
});

describe('usageSummary', () => {
	it('says Not used for none', () => expect(usageSummary([])).toBe('Not used'));
	it('counts tiles and names the dashboards once, in order', () => {
		expect(usageSummary([use('tile', 'a', 'Home'), use('tile', 'b', 'Media'), use('tile', 'c', 'Home')])).toBe(
			'Used by 3 tiles on Home, Media'
		);
	});
	it('one of a kind is singular; several kinds are joined', () => {
		expect(usageSummary([use('tile', 'a', 'Home')])).toBe('Used by 1 tile on Home');
		expect(
			usageSummary([use('tile', 'a', 'Home'), use('folder', 'f', 'Home'), use('tab', 't', 'Home'), use('tile', 'b', 'Home')])
		).toBe('Used by 2 tiles, 1 folder and 1 tab on Home');
	});
});

describe('usePlace', () => {
	it('names the kind, the item and where it is', () => {
		expect(usePlace(use('tile', 'Plex', 'Home', { tab: 'Main' }))).toBe('Tile "Plex" on Home › Main');
		expect(usePlace(use('tile', 'Plex', 'Home', { tab: 'Main', folder: 'Media' }))).toBe('Tile "Plex" on Home › Main, in folder "Media"');
		expect(usePlace(use('tab', 'Main', 'Home', { tab: 'Main' }))).toBe('Tab "Main" on Home');
		expect(usePlace(use('dashboard', 'Home', 'Home'))).toBe('Dashboard "Home"');
		expect(usePlace(use('folder', '', 'Home'))).toBe('Folder (unnamed) on Home');
	});
});

describe('filterIcons', () => {
	const icons = [
		icon('b', 'Bravo'),
		icon('a', 'alpha'),
		icon('c', 'Charlie', { categoryId: 'other' }),
		icon('p', 'Preset', { isPreset: true }),
		icon('i', 'Iconify only', { imageUrl: undefined })
	];
	it('keeps only uploads (the picker rule), sorted by name', () => {
		expect(filterIcons(icons, '', '').map((i) => i.id)).toEqual(['a', 'b', 'c']);
		expect(isUploadedIcon(icons[3])).toBe(false);
		expect(isUploadedIcon(icons[4])).toBe(false);
	});
	it('searches names case-insensitively and filters by category', () => {
		expect(filterIcons(icons, ' ALP ', '').map((i) => i.id)).toEqual(['a']);
		expect(filterIcons(icons, '', 'other').map((i) => i.id)).toEqual(['c']);
		expect(filterIcons(icons, 'zzz', '')).toEqual([]);
	});
});

describe('categories', () => {
	it('counts icons per category', () => {
		const m = categoryCounts([icon('a', 'a'), icon('b', 'b'), icon('c', 'c', { categoryId: 'x', isPreset: true })]);
		expect(m.get('mine')).toBe(2);
		expect(m.get('x')).toBe(1);
		expect(m.get('none')).toBeUndefined();
	});
	it('lists only the user’s own, in order', () => {
		const cats: IconCategory[] = [
			{ id: 'p', name: 'P', icon: '', order: 0, isPreset: true, createdAt: '' },
			{ id: 'b', name: 'B', icon: '', order: 5, isPreset: false, createdAt: '' },
			{ id: 'a', name: 'A', icon: '', order: 2, isPreset: false, createdAt: '' }
		];
		expect(userCategories(cats).map((c) => c.id)).toEqual(['a', 'b']);
	});
});

describe('names', () => {
	it('derives a name from the file', () => {
		expect(nameFromFile('my-server.png')).toBe('my-server');
		expect(nameFromFile('C:\\x\\plex.svg')).toBe('plex');
		expect(nameFromFile('.png')).toBe('Uploaded icon');
		expect(nameFromFile('x'.repeat(150) + '.png')).toHaveLength(100);
	});
	it('checks names like the server', () => {
		expect(nameProblem('  ', 'icon')).toMatch(/can't be empty/);
		expect(nameProblem('x'.repeat(101), 'category')).toMatch(/too long/);
		expect(nameProblem('<b>ok</b>', 'icon')).toBeNull();
	});
	it('makes a category id from the name plus a suffix', () => {
		expect(newCategoryId('My Things!', () => 0)).toBe('my-things-000000');
		expect(newCategoryId('***', () => 0.5)).toMatch(/^category-[0-9a-z]{6}$/);
	});
});

describe('parseUsageResponse', () => {
	it('accepts a well-formed answer', () => {
		const r = parseUsageResponse({ fetchedAt: 'now', icons: { a: [use('tile', 'x', 'Home')], b: [] } });
		expect(r.icons.b).toEqual([]);
		expect(r.icons.a[0].name).toBe('x');
	});
	it.each([null, {}, { fetchedAt: 'x', icons: [] }, { fetchedAt: 'x', icons: { a: [{ kind: 'nope' }] } }, { fetchedAt: 'x', icons: { a: 'no' } }])(
		'refuses %j (never "unused")',
		(raw) => expect(() => parseUsageResponse(raw)).toThrow(/unreadable/)
	);
});

describe('uploads', () => {
	it('refuses non-images before sending', () => {
		expect(uploadTypeProblem({ type: 'text/plain', name: 'a.txt' })).toMatch(/PNG, JPG, GIF, WebP or SVG/);
		expect(uploadTypeProblem({ type: 'image/svg+xml', name: 'a.svg' })).toBeNull();
	});
	it('summarises a batch', () => {
		expect(uploadSummary([{ file: 'a', ok: true, message: '' }, { file: 'b', ok: true, message: '' }])).toBe('Uploaded 2 icons.');
		expect(uploadSummary([{ file: 'a', ok: true, message: '' }, { file: 'b', ok: false, message: 'x' }])).toBe('Uploaded 1 icon; 1 failed.');
		expect(uploadSummary([{ file: 'a', ok: false, message: 'x' }])).toBe('The upload failed.');
		expect(uploadSummary([{ file: 'a', ok: false, message: 'x' }, { file: 'b', ok: false, message: 'x' }])).toBe('All 2 uploads failed.');
	});
});
