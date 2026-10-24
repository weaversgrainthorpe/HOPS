<script lang="ts">
  // Renders the editor's item menu and dialogs (mounted once by Dashboard in
  // edit mode). Every save here edits the session draft through
  // editorActions → editSession.apply; nothing is sent to the server.
  //
  // The tab dialog ({kind:'tab'}) is rendered by Dashboard, next to the tab
  // bar it edits; this component only closes it when its tab is gone.
  import EntryEditModal from '../admin/EntryEditModal.svelte';
  import FolderEditModal, { type FolderFields } from './FolderEditModal.svelte';
  import MoveCopyDialog from './MoveCopyDialog.svelte';
  import NodeContextMenu from './NodeContextMenu.svelte';
  import { editorDialog, editorMenu, openDialog } from '$lib/editor/editorUi';
  import {
    addNode, blankFolder, blankTile, contentSizeProblem, shapeProblem, deleteWithConfirm, duplicate, editFolder, editNode, findIn,
    newTileSizeProblem, sizeTarget, type TileSize
  } from '$lib/editor/editorActions';
  import { session } from '$lib/stores/editSession';
  import { toast } from '$lib/stores/toast';
  import type { Entry } from '$lib/types';
  import { contextForContainer, contextForNode } from '$lib/editor/statusChecks';
  import type { FolderNode, LayoutNode, TileNode } from '$lib/types/layout';

  interface Props {
    /** The active tab (for context only; targets come with each request). */
    tabId: string;
  }
  let { tabId }: Props = $props();

  const dlg = $derived($editorDialog);
  const draft = $derived($session?.draft ?? null);
  const existing = $derived(
    dlg && (dlg.kind === 'tile' || dlg.kind === 'folder') && dlg.id && draft ? findIn(draft, dlg.id) : undefined
  );
  // A dialog for an item that has gone (undo, or a reload) closes, saying so.
  $effect(() => {
    if (dlg && (dlg.kind === 'tile' || dlg.kind === 'folder') && dlg.id && draft && !existing) {
      toast.error('That item no longer exists, so its dialog was closed.');
      editorDialog.set(null);
    }
    // The tab dialog (rendered by Dashboard, which owns the tab bar): the same rule.
    if (dlg && dlg.kind === 'tab' && draft && !draft.tabs.some((t) => t.id === dlg.id)) {
      toast.error('That tab no longer exists, so its dialog was closed.');
      editorDialog.set(null);
    }
  });
  // Leaving edit mode (session ended) closes everything.
  $effect(() => {
    if (!$session) {
      editorDialog.set(null);
      editorMenu.set(null);
    }
  });

  const close = () => editorDialog.set(null);

  // The levels above the edited (or new) item, for the status-check row (M4 §4b).
  const statusContext = $derived.by(() => {
    if (!dlg || !draft || (dlg.kind !== 'tile' && dlg.kind !== 'folder')) return undefined;
    return dlg.id ? contextForNode(draft, dlg.id) : contextForContainer(draft, dlg.to ?? { tabId });
  });

  // A fresh blank per opened "new" dialog.
  const newTile = $derived(dlg && dlg.kind === 'tile' && !dlg.id ? blankTile() : null);
  const newFolder = $derived(dlg && dlg.kind === 'folder' && !dlg.id ? blankFolder() : null);

  // Size = the space a tile takes on a tab (spec §8): the trial run of a picked size against the
  // draft (a refusal is shown in the dialog).
  function checkSize(size: TileSize): string | null {
    if (!dlg || dlg.kind !== 'tile' || !draft) return 'Not editing: click Edit first.';
    if (!dlg.id) return newTileSizeProblem(draft, dlg.to ?? { tabId }, size);
    const t = sizeTarget(draft, dlg.id, size);
    return t.kind === 'invalid' ? t.reason : null;
  }

  function saveTile(edited: Entry, extra: { size?: TileSize } = {}) {
    if (!dlg || dlg.kind !== 'tile') return;
    if (dlg.id) {
      if (editNode(dlg.id, edited as Partial<LayoutNode>, extra)) close();
      return;
    }
    const node = { ...blankTile(), ...edited, kind: 'tile' } as TileNode;
    if (addNode(node, dlg.to ?? { tabId }, dlg.cell)) close();
  }

  function saveFolder(fields: FolderFields) {
    if (!dlg || dlg.kind !== 'folder') return;
    if (dlg.id) {
      if (editFolder(dlg.id, fields)) close();
      return;
    }
    // A new folder: a picked background is set on it (null = removed = no key).
    const { background, statusChecksEnabled, ...rest } = fields;
    const node = {
      ...blankFolder(), ...rest, ...(background ? { background } : {}),
      ...(typeof statusChecksEnabled === 'boolean' ? { statusChecksEnabled } : {})
    } as FolderNode;
    if (addNode(node, dlg.to ?? { tabId }, dlg.cell)) close();
  }

  async function remove(id: string) {
    if (await deleteWithConfirm([id])) close();
  }
</script>

{#if $editorMenu}
  {#key $editorMenu}
    <NodeContextMenu request={$editorMenu} onClose={() => editorMenu.set(null)} />
  {/key}
{/if}

{#if dlg?.kind === 'tile'}
  {#if dlg.id && existing && existing.kind === 'tile'}
    {@const id = dlg.id}
    {#key id}
      <EntryEditModal
        entry={existing}
        {checkSize}
        onSave={saveTile}
        onCancel={close}
        onDelete={() => remove(id)}
        onMoveCopy={() => openDialog({ kind: 'movecopy', ids: [id] })}
        {statusContext}
      />
    {/key}
  {:else if !dlg.id && newTile}
    <EntryEditModal entry={newTile} {checkSize} onSave={saveTile} onCancel={close} {statusContext} />
  {/if}
{:else if dlg?.kind === 'folder'}
  {#if dlg.id && existing && existing.kind === 'folder'}
    {@const id = dlg.id}
    {#key id}
      <FolderEditModal
        folder={existing}
        onSave={saveFolder}
        onCancel={close}
        onDelete={() => remove(id)}
        onDuplicate={() => {
          if (duplicate(id)) close();
        }}
        onMoveCopy={() => openDialog({ kind: 'movecopy', ids: [id] })}
        {statusContext}
        dashboardId={$session?.dashboardId}
        checkContentSize={(cs) => (draft ? contentSizeProblem(draft, id, cs) : 'Not editing: click Edit first.')}
        checkShape={(sh, pos) => (draft ? shapeProblem(draft, id, sh, pos) : 'Not editing: click Edit first.')}
      />
    {/key}
  {:else if !dlg.id && newFolder}
    <FolderEditModal folder={newFolder} isNew onSave={saveFolder} onCancel={close} {statusContext} dashboardId={$session?.dashboardId} />
  {/if}
{:else if dlg?.kind === 'movecopy'}
  <MoveCopyDialog ids={dlg.ids} onClose={close} />
{/if}
