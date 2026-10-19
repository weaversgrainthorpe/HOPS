import { writable, readonly, get } from 'svelte/store';
import type { Container, LayoutDoc } from '$lib/types/layout';
import { findLayoutDashboard } from './config';

// Stack of open folder ids for the current tab (bottom first).
const stack = writable<string[]>([]);
export const overlayStack = readonly(stack);

export function openFolder(id: string): void {
  stack.update((s) => [...s, id]);
}

export function closeTop(): void {
  stack.update((s) => s.slice(0, -1));
}

/** Close down to `depth` open overlays (0 closes everything). */
export function closeTo(depth: number): void {
  stack.update((s) => s.slice(0, Math.max(0, depth)));
}

export function closeAll(): void {
  stack.set([]);
}

function collectIds(c: Container | undefined, out: Set<string>): void {
  const kids = Array.isArray(c?.children) ? c!.children : [];
  for (const n of kids) {
    if (n && typeof n === 'object' && (n as { kind?: unknown }).kind === 'folder') {
      const f = n as { id?: unknown; content?: Container };
      if (typeof f.id === 'string') out.add(f.id);
      collectIds(f.content, out);
    }
  }
}

/**
 * Drop open ids whose folder no longer exists in the dashboard, from the
 * bottom-most missing one upward (everything above a vanished folder goes too).
 * Returns the dropped ids; a missing doc/dashboard drops everything.
 */
export function reconcile(doc: LayoutDoc | null, dashboardId: string): string[] {
  const ids = new Set<string>();
  const dash = findLayoutDashboard(dashboardId, doc);
  for (const t of dash?.tabs ?? []) collectIds(t.root, ids);
  const current = get(stack);
  const firstMissing = current.findIndex((id) => !ids.has(id));
  if (firstMissing === -1) return [];
  stack.set(current.slice(0, firstMissing));
  return current.slice(firstMissing);
}
