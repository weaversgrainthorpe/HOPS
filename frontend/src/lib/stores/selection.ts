import { writable, derived, get } from 'svelte/store';
import type { Entry } from '$lib/types';

interface SelectedEntry {
  entry: Entry;
  tabId: string;
  groupId: string;
}

// Legacy single selection (kept for compatibility)
export const selectedEntry = writable<SelectedEntry | null>(null);

export function selectEntry(entry: Entry, tabId: string, groupId: string) {
  selectedEntry.set({ entry, tabId, groupId });
}

export function clearSelection() {
  selectedEntry.set(null);
  selectedEntries.set([]);
}

// Multi-selection support
export const selectedEntries = writable<SelectedEntry[]>([]);

export const selectionCount = derived(selectedEntries, $selectedEntries => $selectedEntries.length);

export function toggleEntrySelection(entry: Entry, tabId: string, groupId: string) {
  selectedEntries.update(items => {
    const index = items.findIndex(
      item => item.entry.id === entry.id && item.tabId === tabId && item.groupId === groupId
    );

    if (index >= 0) {
      // Already selected, remove it
      return items.filter((_, i) => i !== index);
    } else {
      // Not selected, add it
      return [...items, { entry, tabId, groupId }];
    }
  });
}

export function addToSelection(entry: Entry, tabId: string, groupId: string) {
  selectedEntries.update(items => {
    const exists = items.some(
      item => item.entry.id === entry.id && item.tabId === tabId && item.groupId === groupId
    );

    if (!exists) {
      return [...items, { entry, tabId, groupId }];
    }
    return items;
  });
}

export function removeFromSelection(entryId: string, tabId: string, groupId: string) {
  selectedEntries.update(items => items.filter(
    item => !(item.entry.id === entryId && item.tabId === tabId && item.groupId === groupId)
  ));
}

export function isEntrySelected(entryId: string, tabId: string, groupId: string): boolean {
  const items = get(selectedEntries);
  return items.some(
    item => item.entry.id === entryId && item.tabId === tabId && item.groupId === groupId
  );
}

export function clearMultiSelection() {
  selectedEntries.set([]);
}

export function selectAll(entries: Entry[], tabId: string, groupId: string) {
  const selections = entries.map(entry => ({ entry, tabId, groupId }));
  selectedEntries.set(selections);
}

export function getSelectedEntries() {
  return get(selectedEntries);
}
