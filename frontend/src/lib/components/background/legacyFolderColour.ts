import type { Background } from '$lib/types';

/**
 * A folder background of type `color` (M6 §7.5). Folders take their colour from the Edit Folder
 * dialog now, so the folder background picker offers pictures only — but a stored colour background
 * still renders and is never dropped silently: the dialogs show it and offer "Use as folder colour".
 */
export function isLegacyFolderColour(bg: Background | undefined | null): boolean {
  return !!bg && bg.type === 'color';
}

/**
 * What "Use as folder colour" sets: the colour (a #rgb / #rrggbb value, the only kind a folder colour
 * can be) and, when the colour background was showing at a reduced opacity, that opacity — or the
 * reason it can't be used.
 */
export function folderColourFromBackground(
  bg: Background | undefined | null
): { ok: true; color: string; opacity?: number } | { ok: false; problem: string } {
  if (!bg || bg.type !== 'color') return { ok: false, problem: 'This folder has no colour background.' };
  const v = typeof bg.value === 'string' ? bg.value.trim() : '';
  if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) {
    return { ok: false, problem: `Its colour (${v || 'empty'}) isn't a #rrggbb colour, so it can't be used as the folder colour. Pick a folder colour instead.` };
  }
  const op = bg.opacity;
  const opacity = !bg.inherit && typeof op === 'number' && Number.isFinite(op) && op < 1 ? Math.max(0, op) : undefined;
  return { ok: true, color: v.toLowerCase(), ...(opacity !== undefined ? { opacity } : {}) };
}
