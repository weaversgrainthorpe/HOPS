// A new dashboard's URL path, suggested from its name ("Media Room" → /media-room). The server
// still checks every path it is given; this only makes the suggestion one it will accept.

/** First path segments HOPS serves itself. Mirrors reservedDashboardSegments in
 * backend/internal/api/dashboard_handlers.go — keep the two in step. */
const RESERVED = new Set(['add', 'admin', 'settings', 'api', 'icons', 'backgrounds', 'presets', '_app']);

/** "Media Room!" → "media-room"; accents folded, anything else becomes a single hyphen. */
export function slugify(name: string): string {
	return name
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 60)
		.replace(/-+$/, '');
}

/** The path to suggest for a new dashboard called `name`, avoiding `taken` paths and reserved
 * segments by adding -2, -3, … (as imports do). A name with no usable letters falls back to a
 * timestamped path. */
export function suggestDashboardPath(name: string, taken: Iterable<string>, now = Date.now()): string {
	const base = slugify(name);
	if (!base) return `/dashboard-${now}`;
	const used = new Set([...taken].map((p) => p.toLowerCase()));
	const free = (p: string) => !used.has(p) && !RESERVED.has(p.slice(1));
	if (free(`/${base}`)) return `/${base}`;
	for (let n = 2; ; n++) {
		if (free(`/${base}-${n}`)) return `/${base}-${n}`;
	}
}
