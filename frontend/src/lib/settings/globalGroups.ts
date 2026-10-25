/**
 * Global settings groups (M6 §10): THE one table that says which group each global setting is
 * in, and in what order. Global settings stays one long page; these groups are its sections, and
 * the settings sidebar (phones: a chip row on the page) links to each one.
 *
 * A key the server sends that is not in this table is never hidden: it goes in an "Other" group
 * at the end. globalGroups.test.ts fails when the server registry (shared fixture
 * backend/internal/settings/testdata/setting_keys.json) has a key this table lacks.
 */
export interface SettingGroupDef {
	/** The section's id, which is also its URL hash (#look-motion). */
	id: string;
	label: string;
	/** Its settings, in the order shown. */
	keys: readonly string[];
}

// The order was set by Jonathan (spec §10).
export const GLOBAL_SETTING_GROUPS: readonly SettingGroupDef[] = [
	{
		id: 'server',
		label: 'Server',
		keys: [
			'server.port',
			'log.level',
			'http.read_header_timeout_seconds',
			'http.read_timeout_seconds',
			'http.write_timeout_seconds',
			'http.idle_timeout_seconds',
			'backup.keep_count',
			'backup.keep_days',
			'backup.max_count'
		]
	},
	{
		id: 'sign-in-security',
		label: 'Sign-in & security',
		keys: ['auth.session_lifetime_hours', 'auth.login_rate_limit_per_min', 'proxy.trusted_cidrs']
	},
	{ id: 'uploads', label: 'Uploads', keys: ['upload.max_bytes_background', 'upload.max_bytes_icon', 'upload.max_bytes_import'] },
	{ id: 'editing', label: 'Editing', keys: ['editmode.idle_timeout_minutes'] },
	{ id: 'look-motion', label: 'Look & motion', keys: ['display.animations', 'folders.animated_backgrounds'] },
	{
		id: 'status-checks',
		label: 'Status checks',
		keys: ['status.checks_enabled', 'status.check_interval_minutes', 'status.check_timeout_seconds']
	},
	{ id: 'discovery', label: 'Discovery', keys: ['discovery.max_parallel_probes', 'discovery.per_host_timeout_seconds'] }
];

/** Where keys missing from the table go: last, never hidden. */
export const OTHER_GROUP = { id: 'other', label: 'Other' } as const;

export interface SettingGroup<T> {
	id: string;
	label: string;
	items: T[];
}

/** The settings in their groups, in table order; a group with none is left out. */
export function groupSettings<T extends { key: string }>(settings: readonly T[]): SettingGroup<T>[] {
	const byKey = new Map(settings.map((s) => [s.key, s]));
	const placed = new Set<string>();
	const out: SettingGroup<T>[] = [];
	for (const g of GLOBAL_SETTING_GROUPS) {
		const items: T[] = [];
		for (const k of g.keys) {
			const s = byKey.get(k);
			if (s) {
				items.push(s);
				placed.add(k);
			}
		}
		if (items.length) out.push({ id: g.id, label: g.label, items });
	}
	const other = settings.filter((s) => !placed.has(s.key));
	if (other.length) out.push({ id: OTHER_GROUP.id, label: OTHER_GROUP.label, items: other });
	return out;
}

/**
 * How a group link moves the page: a glide when the "Animations" setting allows motion on this
 * device (Always; or On without a reduced-motion request), otherwise a jump.
 */
export function jumpBehaviour(animations: string | undefined, reducedMotion: boolean): ScrollBehavior {
	if (animations === 'always') return 'smooth';
	if (animations === 'on' && !reducedMotion) return 'smooth';
	return 'auto';
}
