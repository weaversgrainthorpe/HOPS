<script lang="ts">
  /**
   * The one edit handle (walkthrough §4B): a small pencil button on every editable item — tile,
   * folder (expanded or collapsed), tab and the dashboard. It is a real button ("Edit <name>"),
   * reachable by keyboard; hosts show it on hover or keyboard focus and it is always shown on
   * touch (hover: none). Its pointerdown is left alone so a press on it still drags the item;
   * only its click (and double-click) stop here, so editing never also selects or switches.
   */
  import Icon from '@iconify/svelte';

  interface Props {
    /** The item's name, for the accessible label "Edit <name>". */
    name: string;
    onEdit: () => void;
    /** Optional visible text beside the pencil (Task 6's "Dashboard" handle). */
    label?: string;
    /** corner: pinned to the host's top-right (the host is positioned); inline: in the flow. */
    placement?: 'corner' | 'inline';
  }
  let { name, onEdit, label, placement = 'corner' }: Props = $props();
  const aria = $derived(`Edit ${name?.trim() ? name : 'Untitled'}`);

  /**
   * Real (non-delegated) listeners, so stopPropagation keeps the click and double-click from
   * reaching the item whoever listens there (Svelte's delegated handlers or native ones).
   * pointerdown is deliberately NOT stopped (a press on the handle still drags its item), nor is
   * a right-click (it opens the item's menu).
   */
  function ownEvents(el: HTMLElement) {
    const click = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      onEdit();
    };
    const stop = (e: Event) => e.stopPropagation();
    el.addEventListener('click', click);
    el.addEventListener('dblclick', stop);
    return {
      destroy() {
        el.removeEventListener('click', click);
        el.removeEventListener('dblclick', stop);
      }
    };
  }
</script>

<button
  type="button"
  class="edit-handle {placement}"
  class:labelled={!!label}
  data-edit-handle
  aria-label={aria}
  title={aria}
  use:ownEvents
>
  <Icon icon="mdi:pencil" width="16" />
  {#if label}<span class="text">{label}</span>{/if}
</button>

<style>
  .edit-handle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
    min-width: 1.75rem;
    height: 1.75rem;
    padding: 0 0.35rem;
    border: 1px solid var(--border);
    border-radius: 0.375rem;
    background: var(--bg-primary);
    color: var(--text-primary);
    box-shadow: 0 2px 6px var(--shadow, rgba(0, 0, 0, 0.35));
    cursor: pointer;
    /* Hidden until the host is hovered or holds focus (below); never removed, so Tab reaches it. */
    opacity: 0;
    /* Hidden, it never takes a click meant for the item (a tile's corner, a short tab). */
    pointer-events: none;
    transition: opacity 0.15s;
    font-size: 0.85rem;
    line-height: 1;
  }
  .edit-handle.corner {
    position: absolute;
    top: 0.25rem;
    right: 0.25rem;
    z-index: 4;
  }
  .edit-handle.labelled {
    padding: 0 0.6rem;
  }
  .edit-handle:hover {
    background: var(--accent);
    color: #fff;
    border-color: var(--accent);
  }
  .edit-handle:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  /* Shown on the host's hover or keyboard focus (the host is the handle's parent). */
  :global(*:hover) > .edit-handle,
  :global(*:focus-within) > .edit-handle,
  .edit-handle:focus,
  .edit-handle.labelled {
    opacity: 1;
    pointer-events: auto;
  }
  /* Touch: always visible. */
  @media (hover: none) {
    .edit-handle {
      opacity: 1;
      pointer-events: auto;
    }
  }
  /* Out of the way while something is being dragged or resized. */
  :global(body.hops-dragging) .edit-handle,
  :global(body.hops-resizing) .edit-handle {
    /* beats the hover / focus-within reveal while the pointer is over an item mid-drag */
    opacity: 0 !important;
    pointer-events: none !important;
  }
</style>
