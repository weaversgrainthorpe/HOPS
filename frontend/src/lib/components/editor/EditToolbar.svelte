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
  import BackgroundFailedBadge from '../background/BackgroundFailedBadge.svelte';
  import type { Background } from '$lib/types';

  interface Props {
    /** The active tab: adds and pastes without a target go to its root, or the open folder overlay. */
    tabId: string;
    onAddTab: () => void;
    /** The labelled "Dashboard" pencil (§4C) opens the one dashboard dialog. */
    onEditDashboard?: () => void;
    /** The dashboard's and the active tab's own backgrounds: a failed image shows a compact warning here (Ruling 7). */
    dashboardBackground?: Background;
    tabBackground?: Background;
  }
  let { tabId, onAddTab, onEditDashboard, dashboardBackground, tabBackground }: Props = $props();

  let saving = $state(false);
  const canUndo = $derived(($session?.undo.length ?? 0) > 0);
  const canRedo = $derived(($session?.redo.length ?? 0) > 0);

  async function doSave() {
    if (saving) return;
    saving = true;
    try {
      await save();
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
   * A modal dialog (other than a folder overlay) is open, or an item menu has focus: either owns
   * the keyboard, so Delete / Ctrl+Z / Ctrl+C… pressed there never reach the editor's shortcuts.
   */
  function modalOpen(): boolean {
    if (document.querySelector('[role="dialog"][aria-modal="true"]:not(.overlay-panel)')) return true;
    const active = document.activeElement;
    return active instanceof Element && !!active.closest('[role="menu"]');
  }

  function onKey(e: KeyboardEvent) {
    if (!$session || e.defaultPrevented || isTyping(e.target) || modalOpen()) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    // Shift+Arrow: resize the selected item by one cell (grid) or one 8 px unit (free).
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
      // Ctrl+] / Ctrl+[: bring forward / send back (free layouts).
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
      // Not marked handled: Escape also closes an open folder overlay as before.
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

<!-- §7.2: one floating toolbar pinned to the bottom of the screen. It sits over the page and takes no
     layout space, so every tile, folder and tab stays where view mode puts it. Below every dialog
     (folder overlays included): it never covers one. -->
<div class="edit-toolbar" role="toolbar" aria-label="Editing">
  <div class="controls">
    <div class="group">
      <button type="button" class="tb primary" onclick={doSave} disabled={!$dirty || saving} title="Save (Ctrl+S)">
        <Icon icon="mdi:content-save" width="18" /> Save
      </button>
      <button type="button" class="tb" onclick={() => discard()} disabled={!$dirty || saving} title="Discard all unsaved changes">
        <Icon icon="mdi:close-circle-outline" width="18" /> Discard
      </button>
      <button type="button" class="tb" onclick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)">
        <Icon icon="mdi:undo" width="18" /> Undo
      </button>
      <button type="button" class="tb" onclick={redo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z or Ctrl+Y)">
        <Icon icon="mdi:redo" width="18" /> Redo
      </button>
      {#if $dirty}
        <span class="unsaved" role="status">
          <Icon icon="mdi:circle-medium" width="18" />Unsaved changes
        </span>
      {/if}
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
        <!-- The dashboard's own edit handle (§4C): one labelled pencil, always shown while editing. -->
        <EditHandle name="Dashboard" label="Dashboard" placement="inline" onEdit={onEditDashboard} />
      </div>
    {/if}
  </div>
  <!-- A failed background image per level (Ruling 7): compact, inside the toolbar, never moving the page. -->
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
    /* Above the page and the navbar, below every dialog and folder overlay, menus and toasts. */
    z-index: calc(var(--z-folder-overlay) - 10);
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
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }
  .narrow-hint {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    margin: 0;
    color: var(--text-secondary);
    font-size: 0.8125rem;
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
