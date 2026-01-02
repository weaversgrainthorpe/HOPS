import { writable } from 'svelte/store';
import type { Entry } from '$lib/types';

interface ClipboardItem {
  type: 'entry';
  data: Entry;
  operation: 'copy' | 'cut';
  sourceTabId?: string;
  sourceGroupId?: string;
}

export const clipboard = writable<ClipboardItem | null>(null);

export function copyEntry(entry: Entry, tabId: string, groupId: string) {
  clipboard.set({
    type: 'entry',
    data: { ...entry },
    operation: 'copy',
    sourceTabId: tabId,
    sourceGroupId: groupId
  });
}

export function cutEntry(entry: Entry, tabId: string, groupId: string) {
  clipboard.set({
    type: 'entry',
    data: { ...entry },
    operation: 'cut',
    sourceTabId: tabId,
    sourceGroupId: groupId
  });
}

export function clearClipboard() {
  clipboard.set(null);
}
