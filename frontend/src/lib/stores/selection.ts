import { writable, get } from 'svelte/store';
import type { Entry } from '$lib/types';

interface SelectedEntry {
  entry: Entry;
  tabId: string;
  groupId: string;
}

// Primary/focused entry for keyboard actions (Ctrl+C, Ctrl+X)
export const selectedEntry = writable<SelectedEntry | null>(null);

export function selectEntry(entry: Entry, tabId: string, groupId: string) {
  selectedEntry.set({ entry, tabId, groupId });
}

// Multi-selection support
export const selectedEntries = writable<SelectedEntry[]>([]);

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

export function isEntrySelected(entryId: string, tabId: string, groupId: string): boolean {
  const items = get(selectedEntries);
  return items.some(
    item => item.entry.id === entryId && item.tabId === tabId && item.groupId === groupId
  );
}
