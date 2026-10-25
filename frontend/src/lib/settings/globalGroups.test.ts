import { describe, it, expect } from 'vitest';
import registry from '../../../../backend/internal/settings/testdata/setting_keys.json';
import { GLOBAL_SETTING_GROUPS, OTHER_GROUP, groupSettings, jumpBehaviour } from './globalGroups';

// M6 §10: THE grouping table for Global settings (group → ordered keys). The server registry's key
// list is shared with the Go suite through backend/internal/settings/testdata/setting_keys.json
// (conventions in setting_keys.README.md), so a new server setting fails here until it is placed.
describe('global settings grouping table', () => {
	it('is the spec §10 table, in order', () => {
		expect(GLOBAL_SETTING_GROUPS.map((g) => [g.id, g.label])).toEqual([
			['server', 'Server'],
			['sign-in-security', 'Sign-in & security'],
			['uploads', 'Uploads'],
			['editing', 'Editing'],
			['look-motion', 'Look & motion'],
			['status-checks', 'Status checks'],
			['discovery', 'Discovery']
		]);
		const keysOf = (id: string) => GLOBAL_SETTING_GROUPS.find((g) => g.id === id)!.keys;
		expect(keysOf('look-motion')).toEqual(['display.animations', 'folders.animated_backgrounds']);
		expect(keysOf('editing')).toEqual(['editmode.idle_timeout_minutes']);
		expect(keysOf('status-checks')).toEqual([
			'status.checks_enabled', 'status.check_interval_minutes', 'status.check_timeout_seconds'
		]);
		expect(keysOf('uploads')).toEqual(['upload.max_bytes_background', 'upload.max_bytes_icon', 'upload.max_bytes_import']);
		expect(keysOf('discovery')).toEqual(['discovery.max_parallel_probes', 'discovery.per_host_timeout_seconds']);
		expect(keysOf('sign-in-security')).toEqual([
			'auth.session_lifetime_hours', 'auth.login_rate_limit_per_min', 'proxy.trusted_cidrs'
		]);
		const server = keysOf('server');
		expect(server.slice(0, 2)).toEqual(['server.port', 'log.level']);
		expect(server.slice(2).every((k) => k.startsWith('http.') && k.endsWith('timeout_seconds'))).toBe(true);
	});

	it('lists each key once, and group ids are unique and not "other"', () => {
		const keys = GLOBAL_SETTING_GROUPS.flatMap((g) => g.keys);
		expect(new Set(keys).size).toBe(keys.length);
		const ids = GLOBAL_SETTING_GROUPS.map((g) => g.id);
		expect(new Set(ids).size).toBe(ids.length);
		expect(ids).not.toContain(OTHER_GROUP.id);
	});

	it('has every key the server registry has (shared fixture with the Go suite)', () => {
		expect(registry.keys.length).toBeGreaterThan(0);
		const inTable = new Set(GLOBAL_SETTING_GROUPS.flatMap((g) => g.keys));
		const missing = registry.keys.filter((k) => !inTable.has(k));
		expect(missing, 'add these keys to GLOBAL_SETTING_GROUPS').toEqual([]);
	});

	it('lists no key the server registry no longer has', () => {
		const known = new Set(registry.keys);
		const stale = GLOBAL_SETTING_GROUPS.flatMap((g) => g.keys).filter((k) => !known.has(k));
		expect(stale, 'remove these keys from GLOBAL_SETTING_GROUPS').toEqual([]);
	});
});

describe('groupSettings', () => {
	const s = (key: string) => ({ key });

	it('orders groups and their keys by the table, whatever order the server sends', () => {
		const out = groupSettings([s('log.level'), s('display.animations'), s('server.port'), s('folders.animated_backgrounds')]);
		expect(out.map((g) => [g.id, g.items.map((i) => i.key)])).toEqual([
			['server', ['server.port', 'log.level']],
			['look-motion', ['display.animations', 'folders.animated_backgrounds']]
		]);
	});

	it('leaves out groups with no settings', () => {
		expect(groupSettings([s('editmode.idle_timeout_minutes')]).map((g) => g.id)).toEqual(['editing']);
		expect(groupSettings([])).toEqual([]);
	});

	it('never hides an unknown key: it goes in "Other", last, in the order sent', () => {
		const out = groupSettings([s('zeta.new'), s('log.level'), s('alpha.new')]);
		expect(out.map((g) => g.id)).toEqual(['server', 'other']);
		const other = out[1];
		expect(other.label).toBe('Other');
		expect(other.items.map((i) => i.key)).toEqual(['zeta.new', 'alpha.new']);
	});

	it('every registry key lands in a named group (none in "Other")', () => {
		const out = groupSettings(registry.keys.map(s));
		expect(out.find((g) => g.id === 'other')).toBeUndefined();
		expect(out.flatMap((g) => g.items).length).toBe(registry.keys.length);
	});
});

describe('jumpBehaviour', () => {
	it('glides only when Animations allows it on this device', () => {
		expect(jumpBehaviour('on', false)).toBe('smooth');
		expect(jumpBehaviour('on', true)).toBe('auto');
		expect(jumpBehaviour('always', true)).toBe('smooth');
		expect(jumpBehaviour('off', false)).toBe('auto');
		expect(jumpBehaviour(undefined, false)).toBe('auto');
		expect(jumpBehaviour('weird', false)).toBe('auto');
	});
});
