import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import {
	selectedEntry,
	selectedEntries,
	selectEntry,
	toggleEntrySelection,
	isEntrySelected
} from './selection';
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

describe('selectedEntry (single)', () => {
	beforeEach(() => {
		selectedEntry.set(null);
	});

	it('starts as null', () => {
		expect(get(selectedEntry)).toBeNull();
	});

	it('selectEntry sets the focused entry', () => {
		const e = makeEntry('plex');
		selectEntry(e, 'tab1', 'group1');

		const selected = get(selectedEntry);
		expect(selected).not.toBeNull();
		expect(selected!.entry.id).toBe('plex');
		expect(selected!.tabId).toBe('tab1');
		expect(selected!.groupId).toBe('group1');
	});

	it('selecting a new entry replaces the previous one', () => {
		selectEntry(makeEntry('first'), 't', 'g');
		selectEntry(makeEntry('second'), 't', 'g');

		expect(get(selectedEntry)!.entry.id).toBe('second');
	});
});

describe('toggleEntrySelection (multi)', () => {
	beforeEach(() => {
		selectedEntries.set([]);
	});

	it('starts empty', () => {
		expect(get(selectedEntries)).toEqual([]);
	});

	it('adds an entry on first toggle', () => {
		toggleEntrySelection(makeEntry('a'), 't', 'g');
		expect(get(selectedEntries)).toHaveLength(1);
	});

	it('removes an entry on second toggle', () => {
		const e = makeEntry('a');
		toggleEntrySelection(e, 't', 'g');
		toggleEntrySelection(e, 't', 'g');
		expect(get(selectedEntries)).toEqual([]);
	});

	it('treats same id in different groups as distinct', () => {
		const e = makeEntry('shared');
		toggleEntrySelection(e, 't1', 'g1');
		toggleEntrySelection(e, 't1', 'g2');
		expect(get(selectedEntries)).toHaveLength(2);
	});

	it('treats same id in different tabs as distinct', () => {
		const e = makeEntry('shared');
		toggleEntrySelection(e, 't1', 'g1');
		toggleEntrySelection(e, 't2', 'g1');
		expect(get(selectedEntries)).toHaveLength(2);
	});

	it('builds up multiple selections', () => {
		toggleEntrySelection(makeEntry('a'), 't', 'g');
		toggleEntrySelection(makeEntry('b'), 't', 'g');
		toggleEntrySelection(makeEntry('c'), 't', 'g');

		const items = get(selectedEntries);
		expect(items.map((i) => i.entry.id)).toEqual(['a', 'b', 'c']);
	});
});

describe('isEntrySelected', () => {
	beforeEach(() => {
		selectedEntries.set([]);
	});

	it('returns false when nothing is selected', () => {
		expect(isEntrySelected('a', 't', 'g')).toBe(false);
	});

	it('returns true after toggling', () => {
		toggleEntrySelection(makeEntry('a'), 't', 'g');
		expect(isEntrySelected('a', 't', 'g')).toBe(true);
	});

	it('returns false after toggling off', () => {
		const e = makeEntry('a');
		toggleEntrySelection(e, 't', 'g');
		toggleEntrySelection(e, 't', 'g');
		expect(isEntrySelected('a', 't', 'g')).toBe(false);
	});

	it('matches require all three keys (id, tabId, groupId)', () => {
		toggleEntrySelection(makeEntry('a'), 't1', 'g1');
		expect(isEntrySelected('a', 't1', 'g1')).toBe(true);
		expect(isEntrySelected('a', 't2', 'g1')).toBe(false);
		expect(isEntrySelected('a', 't1', 'g2')).toBe(false);
		expect(isEntrySelected('b', 't1', 'g1')).toBe(false);
	});
});
