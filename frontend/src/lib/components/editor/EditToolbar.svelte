<script lang="ts">
  import Icon from '@iconify/svelte';
  import { session, dirty, save, discard, undo, redo } from '$lib/stores/editSession';
  import { selectedNodes, clearSelection, selectionInDraft } from '$lib/stores/nodeSelection';
  import { copySelection, cutSelection, pasteInto } from '$lib/stores/nodeClipboard';
  import { openDialog, currentContainer, canvasStacked } from '$lib/editor/editorUi';
  import { deleteWithConfirm, zOrderSelection } from '$lib/editor/editorActions';
  import { NARROW_HINT, resizeBy } from '$lib/editor/resize';
  import { toast } from '$lib/stores/toast';
  import { get } from 'svelte/store';
  import { drag } from '$lib/editor/drag/dragController';
  import EditHandle from './EditHandle.svelte';
  import { playSavedTick } from '$lib/editor/drag/flourishes';
  import BackgroundFailedBadge from '../background/BackgroundFailedBadge.svelte';
  import type { Background } from '$lib/types';

  interface Props {
    /** The active tab: adds and pastes without a target go to its root (a folder's menu adds into it). */
    tabId: string;
    onAddTab: () => void;
    /** The labelled "Dashboard" pencil opens the one dashboard dialog. */
    onEditDashboard?: () => void;
    /** The dashboard's and the active tab's own backgrounds: a failed image shows a compact warning here. */
    dashboardBackground?: Background;
    tabBackground?: Background;
    /**
     * Told how far up from the bottom of the screen the toolbar reaches (px), whenever that changes
     * (it wraps, a warning or the hint appears, the window resizes): the page keeps that much room.
     */
    onReach?: (px: number) => void;
  }
  let { tabId, onAddTab, onEditDashboard, dashboardBackground, tabBackground, onReach }: Props = $props();

  let barEl = $state<HTMLElement | null>(null);
  $effect(() => {
    const el = barEl;
    const report = onReach;
    if (!el || !report) return;
    const measure = () => report(Math.max(0, window.innerHeight - el.getBoundingClientRect().top));
    measure();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measure);
    };
  });

  let saving = $state(false);
  const canUndo = $derived(($session?.undo.length ?? 0) > 0);
  const canRedo = $derived(($session?.redo.length ?? 0) > 0);

  let tickEl = $state<HTMLElement | null>(null);
  async function doSave() {
    if (saving) return;
    saving = true;
    const dashboardId = $session?.dashboardId;
    const wasDirty = get(dirty);
    try {
      // The tick shows only after a save that really wrote something; a failure keeps its error.
      if ((await save()) === 'saved' && wasDirty) playSavedTick(dashboardId, tickEl);
    } finally {
      saving = false;
    }
  }

  const ARROWS: Record<string, [number, number]> = {
    ArrowRight: [1, 0],
    ArrowLeft: [-1, 0],
    ArrowDown: [0, 1],
    ArrowUp: [0, -1]
  };

  function isTyping(t: EventTarget | null): boolean {
    if (!(t instanceof HTMLElement)) return false;
    if (t.isContentEditable) return true;
    return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT';
  }

  /**
   * A modal dialog is open, or an item menu has focus: either owns
   * the keyboard, so Delete / Ctrl+Z / Ctrl+C… pressed there never reach the editor's shortcuts.
   */
  function modalOpen(): boolean {
    if (document.querySelector('[role="dialog"][aria-modal="true"]')) return true;
    const active = document.activeElement;
    return active instanceof Element && !!active.closest('[role="menu"]');
  }

  function onKey(e: KeyboardEvent) {
    if (!$session || e.defaultPrevented || isTyping(e.target) || modalOpen()) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    // Shift+Arrow: resize the selected item by one cell.
    const grow = ARROWS[e.key];
    if (grow && e.shiftKey && !mod && !e.altKey) {
      if (get(drag)) return; // a pointer drag or resize owns the item until it ends
      const ids = selectionInDraft();
      if (ids.length === 0) return; // nothing selected: leave Shift+Arrow to the page
      e.preventDefault();
      if (ids.length > 1) toast.info('Select one item to resize it with Shift+Arrow keys.');
      else resizeBy(ids[0], grow[0], grow[1]);
      return;
    }
    if (mod && !e.altKey) {
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
      if ((k === 'z' && e.shiftKey) || (k === 'y' && !e.shiftKey)) { e.preventDefault(); redo(); return; }
      if (k === 's' && !e.shiftKey) { e.preventDefault(); void doSave(); return; }
      if (e.shiftKey) return;
      // Ctrl+] / Ctrl+[: bring forward / send back (items never overlap, so it says so).
      // By the character typed (e.key), never e.code: on other layouts that key is e.g. "+" (zoom).
      const z = k === ']' ? 'forward' : k === '[' ? 'back' : null;
      if (z) {
        const ids = selectionInDraft();
        if (ids.length === 0) return;
        e.preventDefault();
        zOrderSelection(ids, z);
        return;
      }
      // Copy/cut only when no text is selected on the page (then the browser copies the text).
      const textSelected = (window.getSelection()?.toString().length ?? 0) > 0;
      if (k === 'c' && !textSelected && $selectedNodes.size > 0) { e.preventDefault(); copySelection(); return; }
      if (k === 'x' && !textSelected && $selectedNodes.size > 0) { e.preventDefault(); cutSelection(); return; }
      if (k === 'v') { e.preventDefault(); void pasteInto(currentContainer(tabId)); return; }
      return;
    }
    if (e.key === 'Escape') {
      // Not marked handled: another Escape handler (a menu, a dialog) may also want it.
      clearSelection();
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && !e.shiftKey && !e.altKey) {
      const ids = selectionInDraft();
      if (ids.length === 0) return;
      e.preventDefault();
      void deleteWithConfirm(ids);
    }
  }
