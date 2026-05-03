import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { clipboard, copyEntry, cutEntry, clearClipboard } from './clipboard';
import { toast } from './toast';
import type { Entry } from '$lib/types';

const makeEntry = (id: string, name = id): Entry => ({
	id,
	name,
	url: `https://${id}.test`,
	icon: 'mdi:test',
	openMode: 'newtab',
	size: 'medium',
	order: 0
});

describe('clipboard store', () => {
	beforeEach(() => {
		clearClipboard();
		toast.clear();
	});

	it('starts empty', () => {
		expect(get(clipboard)).toBeNull();
	});

	describe('copyEntry', () => {
		it('stores a copy operation', () => {
			copyEntry(makeEntry('plex'), 'tab1', 'group1');

			const item = get(clipboard);
			expect(item).not.toBeNull();
			expect(item!.type).toBe('entry');
			expect(item!.operation).toBe('copy');
			expect(item!.data.id).toBe('plex');
			expect(item!.sourceTabId).toBe('tab1');
			expect(item!.sourceGroupId).toBe('group1');
		});

		it('stores a deep copy of the entry, not a reference', () => {
			const original = makeEntry('plex');
			copyEntry(original, 't', 'g');

			// Mutating the original should not affect the clipboard
			original.name = 'modified';
			expect(get(clipboard)!.data.name).toBe('plex');
		});

		it('shows a toast on copy', () => {
			copyEntry(makeEntry('plex', 'Plex'), 't', 'g');

			const toasts = get(toast);
			expect(toasts).toHaveLength(1);
			expect(toasts[0].message).toContain('Plex');
		});

		it('replaces previous clipboard contents', () => {
			copyEntry(makeEntry('first'), 't', 'g');
			copyEntry(makeEntry('second'), 't', 'g');

			expect(get(clipboard)!.data.id).toBe('second');
		});
	});

	describe('cutEntry', () => {
		it('stores a cut operation', () => {
			cutEntry(makeEntry('plex'), 'tab1', 'group1');

			const item = get(clipboard);
			expect(item!.operation).toBe('cut');
			expect(item!.data.id).toBe('plex');
		});

		it('shows a toast on cut', () => {
			cutEntry(makeEntry('plex', 'Plex'), 't', 'g');

			const toasts = get(toast);
			expect(toasts[0].message).toContain('Plex');
			expect(toasts[0].message).toContain('Cut');
		});

		it('also stores a deep copy', () => {
			const original = makeEntry('plex');
			cutEntry(original, 't', 'g');

			original.name = 'modified';
			expect(get(clipboard)!.data.name).toBe('plex');
		});
	});

	describe('clearClipboard', () => {
		it('resets to null', () => {
			copyEntry(makeEntry('a'), 't', 'g');
			clearClipboard();
			expect(get(clipboard)).toBeNull();
		});

		it('is a no-op when already empty', () => {
			expect(() => clearClipboard()).not.toThrow();
			expect(get(clipboard)).toBeNull();
		});
	});
});
