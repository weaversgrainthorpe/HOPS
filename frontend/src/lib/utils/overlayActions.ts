import { tick } from 'svelte';

/** Move the node to <body> so no transformed/filtered ancestor can trap position:fixed. */
export function portal(node: HTMLElement) {
  document.body.appendChild(node);
  return { destroy: () => node.remove() };
}

export function inertUnless(node: HTMLElement, active: boolean) {
  node.toggleAttribute('inert', !active);
  return { update: (a: boolean) => node.toggleAttribute('inert', !a) };
}

/** Re-focus the opener after the DOM (and inert state) settle, if focus was lost. */
export function restoreFocus(_node: HTMLElement) {
  const prev = document.activeElement as HTMLElement | null;
  return {
    destroy() {
      tick().then(() => {
        const a = document.activeElement;
        if (prev && prev.isConnected && (!a || a === document.body)) prev.focus();
      });
    }
  };
}

/**
 * After a folder's own control unmounts (minimise / restore), focus its replacement in the
 * canvas: the restore control, else the collapsed tile, else the minimise control.
 */
export function focusFolderControl(folderId: string): void {
  const slot = Array.from(document.querySelectorAll('[data-node-id]')).find(
    (e) => e.getAttribute('data-node-id') === folderId && !e.closest('[role="dialog"]')
  );
  if (!slot) return;
  const target =
    slot.querySelector<HTMLElement>('button[aria-label="Restore folder"]') ??
    slot.querySelector<HTMLElement>('.folder-collapsed-tile') ??
    slot.querySelector<HTMLElement>('button[aria-label="Minimise folder"]');
  target?.focus();
}
