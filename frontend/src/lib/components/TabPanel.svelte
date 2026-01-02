<script lang="ts">
  import type { Tab } from '$lib/types';
  import Group from './Group.svelte';

  let { tab }: { tab: Tab } = $props();
</script>

<div class="tab-panel" style:background-image={tab.background?.type === 'image' ? `url(${tab.background.value})` : 'none'}>
  <div class="tab-content">
    {#each tab.groups as group (group.id)}
      <Group {group} />
    {/each}

    {#if tab.groups.length === 0}
      <div class="empty-state">
        <p>No groups in this tab yet</p>
      </div>
    {/if}
  </div>
</div>

<style>
  .tab-panel {
    min-height: 400px;
    background-size: cover;
    background-position: center;
  }

  .tab-content {
    padding: 2rem;
    background: rgba(15, 23, 42, 0.7);
    backdrop-filter: blur(10px);
    min-height: 400px;
  }

  .empty-state {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 300px;
    color: var(--text-secondary);
  }
</style>
