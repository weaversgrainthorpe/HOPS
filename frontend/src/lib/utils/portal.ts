/**
 * Svelte action that moves the bound element to document.body on mount and
 * restores it on destroy. This escapes any ancestor stacking context created
 * by transform/filter/backdrop-filter, which would otherwise constrain
 * position:fixed descendants to the ancestor's box rather than the viewport.
 *
 * Use it on a modal-backdrop element so the modal always covers the full
 * viewport, regardless of where the modal component is declared in the tree.
 */
export function portal(node: HTMLElement) {
  document.body.appendChild(node);
  return {
    destroy() {
      if (node.parentNode) {
        node.parentNode.removeChild(node);
      }
    }
  };
}