</script>

<svelte:window onkeydown={onKey} />

<!-- One floating toolbar pinned to the bottom of the screen. It sits over the page and takes no
     layout space, so every tile, folder and tab stays where view mode puts it. Below every dialog:
     it never covers one. -->
<div class="edit-toolbar" role="toolbar" aria-label="Editing" bind:this={barEl}>
  <div class="controls">
    <div class="group">
      <span class="save-slot">
        <button type="button" class="tb primary" onclick={doSave} disabled={!$dirty || saving} title="Save (Ctrl+S)">
          <Icon icon="mdi:content-save" width="18" /> Save
        </button>
        <!-- Drawn only while its flourish plays (invisible otherwise); the toast says "Changes saved" either way. -->
        <span class="saved-tick" data-saved-tick aria-hidden="true" bind:this={tickEl}><Icon icon="mdi:check-circle" width="20" /></span>
      </span>
      <button type="button" class="tb" onclick={() => discard()} disabled={!$dirty || saving} title="Discard all unsaved changes">
        <Icon icon="mdi:close-circle-outline" width="18" /> Discard
      </button>
      <button type="button" class="tb" onclick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)">
        <Icon icon="mdi:undo" width="18" /> Undo
      </button>
      <button type="button" class="tb" onclick={redo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z or Ctrl+Y)">
        <Icon icon="mdi:redo" width="18" /> Redo
      </button>
      <!-- Its space is always reserved (an invisible copy, drawn by CSS), so no button moves when it appears. -->
      <span class="unsaved-slot">
        {#if $dirty}
          <span class="unsaved" role="status">
            <Icon icon="mdi:circle-medium" width="18" />Unsaved changes
          </span>
        {/if}
      </span>
    </div>
    <div class="group">
      <button type="button" class="tb" onclick={() => openDialog({ kind: 'tile', to: currentContainer(tabId) })}>
        <Icon icon="mdi:plus-box-outline" width="18" /> Add tile
      </button>
      <button type="button" class="tb" onclick={() => openDialog({ kind: 'folder', to: currentContainer(tabId) })}>
        <Icon icon="mdi:folder-plus-outline" width="18" /> Add folder
      </button>
      <button type="button" class="tb" onclick={onAddTab}>
        <Icon icon="mdi:tab-plus" width="18" /> Add tab
      </button>
    </div>
    {#if onEditDashboard}
      <div class="group">
        <!-- The dashboard's own edit handle: one labelled pencil, always shown while editing. -->
        <EditHandle name="Dashboard" label="Dashboard" placement="inline" onEdit={onEditDashboard} />
      </div>
    {/if}
  </div>
  <!-- A failed background image per level: compact, inside the toolbar, never moving the page. -->
  <div class="notes">
    <BackgroundFailedBadge background={dashboardBackground} editing level="dashboard" placement="inline" label="(dashboard)" />
    <BackgroundFailedBadge background={tabBackground} editing level="tab" placement="inline" label="(this tab)" />
    {#if $canvasStacked}
      <p class="narrow-hint" role="note">
        <Icon icon="mdi:information-outline" width="16" /><span>{NARROW_HINT}</span>
      </p>
    {/if}
  </div>
</div>

<style>
  .edit-toolbar {
    /* Floating: fixed to the bottom of the screen, over the page (it reserves no layout space; the
       canvas panel's bottom padding, the same in both modes, lets the last row scroll clear of it). */
    position: fixed;
    left: 50%;
    bottom: 0.75rem;
    transform: translateX(-50%);
    /* Above the page and the navbar, below every dialog, menus and toasts. */
    z-index: var(--z-edit-toolbar);
    box-sizing: border-box;
    width: max-content;
    max-width: calc(100vw - 1rem);
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 0.35rem;
    padding: 0.5rem 0.75rem;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 0.75rem;
    box-shadow: 0 6px 24px var(--shadow, rgba(0, 0, 0, 0.4));
  }
  .controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: 0.5rem 1rem;
    min-width: 0;
  }
  .notes {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: 0.35rem 0.5rem;
    min-width: 0;
  }
  /* Nothing to say: no empty strip. */
  .notes:not(:has(> *)) {
    display: none;
  }
  .group {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem;
  }
  .tb {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.4rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: 0.375rem;
    background: var(--bg-primary);
    color: var(--text-primary);
    font-size: 0.875rem;
    white-space: nowrap;
    cursor: pointer;
  }
  .save-slot {
    position: relative;
    display: inline-flex;
  }
  .saved-tick {
    position: absolute;
    top: -0.55rem;
    right: -0.55rem;
    display: inline-flex;
    color: #fff;
    background: var(--success-solid, #15803d);
    border-radius: 50%;
    padding: 1px;
    opacity: 0;
    pointer-events: none;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35);
  }
  .tb:hover:not(:disabled) {
    border-color: var(--accent);
  }
  .tb:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .tb:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .tb.primary:not(:disabled) {
    background: var(--accent-solid);
    border-color: var(--accent-solid);
    color: var(--on-accent);
  }
  .narrow-hint {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    margin: 0;
    color: var(--text-secondary);
    font-size: 0.8125rem;
  }
  .unsaved-slot {
    display: inline-grid;
    align-items: center;
  }
  .unsaved-slot::before {
    /* The reserved width: the icon (18px) and the same text, invisible. */
    content: 'Unsaved changes';
    grid-area: 1 / 1;
    visibility: hidden;
    padding-left: 18px;
    font-size: 0.875rem;
    font-weight: 600;
    white-space: nowrap;
  }
  .unsaved-slot > .unsaved {
    grid-area: 1 / 1;
  }
  /* While an item is dragged or resized, the toolbar lets the pointer through: a cell under it
     still takes the drop (the drag engine hit-tests with elementFromPoint). */
  :global(body.hops-dragging) .edit-toolbar,
  :global(body.hops-resizing) .edit-toolbar {
    pointer-events: none;
    opacity: 0.4;
  }
  .unsaved {
    display: inline-flex;
    align-items: center;
    color: var(--color-warning, #d97706);
    font-size: 0.875rem;
    font-weight: 600;
    white-space: nowrap;
  }
  /* Phones: the buttons stay on one row that scrolls sideways (the toolbar's height stays small and
     the page is never wider than the screen); the warnings and the hint wrap below it. */
  @media (max-width: 768px) {
    .edit-toolbar {
      left: 0.5rem;
      right: 0.5rem;
      bottom: 0.5rem;
      transform: none;
      width: auto;
      max-width: none;
      padding: 0.4rem 0.5rem;
    }
    .controls {
      flex-wrap: nowrap;
      justify-content: flex-start;
      overflow-x: auto;
      scrollbar-width: thin;
      gap: 0.5rem;
      padding-bottom: 2px;
    }
    .group {
      flex-wrap: nowrap;
      flex: none;
    }
    .tb {
      padding: 0.4rem 0.6rem;
    }
  }
</style>
