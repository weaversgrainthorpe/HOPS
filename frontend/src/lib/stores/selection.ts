import { writable } from 'svelte/store';
import type { Entry } from '$lib/types';

interface SelectedEntry {
  entry: Entry;
  tabId: string;
  groupId: string;
}

export const selectedEntry = writable<SelectedEntry | null>(null);

export function selectEntry(entry: Entry, tabId: string, groupId: string) {
  selectedEntry.set({ entry, tabId, groupId });
}

export function clearSelection() {
  selectedEntry.set(null);
}
