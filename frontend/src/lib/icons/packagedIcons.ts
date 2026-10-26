/**
 * Settings › Icons › Packaged icons: everything that ships with HOPS, searched as one list.
 *
 * The sources are the same data the icon picker and the icon editor use, never a copy:
 *  - Dashboard Icons: the SVGs embedded in the server (GET /api/icons/packaged lists them),
 *    with names and categories from their icon-library rows where there is one;
 *  - the preset library: the built-in icon-library rows that name an Iconify icon;
 *  - Material Design and Simple Icons: every name in the full lists ($lib/icons/iconNames),
 *    plus the offline bundle (listIcons) so the offline ones are there before that list loads.
 *
 * Each item says which set it is from and whether it draws with no internet. Pure functions, so
 * the page's search, filter and pagination are unit-tested. Every name is plain text.
 */
import type { Icon } from '$lib/utils/api';
import { DASHBOARD_ICON_PREFIX } from '$lib/utils/iconSuggest';
import type { IconUsage, IconUse } from './iconManage';

export type PackagedSource = 'dashboard' | 'preset' | 'mdi' | 'simple-icons';

export const SOURCE_ORDER: readonly PackagedSource[] = ['dashboard', 'preset', 'mdi', 'simple-icons'];

export const SOURCE_LABEL: Record<PackagedSource, string> = {
	dashboard: 'Dashboard Icons',
	preset: 'Preset library',
	mdi: 'Material Design',
	'simple-icons': 'Simple Icons'
};

/** At most this many results are drawn at once (the Pi Zero tenet: never thousands of nodes). */
export const PACKAGED_PAGE_SIZE = 48;

export interface PackagedIcon {
	/** Unique: "dashboard:<file>", "preset:<row id>", or the Iconify name. */
	key: string;
	/** What the card shows as its name. */
	label: string;
	/** What "Copy name" copies: the Iconify name, or the Dashboard Icons file name. */
	name: string;
	source: PackagedSource;
	/** An Iconify name (preset, mdi, simple-icons). */
	icon?: string;
	/** A Dashboard Icons image, served by HOPS. */
	imageUrl?: string;
	/** Draws with no internet (served by HOPS, or in the offline bundle). */
	offline: boolean;
	/** The built-in category, for icons that have a library row. */
	categoryId?: string;
}

export interface PackagedInputs {
	/** The shipped Dashboard Icons file names from the server; null when they couldn't be loaded. */
	dashboardNames: readonly string[] | null;
	/** The icon library's rows (the picker's data). */
	libraryIcons: readonly Icon[];
	/** The offline Iconify names (listIcons('')). */
	bundled: readonly string[];
	/** The full mdi / simple-icons names (loadIconNames().suggest); null until loaded or if it failed. */
	allNames: readonly string[] | null;
}

const ICONIFY_SETS = new Set<PackagedSource>(['mdi', 'simple-icons']);

const byLabel = (a: PackagedIcon, b: PackagedIcon) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });

/** Every packaged icon, in source order (Dashboard Icons, preset library, mdi, simple-icons). */
export function buildPackagedPool(inp: PackagedInputs): PackagedIcon[] {
	const bundled = new Set(inp.bundled);
	const rowsByImage = new Map<string, Icon>();
	for (const r of inp.libraryIcons) if (r.isPreset && r.imageUrl?.startsWith(DASHBOARD_ICON_PREFIX)) rowsByImage.set(r.imageUrl, r);

	const dashboard: PackagedIcon[] = [];
	if (inp.dashboardNames) {
		for (const n of inp.dashboardNames) {
			const imageUrl = `${DASHBOARD_ICON_PREFIX}${n}.svg`;
			const r = rowsByImage.get(imageUrl);
			dashboard.push({ key: `dashboard:${n}`, label: r?.name || n, name: n, source: 'dashboard', imageUrl, offline: true, categoryId: r?.categoryId });
		}
	} else {
		for (const [imageUrl, r] of rowsByImage) {
			const n = imageUrl.slice(DASHBOARD_ICON_PREFIX.length).replace(/\.svg$/, '');
			dashboard.push({ key: `dashboard:${n}`, label: r.name || n, name: n, source: 'dashboard', imageUrl, offline: true, categoryId: r.categoryId });
		}
		dashboard.sort((a, b) => a.name.localeCompare(b.name));
	}

	const preset: PackagedIcon[] = inp.libraryIcons
		.filter((r) => r.isPreset && !r.imageUrl && r.icon)
		.map((r) => ({ key: `preset:${r.id}`, label: r.name || r.icon, name: r.icon, source: 'preset' as const, icon: r.icon, offline: bundled.has(r.icon), categoryId: r.categoryId }))
		.sort(byLabel);

	const sets: Record<string, PackagedIcon[]> = { mdi: [], 'simple-icons': [] };
	const seen = new Set<string>();
	for (const n of [...inp.bundled, ...(inp.allNames ?? [])]) {
		if (seen.has(n)) continue;
		const prefix = n.slice(0, n.indexOf(':'));
		if (!ICONIFY_SETS.has(prefix as PackagedSource)) continue;
		seen.add(n);
		sets[prefix].push({ key: n, label: n, name: n, source: prefix as PackagedSource, icon: n, offline: bundled.has(n) });
	}
	for (const list of Object.values(sets)) list.sort((a, b) => a.name.localeCompare(b.name));

	return [...dashboard, ...preset, ...sets.mdi, ...sets['simple-icons']];
}

