// Type-ahead suggestions draw their pictures after a pause in
// typing, in one batched load, and show "unavailable" — never a blank — when that fails.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { namesToFetch, SuggestionPreviewLoader, type BatchLoad } from './suggestionPreview';

describe('namesToFetch', () => {
	it('keeps whole names that are not loaded, failed or in flight; drops duplicates and bare text', () => {
		const loaded = new Set(['mdi:server']);
		expect(
			namesToFetch(
				['mdi:server', 'mdi:server-off', 'mdi:serial-port', 'mdi:server-off', 'mdi:server-plus', 'ser', ''],
				(n) => loaded.has(n),
				new Set(['mdi:serial-port']),
				new Set(['mdi:server-plus'])
			)
		).toEqual(['mdi:server-off']);
	});
});

describe('SuggestionPreviewLoader', () => {
	let loaded: Set<string>;
	let online: boolean;
	let calls: string[][];
	let pendingDone: ((l: string[], m: string[], p: string[]) => void) | null;
	let onChange: ReturnType<typeof vi.fn<() => void>>;
	let aborted: number;
	const load: BatchLoad = (names, done) => {
		calls.push([...names]);
		pendingDone = done;
		return () => { aborted++; };
	};
	const make = () =>
		new SuggestionPreviewLoader({
			load,
			isLoaded: (n) => loaded.has(n),
			isOnline: () => online,
			onChange,
			pauseMs: 300,
			timeoutMs: 5000
		});

	beforeEach(() => {
		vi.useFakeTimers();
		loaded = new Set(['mdi:server']);
		online = true;
		calls = [];
		pendingDone = null;
		onChange = vi.fn<() => void>();
		aborted = 0;
	});
	afterEach(() => vi.useRealTimers());

	it('requests nothing while the list keeps changing, then one batch after the pause', () => {
		const l = make();
		l.schedule(['mdi:server', 'mdi:serial-port']);
		vi.advanceTimersByTime(200);
		l.schedule(['mdi:server', 'mdi:server-off', 'mdi:server-plus']);
		vi.advanceTimersByTime(299);
		expect(calls).toEqual([]);
		vi.advanceTimersByTime(1);
		expect(calls).toEqual([['mdi:server-off', 'mdi:server-plus']]);
	});

	it('is loading until loaded, then ready', () => {
		const l = make();
		expect(l.state('mdi:server')).toBe('ready');
		expect(l.state('mdi:server-off')).toBe('loading');
		l.schedule(['mdi:server-off']);
		vi.advanceTimersByTime(300);
		loaded.add('mdi:server-off');
		pendingDone!(['mdi:server-off'], [], []);
		expect(l.state('mdi:server-off')).toBe('ready');
		expect(onChange).toHaveBeenCalled();
	});

	it('remembers a failure: unavailable, and never asked for again', () => {
		const l = make();
		l.schedule(['mdi:a', 'mdi:b']);
		vi.advanceTimersByTime(300);
		loaded.add('mdi:a');
		pendingDone!(['mdi:a'], ['mdi:b'], []);
		expect(l.state('mdi:b')).toBe('unavailable');
		l.schedule(['mdi:a', 'mdi:b']);
		vi.advanceTimersByTime(300);
		expect(calls).toEqual([['mdi:a', 'mdi:b']]);
	});

	it('does not ask again for names already in flight', () => {
		const l = make();
		l.schedule(['mdi:a']);
		vi.advanceTimersByTime(300);
		l.schedule(['mdi:a', 'mdi:b']);
		vi.advanceTimersByTime(300);
		expect(calls).toEqual([['mdi:a'], ['mdi:b']]);
	});

	it('offline: requests nothing and says offline', () => {
		online = false;
		const l = make();
		l.schedule(['mdi:a']);
		vi.advanceTimersByTime(1000);
		expect(calls).toEqual([]);
		expect(l.state('mdi:a')).toBe('offline');
		expect(l.state('mdi:server')).toBe('ready');
	});

	it('a batch that never answers fails after the timeout (aborted, unavailable)', () => {
		const l = make();
		l.schedule(['mdi:a']);
		vi.advanceTimersByTime(300);
		expect(l.state('mdi:a')).toBe('loading');
		vi.advanceTimersByTime(5000);
		expect(aborted).toBe(1);
		expect(l.state('mdi:a')).toBe('unavailable');
		pendingDone!(['mdi:a'], [], []); // a late answer after the timeout is ignored
		expect(l.state('mdi:a')).toBe('unavailable');
	});

	it('dispose cancels the pending pause', () => {
		const l = make();
		l.schedule(['mdi:a']);
		l.dispose();
		vi.advanceTimersByTime(1000);
		expect(calls).toEqual([]);
	});
});
