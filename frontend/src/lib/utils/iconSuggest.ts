// Type-ahead suggestions for the icon-name field.
//
// The names come only from icons HOPS has offline: the bundled Iconify set (registered by
// $lib/icons/offline-bundle, listed with listIcons) and the imported dashboard-icons (served
// by HOPS itself from /api/icons/dashboard/…). Ranking is pure so it is unit-tested.

/** One suggestion. Accepting it sets either an Iconify name (`icon`) or an image (`imageUrl`). */
export interface IconSuggestion {
	label: string;
	icon?: string;
	imageUrl?: string;
	source?: 'dashboard-icons';
}

export const SUGGESTION_LIMIT = 5;

/** The URL prefix of the imported dashboard-icons (backend: database/dashboard_icons.go). */
export const DASHBOARD_ICON_PREFIX = '/api/icons/dashboard/';

/**
 * The top `limit` suggestions for `query`: prefix matches first, then contains matches.
 * A prefix match is one where the whole label starts with the query or, for a query with no
 * colon, the part of the label after its colon does. A contains match is one whose label
 * contains the query or, for a query `set:rest`, a name of that set whose part after the colon
 * contains `rest`. Within each group shorter labels come first (so an exact name leads), then
 * alphabetical. Case-insensitive; an empty query suggests nothing.
 */
export function rankIconSuggestions(
	pool: readonly IconSuggestion[],
	query: string,
	limit = SUGGESTION_LIMIT
): IconSuggestion[] {
	const q = query.trim().toLowerCase();
	if (!q) return [];
	const prefix: IconSuggestion[] = [];
	const contains: IconSuggestion[] = [];
	const seen = new Set<string>();
	const qColon = q.indexOf(':');
	const qSet = qColon >= 0 ? q.slice(0, qColon) : null;
	const qRest = qColon >= 0 ? q.slice(qColon + 1) : q;
	for (const s of pool) {
		const l = s.label.toLowerCase();
		if (seen.has(l)) continue;
		const colon = l.indexOf(':');
		const tail = colon >= 0 ? l.slice(colon + 1) : l;
		const set = colon >= 0 ? l.slice(0, colon) : '';
		if (l.startsWith(q) || (qSet === null && tail.startsWith(q))) {
			prefix.push(s);
			seen.add(l);
		} else if (l.includes(q) || (qSet !== null && qRest !== '' && set === qSet && tail.includes(qRest))) {
			contains.push(s);
			seen.add(l);
		}
	}
	const order = (a: IconSuggestion, b: IconSuggestion) =>
		a.label.length - b.label.length || a.label.localeCompare(b.label);
	prefix.sort(order);
	contains.sort(order);
	return [...prefix, ...contains].slice(0, limit);
}

/** Suggestions for Iconify names (e.g. from listIcons('')). */
export function bundledSuggestions(names: readonly string[]): IconSuggestion[] {
	return names.map((n) => ({ label: n, icon: n }));
}

/** Suggestions for the imported dashboard-icons among the /api/icons rows; other rows are ignored. */
export function dashboardSuggestions(
	rows: readonly { id: string; imageUrl?: string; icon?: string; name?: string }[]
): IconSuggestion[] {
	return rows
		.filter((r) => r.imageUrl?.startsWith(DASHBOARD_ICON_PREFIX))
		.map((r) => ({ label: r.id, imageUrl: r.imageUrl, source: 'dashboard-icons' as const }));
}
