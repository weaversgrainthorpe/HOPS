<script lang="ts">
  import { tick } from 'svelte';
  import { focusFolderControl } from '$lib/utils/overlayActions';
  import Icon from '@iconify/svelte';
  import { clearFolderView, differsFromSaved, setFolderView } from '$lib/stores/folderView';
  import type { FolderNode } from '$lib/types/layout';
  import type { FolderViewState } from '$lib/stores/folderView';
  import { setDisplay } from '$lib/editor/editorActions';
  import { toast } from '$lib/stores/toast';

  interface Props {
    dashboardId: string;
    folderId: string;
    remembered: FolderViewState | undefined;
    saved: FolderNode['display'] | undefined;
    /** 'bar' = expanded title bar (all controls); 'tile' = collapsed tile (restore only). */
    variant: 'bar' | 'tile';
    /**
     * Edit mode (§7.2: the controls stay visible, so the layout matches view mode). Minimise then sets
     * the draft's SAVED default (undoable, saved with Save — M3 §4); Maximise is only ever a viewer's
     * view, so it says so rather than doing nothing. No Restore: edit mode shows the saved layout.
     */
    editing?: boolean;
  }
  let { dashboardId, folderId, remembered, saved, variant, editing = false }: Props = $props();
  const showRestore = $derived(!editing && differsFromSaved(saved, remembered));
  const hasButtons = $derived(variant === 'bar' || showRestore);

  /** The clicked button is about to unmount: hand focus to whatever replaces it. */
  async function act(change: () => void) {
    change();
    await tick();
    focusFolderControl(folderId);
  }

  /** In edit mode a control's click (and double-click) is its own: it never also selects or edits the folder. */
  function own(e: Event) {
    if (editing) e.stopPropagation();
  }

  function minimise(e: Event) {
    own(e);
    if (editing) void act(() => setDisplay(folderId, 'collapsed'));
    else void act(() => setFolderView(dashboardId, folderId, 'collapsed'));
  }

  function maximise(e: Event) {
    own(e);
    if (editing) {
      toast.info(
        "Maximise is how a viewer looks at a folder, so it isn't saved. Leave edit mode to maximise it; Minimise here sets how it starts."
      );
      return;
    }
    setFolderView(dashboardId, folderId, 'maximised');
  }
</script>

{#if hasButtons}
<!-- svelte-ignore a11y_no_static_element_interactions -->
<span class="folder-controls" ondblclick={own}>
  {#if variant === 'bar'}
    <button type="button" aria-label="Minimise folder" title={editing ? 'Minimise folder (sets how it starts)' : 'Minimise folder'} onclick={minimise}>
      <Icon icon="mdi:window-minimize" width="18" />
    </button>
    <button type="button" aria-label="Maximise folder" title="Maximise folder" onclick={maximise}>
      <Icon icon="mdi:window-maximize" width="18" />
    </button>
  {/if}
  {#if showRestore}
    <button type="button" aria-label="Restore folder" title="Restore folder" onclick={() => act(() => clearFolderView(dashboardId, folderId))}>
      <Icon icon="mdi:restore" width="18" />
    </button>
  {/if}
</span>
{/if}

<style>
  .folder-controls {
    display: inline-flex;
    gap: 0.25rem;
    flex: none;
  }
  /* A fixed size (1.5rem square, 0.25rem apart): the edit handle beside them is placed by it (FolderView). */
  button {
    background: none;
    border: none;
    color: inherit;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    width: 1.5rem;
    height: 1.5rem;
    padding: 0;
    border-radius: 0.25rem;
    opacity: 0.8;
  }
  button:hover,
  button:focus-visible {
    opacity: 1;
    background: rgba(128, 128, 128, 0.25);
  }
</style>