/** How well an item matches q (lower case): 0 exact, 1 prefix, 2 word start, 3 contains, -1 no. */
function score(item: PackagedIcon, q: string): number {
	const label = item.label.toLowerCase();
	const name = item.name.toLowerCase();
	const colon = name.indexOf(':');
	const tail = colon >= 0 ? name.slice(colon + 1) : name;
	const texts = [label, name, tail];
	if (texts.some((t) => t === q)) return 0;
	if (texts.some((t) => t.startsWith(q))) return 1;
	if (texts.some((t) => t.includes(`-${q}`) || t.includes(` ${q}`))) return 2;
	if (texts.some((t) => t.includes(q))) return 3;
	return -1;
}

/**
 * The packaged icons matching `query` across every source (or only `source`, '' = all, and only
 * `categoryId`, '' = any). Exact matches first, then prefix, word-start and contains matches;
 * within a group by source (Dashboard Icons first), then shorter names, then A–Z. An empty query
 * lists everything in source order.
 */
export function searchPackaged(pool: readonly PackagedIcon[], query: string, source: PackagedSource | '', categoryId = ''): PackagedIcon[] {
	const q = query.trim().toLowerCase();
	const base = pool.filter((i) => (!source || i.source === source) && (!categoryId || i.categoryId === categoryId));
	if (!q) return base;
	const scored: { item: PackagedIcon; s: number; tail: number }[] = [];
	for (const item of base) {
		const s = score(item, q);
		if (s < 0) continue;
		const colon = item.name.indexOf(':');
		scored.push({ item, s, tail: item.name.length - (colon + 1) });
	}
	const rank = (x: PackagedIcon) => SOURCE_ORDER.indexOf(x.source);
	scored.sort((a, b) => a.s - b.s || rank(a.item) - rank(b.item) || a.tail - b.tail || a.item.name.localeCompare(b.item.name));
	return scored.map((x) => x.item);
}

export interface Page<T> {
	items: T[];
	/** 1-based, clamped to the pages there are. */
	page: number;
	pages: number;
	/** 1-based positions of the first and last item shown (0 when empty). */
	start: number;
	end: number;
	total: number;
}

export function paginate<T>(list: readonly T[], page: number, size = PACKAGED_PAGE_SIZE): Page<T> {
	const total = list.length;
	const pages = Math.max(1, Math.ceil(total / size));
	const p = Math.min(Math.max(1, Math.floor(page) || 1), pages);
	const from = (p - 1) * size;
	const items = list.slice(from, from + size);
	return { items, page: p, pages, start: items.length ? from + 1 : 0, end: from + items.length, total };
}

/** Where a packaged icon is used; null = unknown (usage not loaded, or without the packaged part). */
export function packagedUses(usage: IconUsage | null, item: PackagedIcon): IconUse[] | null {
	if (!usage?.packaged) return null;
	if (item.imageUrl) return usage.packaged.images[item.imageUrl] ?? [];
	return item.icon ? (usage.packaged.names[item.icon] ?? []) : [];
}

export interface PackagedInfo {
	fetchedAt: string;
	dashboardNames: string[];
	/** Every Dashboard Icons SVG shipped (light/dark variants included). */
	dashboardCount: number;
	/** How many of them are icon-library rows. */
	dashboardRows: number;
	/** Preset library rows (built-in Iconify icons). */
	presetRows: number;
}

const isCount = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0;

/** Checks GET /api/icons/packaged; anything else throws (never read as zero). */
export function parsePackagedResponse(raw: unknown): PackagedInfo {
	const bad = () => new Error('the server sent an unreadable answer');
	if (!raw || typeof raw !== 'object') throw bad();
	const o = raw as Record<string, unknown>;
	const d = o.dashboardIcons as Record<string, unknown> | undefined;
	if (typeof o.fetchedAt !== 'string' || !d || typeof d !== 'object') throw bad();
	if (!isCount(d.count) || !Array.isArray(d.names) || !d.names.every((n) => typeof n === 'string') || d.names.length !== d.count) throw bad();
	if (!isCount(o.dashboardRows) || !isCount(o.presetRows)) throw bad();
	return { fetchedAt: o.fetchedAt, dashboardNames: d.names as string[], dashboardCount: d.count, dashboardRows: o.dashboardRows, presetRows: o.presetRows };
}

/** The offline Iconify icons per set (from listIcons('')). */
export function packagedCounts(bundled: readonly string[]): { mdi: number; 'simple-icons': number; total: number } {
	let mdi = 0;
	let si = 0;
	for (const n of bundled) {
		if (n.startsWith('mdi:')) mdi++;
		else if (n.startsWith('simple-icons:')) si++;
	}
	return { mdi, 'simple-icons': si, total: bundled.length };
}
