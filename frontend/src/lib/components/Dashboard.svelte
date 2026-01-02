<script lang="ts">
  import type { Dashboard } from '$lib/types';
  import TabPanel from './TabPanel.svelte';

  let { dashboard }: { dashboard: Dashboard } = $props();
  let activeTabIndex = $state(0);

  function setActiveTab(index: number) {
    activeTabIndex = index;
  }
</script>

<div class="dashboard" style:background-image={dashboard.background?.type === 'image' ? `url(${dashboard.background.value})` : 'none'}>
  <div class="dashboard-header">
    <h1>{dashboard.name}</h1>

    {#if dashboard.tabs.length > 1}
      <div class="tabs">
        {#each dashboard.tabs as tab, index (tab.id)}
          <button
            class="tab"
            class:active={activeTabIndex === index}
            onclick={() => setActiveTab(index)}
          >
            {tab.name}
          </button>
        {/each}
      </div>
    {/if}
  </div>

  {#if dashboard.tabs.length > 0}
    <TabPanel tab={dashboard.tabs[activeTabIndex]} />
  {:else}
    <div class="empty-dashboard">
      <p>No tabs configured for this dashboard</p>
      <a href="/admin">Go to Admin Panel</a>
    </div>
  {/if}
</div>

<style>
  .dashboard {
    min-height: calc(100vh - 60px);
    background-size: cover;
    background-position: center;
    background-attachment: fixed;
  }

  .dashboard-header {
    padding: 1.5rem 2rem;
    background: rgba(15, 23, 42, 0.8);
    backdrop-filter: blur(10px);
    border-bottom: 1px solid var(--border);
  }

  h1 {
    margin: 0 0 1rem 0;
    font-size: 1.75rem;
    font-weight: 600;
  }

  .tabs {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .tab {
    padding: 0.75rem 1.5rem;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    color: var(--text-secondary);
    font-weight: 500;
    transition: all 0.2s;
  }

  .tab:hover {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }

  .tab.active {
    background: var(--accent);
    color: white;
    border-color: var(--accent);
  }

  .empty-dashboard {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 400px;
    gap: 1rem;
    padding: 2rem;
  }

  .empty-dashboard p {
    color: var(--text-secondary);
  }

  .empty-dashboard a {
    padding: 0.75rem 1.5rem;
    background: var(--accent);
    color: white;
    border-radius: 0.5rem;
    text-decoration: none;
  }

  .empty-dashboard a:hover {
    background: var(--accent-hover);
  }
</style>
