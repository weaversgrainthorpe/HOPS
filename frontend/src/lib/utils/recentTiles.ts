// "Recently used" (per browser): the tiles this viewer opens most, kept in this browser only
// (localStorage). No accounts, nothing is sent to the server: a viewer convenience, like Home/Away.
// Off until the viewer turns it on; while off nothing is recorded.
//
// Ranking is frecency: each tile keeps one count that halves every RECENT_HALF_LIFE_MS, so a
// tile used often stays near the top and old use fades. Stored as {id, count, last}; the count is
// decayed to `now` whenever it is bumped or ranked (O(1) per tile, no event log).
//
// Storage can be missing or throw (private windows, blocked site data): every access is wrapped,
// and the row then simply has nothing to show (the on/off choice still lasts for this page load).
import { writable } from 'svelte/store';
import type { LayoutDashboard, LayoutNode } from '$lib/types/layout';

export interface RecentEntry {
	id: string;
	count: number;
	/** ms since epoch of the last open. */
	last: number;
}

export const RECENT_MAX_ENTRIES = 50;
export const RECENT_MAX_DASHBOARDS = 30;
export const RECENT_SHOW = 8;
export const RECENT_HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000;

const ON_KEY = 'hops_recent_on';
const DATA_KEY = 'hops_recent_tiles';

/** The entry's count decayed to `now` (never inflated by a clock that went backwards). */
export function decayedCount(e: RecentEntry, now: number): number {
	const age = Math.max(0, now - e.last);
	return e.count * Math.pow(0.5, age / RECENT_HALF_LIFE_MS);
}

/** One more open of `id` at `now`; keeps at most `max` entries, dropping the weakest. Pure. */
export function recordIn(list: RecentEntry[], id: string, now: number, max = RECENT_MAX_ENTRIES): RecentEntry[] {
	const prev = list.find((e) => e.id === id);
	const bumped: RecentEntry = { id, count: (prev ? decayedCount(prev, now) : 0) + 1, last: now };
	const out = [bumped, ...list.filter((e) => e.id !== id)];
	if (out.length <= max) return out;
	return out
		.map((e) => ({ e, s: decayedCount(e, now) }))
		.sort((a, b) => b.s - a.s || b.e.last - a.e.last)
		.slice(0, max)
		.map((x) => x.e);
}

/** The ids to show, best first: only tiles that still exist (`live`), at most `limit`. Pure. */
export function rankRecent(
	list: RecentEntry[],
	now: number,
	live: (id: string) => boolean,
	limit = RECENT_SHOW
): string[] {
	return list
		.filter((e) => live(e.id))
		.map((e) => ({ id: e.id, s: decayedCount(e, now), last: e.last }))
		.sort((a, b) => b.s - a.s || b.last - a.last)
		.slice(0, limit)
		.map((x) => x.id);
}

/** Every link tile on the dashboard (every tab, any folder depth), by id. Notes never open. */
export function liveTiles(d: LayoutDashboard | null | undefined): Map<string, LayoutNode> {
	const m = new Map<string, LayoutNode>();
	const walk = (nodes: LayoutNode[] | undefined) => {
		if (!Array.isArray(nodes)) return;
		for (const n of nodes) {
			if (!n || typeof n !== 'object') continue;
			if (n.kind === 'folder') walk(n.content?.children);
			else if (n.kind === 'tile' && n.type !== 'note' && typeof n.id === 'string') m.set(n.id, n);
		}
	};
	for (const t of d?.tabs ?? []) walk(t?.root?.children);
	return m;
}

// ---- storage ----

type Stored = Record<string, RecentEntry[]>;

const valid = (e: unknown): e is RecentEntry =>
	!!e &&
	typeof e === 'object' &&
	typeof (e as RecentEntry).id === 'string' &&
	Number.isFinite((e as RecentEntry).count) &&
	Number.isFinite((e as RecentEntry).last);

function readAll(): Stored {
	try {
		const raw = localStorage.getItem(DATA_KEY);
		if (!raw) return {};
		const parsed = JSON.parse(raw) as { v?: number; d?: Record<string, unknown> };
		const out: Stored = {};
		if (!parsed || typeof parsed.d !== 'object' || parsed.d === null) return {};
		for (const [k, v] of Object.entries(parsed.d)) {
			if (Array.isArray(v)) out[k] = v.filter(valid).slice(0, RECENT_MAX_ENTRIES);
		}
		return out;
	} catch {
		return {};
	}
}

function writeAll(s: Stored): void {
	// Bound the number of dashboards too: drop the ones used longest ago.
	const keys = Object.keys(s);
	if (keys.length > RECENT_MAX_DASHBOARDS) {
		const newest = (k: string) => Math.max(0, ...s[k].map((e) => e.last));
		keys.sort((a, b) => newest(b) - newest(a));
		for (const k of keys.slice(RECENT_MAX_DASHBOARDS)) delete s[k];
	}
	try {
		localStorage.setItem(DATA_KEY, JSON.stringify({ v: 1, d: s }));
	} catch {
		// Not remembered in this browser.
	}
}

/** This browser's stored on/off choice (off when unset or storage is unavailable). */
export function readRecentOn(): boolean {
	try {
		return typeof localStorage !== 'undefined' && localStorage.getItem(ON_KEY) === 'on';
	} catch {
		return false;
	}
}

/** Show the "Recently used" row (and record opens) in this browser. */
export const recentOn = writable<boolean>(readRecentOn());
/** Bumped whenever the stored history changes, so the row re-ranks then (and only then). */
export const recentVersion = writable(0);

export function setRecentOn(on: boolean): void {
	recentOn.set(on);
	try {
		localStorage.setItem(ON_KEY, on ? 'on' : 'off');
	} catch {
		// Not remembered in this browser; the choice still applies until reload.
	}
}

let on = false;
recentOn.subscribe((v) => (on = v));

/** The dashboard's stored history (unranked). */
export function loadRecent(dashboardId: string): RecentEntry[] {
	return readAll()[dashboardId] ?? [];
}

/** The one place an open is recorded (Entry's open path and search's direct open). No-op while off. */
export function recordTileOpen(dashboardId: string | undefined, tileId: string, now = Date.now()): void {
	if (!on || !dashboardId || !tileId) return;
	const all = readAll();
	all[dashboardId] = recordIn(all[dashboardId] ?? [], tileId, now);
	writeAll(all);
	recentVersion.update((n) => n + 1);
}

/** Forget every dashboard's history in this browser. */
export function clearRecent(): void {
	try {
		localStorage.removeItem(DATA_KEY);
	} catch {
		// Nothing stored, or storage blocked: nothing to clear.
	}
	recentVersion.update((n) => n + 1);
}

/** Svelte context key: Dashboard provides the recorder its tiles use. */
export const RECENT_CONTEXT = Symbol('hops-recent');
export interface RecentContext {
	record(tileId: string): void;
}
