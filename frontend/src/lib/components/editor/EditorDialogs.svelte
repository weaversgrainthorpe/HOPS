<script lang="ts">
  // Renders the editor's item menu and dialogs (mounted once by Dashboard in
  // edit mode). Every save here edits the session draft through
  // editorActions → editSession.apply; nothing is sent to the server.
  import EntryEditModal from '../admin/EntryEditModal.svelte';
  import FolderEditModal, { type FolderFields } from './FolderEditModal.svelte';
  import MoveCopyDialog from './MoveCopyDialog.svelte';
  import NodeContextMenu from './NodeContextMenu.svelte';
  import { editorDialog, editorMenu, openDialog } from '$lib/editor/editorUi';
  import {
    addNode, blankFolder, blankTile, deleteWithConfirm, duplicate, editFolder, editNode, findIn
  } from '$lib/editor/editorActions';
  import { session } from '$lib/stores/editSession';
  import { toast } from '$lib/stores/toast';
  import type { Entry } from '$lib/types';
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
  });
  // Leaving edit mode (session ended) closes everything.
  $effect(() => {
    if (!$session) {
      editorDialog.set(null);
      editorMenu.set(null);
    }
  });

  const close = () => editorDialog.set(null);

  // A fresh blank per opened "new" dialog.
  const newTile = $derived(dlg && dlg.kind === 'tile' && !dlg.id ? blankTile() : null);
  const newFolder = $derived(dlg && dlg.kind === 'folder' && !dlg.id ? blankFolder() : null);

  function saveTile(edited: Entry) {
    if (!dlg || dlg.kind !== 'tile') return;
    if (dlg.id) {
      if (editNode(dlg.id, edited as Partial<LayoutNode>)) close();
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
    const node = { ...blankFolder(), ...fields } as FolderNode;
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
        onSave={saveTile}
        onCancel={close}
        onDelete={() => remove(id)}
        onMoveCopy={() => openDialog({ kind: 'movecopy', ids: [id] })}
      />
    {/key}
  {:else if !dlg.id && newTile}
    <EntryEditModal entry={newTile} onSave={saveTile} onCancel={close} />
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
      />
    {/key}
  {:else if !dlg.id && newFolder}
    <FolderEditModal folder={newFolder} isNew onSave={saveFolder} onCancel={close} />
  {/if}
{:else if dlg?.kind === 'movecopy'}
  <MoveCopyDialog ids={dlg.ids} onClose={close} />
{/if}
