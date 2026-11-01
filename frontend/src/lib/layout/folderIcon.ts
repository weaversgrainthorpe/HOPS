import type { FolderNode } from '$lib/types/layout';

/** A minimised folder shows its own icon (not its contents) only when asked to and it has one. */
export function minimisedShowsOwnIcon(f: FolderNode): boolean {
  return f.minimisedIcon === 'own' && !!(f.iconUrl || f.icon);
}
