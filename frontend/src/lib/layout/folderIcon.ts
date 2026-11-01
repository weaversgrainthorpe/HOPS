import type { FolderNode } from '$lib/types/layout';

/** A minimised folder shows its own icon (not its contents) only when asked to and it has one. */
export function minimisedShowsOwnIcon(f: FolderNode): boolean {
  return f.minimisedIcon === 'own' && !!(f.iconUrl || f.icon);
}

/** Said where "Its own icon" is chosen but no icon is set (the icons inside show instead). */
export const NO_OWN_ICON_NOTE = 'No icon set, so it shows the icons inside.';
