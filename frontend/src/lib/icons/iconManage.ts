/**
 * Settings › Icons: the page's logic, kept out of the component so it can be tested on its own.
 * "Uploaded" icons are the user's own images (an image URL, not built in): the same rule the icon
 * picker's "My Uploads" uses (isUploadedIcon). Every name here is plain text; nothing is HTML.
 */
import type { Icon, IconCategory } from '$lib/utils/api';

/** One place that shows an icon, as GET /api/icons/usage reports it. */
export interface IconUse {
	kind: 'tile' | 'folder' | 'tab' | 'dashboard';
	name: string;
	dashboardId: string;
	dashboard: string;
	tab?: string;
	folder?: string;
}

export interface IconUsage {
	fetchedAt: string;
	/** Icon id → the places using it (an empty list = unused). */
	icons: Record<string, IconUse[]>;
	/**
	 * The packaged icons in use: Dashboard Icons by image URL, Iconify icons by name. Only used
	 * icons are keys (the whole layout was read, so absent = not used). Missing = unknown.
	 */
	packaged?: { images: Record<string, IconUse[]>; names: Record<string, IconUse[]> };
}

const KINDS = ['tile', 'folder', 'tab', 'dashboard'] as const;

/** The icon picker's "My Uploads" rule, shared so the page and the picker always agree. */
export function isUploadedIcon(icon: Pick<Icon, 'imageUrl' | 'isPreset'>): boolean {
	return !!icon.imageUrl && !icon.isPreset;
}

function isUse(u: unknown): u is IconUse {
	if (!u || typeof u !== 'object') return false;
	const o = u as Record<string, unknown>;
	return (
		typeof o.kind === 'string' &&
		(KINDS as readonly string[]).includes(o.kind) &&
		typeof o.name === 'string' &&
		typeof o.dashboard === 'string' &&
		typeof o.dashboardId === 'string'
	);
}

/** Checks a usage answer's shape; anything else throws (never read as "unused"). */
export function parseUsageResponse(raw: unknown): IconUsage {
	if (!raw || typeof raw !== 'object') throw new Error('the server sent an unreadable answer');
	const o = raw as Record<string, unknown>;
	if (typeof o.fetchedAt !== 'string' || !o.icons || typeof o.icons !== 'object' || Array.isArray(o.icons)) {
		throw new Error('the server sent an unreadable answer');
	}
	const icons = useMap(o.icons);
	if (o.packaged === undefined) return { fetchedAt: o.fetchedAt, icons };
	const p = o.packaged as Record<string, unknown> | null;
	if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error('the server sent an unreadable answer');
	return { fetchedAt: o.fetchedAt, icons, packaged: { images: useMap(p.images), names: useMap(p.names) } };
}

/** A key → places map from the usage answer; anything else throws. */
function useMap(raw: unknown): Record<string, IconUse[]> {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('the server sent an unreadable answer');
	const out: Record<string, IconUse[]> = {};
	for (const [k, list] of Object.entries(raw as Record<string, unknown>)) {
		if (!Array.isArray(list) || !list.every(isUse)) throw new Error('the server sent an unreadable answer');
		out[k] = list;
	}
	return out;
}

function count(n: number, word: string): string {
	return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function joinAnd(parts: string[]): string {
	if (parts.length <= 1) return parts.join('');
	return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** "Used by 3 tiles on Home, Media", "Used by 2 tiles and 1 folder on Home", or "Not used". */
export function usageSummary(uses: readonly IconUse[]): string {
	if (uses.length === 0) return 'Not used';
	const parts = KINDS.map((k) => [k, uses.filter((u) => u.kind === k).length] as const)
		.filter(([, n]) => n > 0)
		.map(([k, n]) => count(n, k));
	const dashboards: string[] = [];
	for (const u of uses) if (!dashboards.includes(u.dashboard)) dashboards.push(u.dashboard);
	return `Used by ${joinAnd(parts)} on ${dashboards.map((d) => d || '(unnamed dashboard)').join(', ')}`;
}

const KIND_LABEL: Record<IconUse['kind'], string> = { tile: 'Tile', folder: 'Folder', tab: 'Tab', dashboard: 'Dashboard' };

/** One line per place, for the in-use warning: 'Tile "Plex" on Home › Main, in folder "Media"'. */
export function usePlace(u: IconUse): string {
	const name = u.name ? `"${u.name}"` : '(unnamed)';
	if (u.kind === 'dashboard') return `Dashboard ${name}`;
	const dash = u.dashboard || '(unnamed dashboard)';
	if (u.kind === 'tab') return `Tab ${name} on ${dash}`;
	let s = `${KIND_LABEL[u.kind]} ${name} on ${dash}${u.tab ? ` › ${u.tab}` : ''}`;
	if (u.folder) s += `, in folder "${u.folder}"`;
	return s;
}

/** Uploaded icons matching the search (name, case-insensitive) and the category filter ('' = all). */
export function filterIcons(icons: readonly Icon[], query: string, categoryId: string): Icon[] {
	const q = query.trim().toLowerCase();
	return icons
		.filter(isUploadedIcon)
		.filter((i) => !categoryId || i.categoryId === categoryId)
		.filter((i) => !q || i.name.toLowerCase().includes(q))
		.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

/** How many icons (any kind) are in each category. */
export function categoryCounts(icons: readonly Icon[]): Map<string, number> {
	const m = new Map<string, number>();
	for (const i of icons) m.set(i.categoryId, (m.get(i.categoryId) ?? 0) + 1);
	return m;
}

/** The user's own categories (not built in), in their order. */
export function userCategories(categories: readonly IconCategory[]): IconCategory[] {
	return categories.filter((c) => !c.isPreset).sort((a, b) => a.order - b.order);
}

/** A file's name as an icon name: no extension, at most 100 characters. */
export function nameFromFile(filename: string): string {
	const base = filename.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '').trim();
	return (base || 'Uploaded icon').slice(0, 100);
}

/** The name rules the server applies (trimmed, 1–100 characters); null when fine. */
export function nameProblem(name: string, what: 'icon' | 'category'): string | null {
	const n = name.trim();
	if (!n) return `The ${what} name can't be empty.`;
	if ([...n].length > 100) return `The ${what} name is too long (at most 100 characters).`;
	return null;
}

/** A new category's id: a slug of its name plus a random suffix (never shown). */
export function newCategoryId(name: string, rand: () => number = Math.random): string {
	const slug = name
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 40);
	const suffix = Math.floor(rand() * 36 ** 6)
		.toString(36)
		.padStart(6, '0');
	return `${slug || 'category'}-${suffix}`;
}

/** The allowed upload types (the server checks the same list). */
export const ICON_UPLOAD_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'] as const;

/** Why a file can't be uploaded before sending it, or null. */
export function uploadTypeProblem(file: Pick<File, 'type' | 'name'>): string | null {
	return (ICON_UPLOAD_TYPES as readonly string[]).includes(file.type)
		? null
		: 'Not an image HOPS can use. Use PNG, JPG, GIF, WebP or SVG.';
}

export interface UploadOutcome {
	file: string;
	ok: boolean;
	message: string;
}

/** The summary line for a batch of uploads. */
export function uploadSummary(results: readonly UploadOutcome[]): string {
	const ok = results.filter((r) => r.ok).length;
	const failed = results.length - ok;
	if (failed === 0) return `Uploaded ${count(ok, 'icon')}.`;
	if (ok === 0) return results.length === 1 ? 'The upload failed.' : `All ${results.length} uploads failed.`;
	return `Uploaded ${count(ok, 'icon')}; ${failed} failed.`;
}
