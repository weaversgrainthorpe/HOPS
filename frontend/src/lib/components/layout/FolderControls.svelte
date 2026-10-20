<script lang="ts">
  import { tick } from 'svelte';
  import { focusFolderControl } from '$lib/utils/overlayActions';
  import Icon from '@iconify/svelte';
  import { clearFolderView, differsFromSaved, setFolderView } from '$lib/stores/folderView';
  import type { FolderNode } from '$lib/types/layout';
  import type { FolderViewState } from '$lib/stores/folderView';

  interface Props {
    dashboardId: string;
    folderId: string;
    remembered: FolderViewState | undefined;
    saved: FolderNode['display'] | undefined;
    /** 'bar' = expanded title bar (all controls); 'tile' = collapsed tile (restore only). */
    variant: 'bar' | 'tile';
  }
  let { dashboardId, folderId, remembered, saved, variant }: Props = $props();
  const showRestore = $derived(differsFromSaved(saved, remembered));
  const hasButtons = $derived(variant === 'bar' || showRestore);

  /** The clicked button is about to unmount: hand focus to whatever replaces it. */
  async function act(change: () => void) {
    change();
    await tick();
    focusFolderControl(folderId);
  }
</script>

{#if hasButtons}
<span class="folder-controls">
  {#if variant === 'bar'}
    <button type="button" aria-label="Minimise folder" title="Minimise folder" onclick={() => act(() => setFolderView(dashboardId, folderId, 'collapsed'))}>
      <Icon icon="mdi:window-minimize" width="18" />
    </button>
    <button type="button" aria-label="Maximise folder" title="Maximise folder" onclick={() => setFolderView(dashboardId, folderId, 'maximised')}>
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
  button {
    background: none;
    border: none;
    color: inherit;
    cursor: pointer;
    display: inline-flex;
    padding: 0.2rem;
    border-radius: 0.25rem;
    opacity: 0.8;
  }
  button:hover,
  button:focus-visible {
    opacity: 1;
    background: rgba(128, 128, 128, 0.25);
  }
</style>
