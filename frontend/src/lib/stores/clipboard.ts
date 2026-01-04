import { writable } from 'svelte/store';
import type { Entry } from '$lib/types';
import { toast } from './toast';

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
  toast.info(`Copied "${entry.name}"`);
}

export function cutEntry(entry: Entry, tabId: string, groupId: string) {
  clipboard.set({
    type: 'entry',
    data: { ...entry },
    operation: 'cut',
    sourceTabId: tabId,
    sourceGroupId: groupId
  });
  toast.info(`Cut "${entry.name}"`);
}

export function clearClipboard() {
  clipboard.set(null);
}
