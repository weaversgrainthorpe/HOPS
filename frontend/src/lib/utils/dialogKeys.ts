/**
 * Keyboard handling shared by every modal dialog (shared/Modal and the hand-built pickers).
 *
 * A dialog's content element stops every keydown from leaving it, so no key reaches the page
 * behind (arrow-key tile navigation, the "/" search hotkey, the editor's Delete / Ctrl+Z...).
 * That used to swallow Escape too: the dialogs listened for Escape on `window`, which a stopped
 * event never reaches, so Escape did nothing in a real browser (only jsdom tests, which fire on
 * window, saw it work). Now the content element handles Escape itself — the focused (innermost)
 * dialog closes, and only it — and `window` is just the fallback for focus outside every dialog.
 */

/** The open modal dialogs, bottom to top (folder overlay panels are not edit dialogs). */
const DIALOGS = '[role="dialog"][aria-modal="true"]:not(.overlay-panel)';

/** True while any modal dialog (not a folder overlay panel) is open. */
export function modalDialogOpen(root: ParentNode = document): boolean {
  return root.querySelector(DIALOGS) !== null;
}

/** True when `el` is the last-opened (topmost) modal dialog: dialogs are portalled to <body> in opening order. */
export function isTopmostDialog(el: Element): boolean {
  const all = document.querySelectorAll(DIALOGS);
  return all.length > 0 && all[all.length - 1] === el;
}

/**
 * The keydown handler of a dialog's content element: Escape closes this dialog (unless something
 * inside already handled it, e.g. an open dropdown, or it ends an IME composition); no key leaves
 * the dialog.
 */
export function dialogContentKeydown(e: KeyboardEvent, close: () => void): void {
  e.stopPropagation();
  if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing) return;
  e.preventDefault();
  close();
}

/**
 * The window keydown fallback, for an Escape pressed while focus is outside every dialog (e.g. on
 * <body>): only the topmost dialog closes, and the event is marked handled for everyone else.
 */
export function dialogWindowEscape(e: KeyboardEvent, el: Element | null | undefined, close: () => void): void {
  if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing || !el) return;
  if (!isTopmostDialog(el)) return;
  e.preventDefault();
  close();
}
