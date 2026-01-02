<script lang="ts">
  import type { Group } from '$lib/types';
  import Entry from './Entry.svelte';
  import Icon from '@iconify/svelte';

  let { group }: { group: Group } = $props();
  let collapsed = $state(group.collapsed || false);

  function toggleCollapse() {
    collapsed = !collapsed;
  }
</script>

<div class="group">
  <button class="group-header" onclick={toggleCollapse}>
    <h3>{group.name}</h3>
    <Icon icon={collapsed ? 'mdi:chevron-down' : 'mdi:chevron-up'} width="24" />
  </button>

  {#if !collapsed}
    <div class="entries-grid">
      {#each group.entries as entry (entry.id)}
        <Entry {entry} />
      {/each}
    </div>
  {/if}
</div>

<style>
  .group {
    margin-bottom: 2rem;
  }

  .group-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 1rem;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    cursor: pointer;
    margin-bottom: 1rem;
    transition: background 0.2s;
  }

  .group-header:hover {
    background: var(--bg-tertiary);
  }

  h3 {
    margin: 0;
    font-size: 1.25rem;
    font-weight: 600;
  }

  .entries-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 1rem;
  }

  @media (max-width: 768px) {
    .entries-grid {
      grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    }
  }
</style>
