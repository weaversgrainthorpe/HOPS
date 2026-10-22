<script lang="ts">
  import { onMount, tick } from 'svelte';
  import Icon from '@iconify/svelte';
  import type { MenuRequest } from '$lib/editor/editorUi';
  import { openDialog, showTabRequest } from '$lib/editor/editorUi';
  import { locate } from '$lib/editor/treeOps';
  import {
    containerOfNode, deleteTabWithConfirm, deleteWithConfirm, duplicate, duplicateTabAction, findIn, setDisplay
  } from '$lib/editor/editorActions';
  import { session } from '$lib/stores/editSession';
  import { selectedNodes, toggleNode } from '$lib/stores/nodeSelection';
  import { nodeClipboard, copySelection, cutSelection, pasteInto } from '$lib/stores/nodeClipboard';
  import { drillTo } from '$lib/stores/folderView';
  import { portal } from '$lib/utils/portal';
  import { toast } from '$lib/stores/toast';

  interface Props {
    request: MenuRequest;
    onClose: () => void;
  }
  let { request: requestProp, onClose }: Props = $props();
  // The parent keys the menu on its request and nulls it when the menu closes, which
  // happens BEFORE the chosen action runs. Capture the request once (it never changes
  // for this instance) so nothing below reads a null request after closing.
  // svelte-ignore state_referenced_locally
  const request: MenuRequest = requestProp;

  interface Item {
    label: string;
    icon: string;
    run: () => unknown;
    disabled?: boolean;
    danger?: boolean;
    separatorBefore?: boolean;
  }

  // Right-clicking an item outside the selection selects just it (as Explorer does).
  const initial = request.target;
  if (initial.kind === 'node' && !$selectedNodes.has(initial.id)) {
    if ($session && locate($session.draft, initial.id)) toggleNode(initial.id, false);
  }

  const draft = $derived($session?.draft ?? null);
  const node = $derived(draft && request.target.kind === 'node' ? findIn(draft, request.target.id) : undefined);
  /** The items an action applies to: the selection when the item is part of it, else the item. */
  const targetIds = $derived.by(() => {
    if (request.target.kind !== 'node') return [];
    const id = request.target.id;
    return $selectedNodes.has(id) && $selectedNodes.size > 1 ? [...$selectedNodes] : [id];
  });
  const many = $derived(targetIds.length > 1);
  const tab = $derived(
    draft && request.target.kind === 'tab' ? draft.tabs.find((t) => t.id === (request.target as { id: string }).id) : undefined
  );
  const canPaste = $derived(!!$nodeClipboard && $nodeClipboard.nodes.length > 0);

  const items = $derived.by((): Item[] => {
    const t = request.target;
    if (t.kind === 'container') {
      return [
        { label: 'Add tile here', icon: 'mdi:plus-box', run: () => openDialog({ kind: 'tile', to: t.ref, ...(t.cell ? { cell: t.cell } : {}) }) },
        { label: 'Add folder here', icon: 'mdi:folder-plus', run: () => openDialog({ kind: 'folder', to: t.ref, ...(t.cell ? { cell: t.cell } : {}) }) },
        { label: 'Paste here', icon: 'mdi:content-paste', disabled: !canPaste, run: () => pasteInto(t.ref, t.cell) }
      ];
    }
    if (t.kind === 'tab') {
      if (!tab) return [];
      const id = tab.id;
      return [
        { label: 'Edit', icon: 'mdi:pencil', run: () => openDialog({ kind: 'tab', id }) },
        {
          label: 'Duplicate',
          icon: 'mdi:content-duplicate',
          run: () => {
            const copy = duplicateTabAction(id);
            if (copy) showTabRequest.set(copy); // show the copy, as the old duplicate button did
          }
        },
        { label: 'Delete', icon: 'mdi:trash-can', danger: true, separatorBefore: true, run: () => deleteTabWithConfirm(id) }
      ];
    }
    if (!node || !draft) return [];
    // Capture everything the actions need now: they run after the menu has closed.
    const id = node.id;
    const kind = node.kind;
    const d = draft;
    const ids = [...targetIds];
    const out: Item[] = [];
    if (!many) out.push({ label: 'Edit', icon: 'mdi:pencil', run: () => openDialog({ kind, id }) });
    // Folders open in place (M5 §3a.8): a sub-folder drills in (this browser's memory); a folder on
    // the tab opens into the space it kept — in edit mode, as its saved default (undoable).
    const chain = locate(d, id)?.folderChain ?? [];
    const nested = chain.length > 0;
    if (!many && node.kind === 'folder' && (nested || node.display === 'collapsed')) {
      out.push({
        label: 'Open',
        icon: 'mdi:folder-open',
        run: () => (nested ? drillTo(d.id, [...chain, id]) : setDisplay(id, 'expanded'))
      });
    }
    if (!many) out.push({ label: 'Duplicate', icon: 'mdi:content-duplicate', run: () => duplicate(id) });
    out.push(
      { label: 'Cut', icon: 'mdi:content-cut', run: () => cutSelection(), separatorBefore: true },
      { label: 'Copy', icon: 'mdi:content-copy', run: () => copySelection() },
      {
        label: 'Paste here',
        icon: 'mdi:content-paste',
        disabled: !canPaste,
        // Onto a folder: into it. Onto a tile: beside it, in the same container (in a folder:
        // right after it in the order).
        run: () => {
          const to = kind === 'folder' ? { tabId: locate(d, id)!.tabId, folderId: id } : containerOfNode(d, id);
          return to ? pasteInto(to, undefined, kind === 'folder' ? undefined : id) : undefined;
        }
      },
      { label: 'Move/Copy to…', icon: 'mdi:folder-move', run: () => openDialog({ kind: 'movecopy', ids }) }
    );
    if (!many && node.kind === 'folder' && !nested && node.display !== 'collapsed') {
      out.push({ label: 'Minimise', icon: 'mdi:window-minimize', run: () => setDisplay(id, 'collapsed'), separatorBefore: true });
    }
    out.push({
      label: many ? `Delete ${targetIds.length} items` : 'Delete',
      icon: 'mdi:trash-can',
      danger: true,
      separatorBefore: true,
      run: () => deleteWithConfirm(ids)
    });
    return out;
  });

  const label = $derived(
    request.target.kind === 'container'
      ? 'Container actions'
      : request.target.kind === 'tab'
        ? `Tab actions: ${tab?.name || 'Untitled'}`
        : node
        ? `${node.kind === 'folder' ? 'Folder' : 'Tile'} actions: ${node.name || 'Untitled'}`
        : 'Item actions'
  );

  let menuEl = $state<HTMLElement | null>(null);
  let left = $state(0);
  let top = $state(0);
  let opener: HTMLElement | null = null;

  function enabledItems(): HTMLButtonElement[] {
    return menuEl ? Array.from(menuEl.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])')) : [];
  }

  onMount(() => {
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Keep the menu on screen (measured once, on open).
    left = request.x;
    top = request.y;
    void tick().then(() => {
      if (!menuEl) return;
      const r = menuEl.getBoundingClientRect();
      const vw = window.innerWidth || 0;
      const vh = window.innerHeight || 0;
      if (vw && r.width && left + r.width > vw - 8) left = Math.max(8, vw - r.width - 8);
      if (vh && r.height && top + r.height > vh - 8) top = Math.max(8, vh - r.height - 8);
      enabledItems()[0]?.focus();
    });
  });

  function close(restore = true) {
    onClose();
    if (restore && opener && document.contains(opener)) opener.focus();
  }

  async function choose(it: Item) {
    if (it.disabled) return;
    close(false);
    try {
      await it.run();
    } catch (err) {
      // Never fail silently: the menu is already gone, so say so out loud.
      console.error('Menu action failed', err);
      toast.error(`${it.label.replace(/…$/, '')} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  function onKey(e: KeyboardEvent) {
    const list = enabledItems();
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    const focusAt = (n: number) => list[(n + list.length) % list.length]?.focus();
    switch (e.key) {
      case 'ArrowDown': focusAt(i + 1); break;
      case 'ArrowUp': focusAt(i < 0 ? list.length - 1 : i - 1); break;
      case 'Home': focusAt(0); break;
      case 'End': focusAt(list.length - 1); break;
      case 'Escape': close(); break;
      case 'Tab': close(); return; // let focus move on
      default: return;
    }
    // Handled here: an open folder overlay or modal must not also act on it.
    e.preventDefault();
    e.stopPropagation();
  }

  function onWindowPointer(e: PointerEvent) {
    if (menuEl && e.target instanceof Node && !menuEl.contains(e.target)) close(false);
  }

  const px = (v: number) => `${Math.round(v)}px`;
</script>

<svelte:window onpointerdowncapture={onWindowPointer} onresize={() => close(false)} />

<div
  class="node-menu"
  role="menu"
  tabindex="-1"
  aria-label={label}
  bind:this={menuEl}
  use:portal
  style:left={px(left)}
  style:top={px(top)}
  onkeydown={onKey}
  oncontextmenu={(e) => e.preventDefault()}
>
  {#if items.length === 0}
    <p class="gone" role="none">This item no longer exists.</p>
  {/if}
  {#each items as it (it.label)}
    {#if it.separatorBefore}<div class="sep" role="separator"></div>{/if}
    <button
      type="button"
      role="menuitem"
      class="item"
      class:danger={it.danger}
      disabled={it.disabled}
      tabindex="-1"
      onclick={() => choose(it)}
    >
      <Icon icon={it.icon} width="18" />
      {it.label}
    </button>
  {/each}
</div>

<style>
  .node-menu {
    position: fixed;
    /* Above open folder overlays (--z-folder-overlay + depth), below modals. */
    z-index: calc(var(--z-modal) - 10);
    min-width: 12rem;
    padding: 0.25rem;
    background: var(--bg-primary);
    color: var(--text-primary);
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    box-shadow: 0 8px 24px var(--shadow, rgba(0, 0, 0, 0.35));
  }
  .item {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    width: 100%;
    padding: 0.5rem 0.75rem;
    border: none;
    border-radius: 0.375rem;
    background: transparent;
    color: inherit;
    font-size: 0.9rem;
    text-align: left;
    cursor: pointer;
  }
  .item:hover:not(:disabled),
  .item:focus-visible {
    background: var(--bg-tertiary);
    outline: none;
  }
  .item:focus-visible {
    box-shadow: inset 0 0 0 2px var(--accent);
  }
  .item:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .item.danger {
    color: var(--color-error, #dc2626);
  }
  .sep {
    height: 1px;
    margin: 0.25rem 0.5rem;
    background: var(--border);
  }
  .gone {
    margin: 0.5rem 0.75rem;
    color: var(--color-error, #dc2626);
    font-size: 0.875rem;
  }
</style>
