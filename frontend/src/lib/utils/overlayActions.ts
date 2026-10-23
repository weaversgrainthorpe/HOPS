/** Move the node to <body> so no transformed/filtered ancestor can trap position:fixed. */
export function portal(node: HTMLElement) {
  document.body.appendChild(node);
  return { destroy: () => node.remove() };
}

/**
 * After a folder's own control unmounts (open / minimise / restore), focus its replacement in the
 * canvas: the restore control, else the collapsed tile, else the minimise control.
 */
export function focusFolderControl(folderId: string): void {
  const slot = Array.from(document.querySelectorAll('[data-node-id]')).find(
    (e) => e.getAttribute('data-node-id') === folderId && !e.closest('[role="dialog"]')
  );
  if (!slot) return;
  // By the controls' data- hooks (their labels name the folder): this folder's own, never a sub-folder's.
  const own = (attr: string) =>
    Array.from(slot.querySelectorAll<HTMLElement>(`[${attr}]`)).find((e) => e.getAttribute(attr) === folderId);
  const target =
    own('data-folder-restore') ??
    slot.querySelector<HTMLElement>('.folder-collapsed-tile') ??
    own('data-folder-minimise');
  target?.focus();
}
