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

  interface Props {
    /** The active tab: adds and pastes without a target go to its root, or the open folder overlay. */
    tabId: string;
    onAddTab: () => void;
  }
  let { tabId, onAddTab }: Props = $props();

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

<div class="edit-toolbar" role="toolbar" aria-label="Editing">
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
  {#if $canvasStacked}
    <p class="narrow-hint" role="note">
      <Icon icon="mdi:information-outline" width="16" /><span>{NARROW_HINT}</span>
    </p>
  {/if}
</div>

<style>
  .edit-toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem 1rem;
    padding: 0.5rem 0.75rem;
    margin-bottom: 0.75rem;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 0.5rem;
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
    flex-basis: 100%;
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
  }
</style>
