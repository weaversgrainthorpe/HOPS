import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import { toast } from './toast';

describe('toast store', () => {
	beforeEach(() => {
		toast.clear();
		vi.useFakeTimers();
	});

	it('starts empty', () => {
		expect(get(toast)).toEqual([]);
	});

	it('adds a toast via add()', () => {
		toast.add({ type: 'info', message: 'hello' });
		const items = get(toast);
		expect(items).toHaveLength(1);
		expect(items[0].message).toBe('hello');
		expect(items[0].type).toBe('info');
		expect(items[0].id).toBeTruthy();
	});

	it('generates unique IDs for each toast', () => {
		toast.info('one');
		toast.info('two');
		const items = get(toast);
		expect(items[0].id).not.toBe(items[1].id);
	});

	it('success() creates a success toast', () => {
		toast.success('saved');
		expect(get(toast)[0].type).toBe('success');
		expect(get(toast)[0].message).toBe('saved');
	});

	it('error() creates an error toast with longer default duration', () => {
		toast.error('failed');
		const t = get(toast)[0];
		expect(t.type).toBe('error');
		expect(t.duration).toBe(6000);
	});

	it('warning() creates a warning toast', () => {
		toast.warning('careful');
		expect(get(toast)[0].type).toBe('warning');
	});

	it('info() creates an info toast', () => {
		toast.info('fyi');
		expect(get(toast)[0].type).toBe('info');
	});

	it('auto-removes after the default duration', () => {
		toast.info('temporary');
		expect(get(toast)).toHaveLength(1);

		vi.advanceTimersByTime(4000);
		expect(get(toast)).toHaveLength(0);
	});

	it('respects custom duration', () => {
		toast.add({ type: 'info', message: 'short', duration: 1000 });
		expect(get(toast)).toHaveLength(1);

		vi.advanceTimersByTime(999);
		expect(get(toast)).toHaveLength(1);

		vi.advanceTimersByTime(1);
		expect(get(toast)).toHaveLength(0);
	});

	it('does not auto-remove when duration is 0', () => {
		toast.add({ type: 'info', message: 'persistent', duration: 0 });
		vi.advanceTimersByTime(60_000);
		expect(get(toast)).toHaveLength(1);
	});

	it('remove() drops a specific toast by id', () => {
		const id = toast.info('keep');
		toast.info('drop');
		expect(get(toast)).toHaveLength(2);

		toast.remove(id);
		const remaining = get(toast);
		expect(remaining).toHaveLength(1);
		expect(remaining[0].message).toBe('drop');
	});

	it('clear() removes all toasts', () => {
		toast.info('one');
		toast.info('two');
		toast.info('three');

		toast.clear();
		expect(get(toast)).toEqual([]);
	});

	it('remove() with unknown id is a no-op', () => {
		toast.info('one');
		toast.remove('not-a-real-id');
		expect(get(toast)).toHaveLength(1);
	});
});
