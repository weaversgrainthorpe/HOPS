<script lang="ts">
  import { config, updateConfig } from '$lib/stores/config';
  import type { Dashboard } from '$lib/types';
  import Icon from '@iconify/svelte';

  let { onEdit }: { onEdit: (dashboard: Dashboard) => void } = $props();

  function handleNew() {
    const newDashboard: Dashboard = {
      id: `dashboard-${Date.now()}`,
      name: 'New Dashboard',
      path: `/dashboard-${Date.now()}`,
      tabs: [],
      order: $config?.dashboards.length || 0
    };

    if ($config) {
      const updatedConfig = {
        ...$config,
        dashboards: [...$config.dashboards, newDashboard]
      };
      updateConfig(updatedConfig);
    }
  }

  async function handleDelete(dashboard: Dashboard) {
    if (!confirm(`Delete dashboard "${dashboard.name}"?`)) return;

    if ($config) {
      const updatedConfig = {
        ...$config,
        dashboards: $config.dashboards.filter(d => d.id !== dashboard.id)
      };
      await updateConfig(updatedConfig);
    }
  }
</script>

<div class="dashboard-list">
  <div class="list-header">
    <h2>Dashboards</h2>
    <button onclick={handleNew} class="btn-primary">
      <Icon icon="mdi:plus" width="20" />
      New Dashboard
    </button>
  </div>

  {#if $config?.dashboards && $config.dashboards.length > 0}
    <div class="dashboards">
      {#each $config.dashboards as dashboard (dashboard.id)}
        <div class="dashboard-item card">
          <div class="dashboard-info">
            <h3>{dashboard.name}</h3>
            <p class="path">{dashboard.path}</p>
            <p class="meta">{dashboard.tabs.length} tabs</p>
          </div>

          <div class="dashboard-actions">
            <button onclick={() => onEdit(dashboard)} class="btn-secondary">
              <Icon icon="mdi:pencil" width="20" />
              Edit
            </button>
            <a href={dashboard.path} target="_blank" class="btn-secondary">
              <Icon icon="mdi:open-in-new" width="20" />
            </a>
            <button onclick={() => handleDelete(dashboard)} class="btn-danger">
              <Icon icon="mdi:delete" width="20" />
            </button>
          </div>
        </div>
      {/each}
    </div>
  {:else}
    <div class="empty-state">
      <Icon icon="mdi:view-dashboard-outline" width="64" />
      <p>No dashboards yet</p>
      <button onclick={handleNew} class="btn-primary">Create Your First Dashboard</button>
    </div>
  {/if}
</div>

<style>
  .dashboard-list {
    width: 100%;
  }

  .list-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 1.5rem;
  }

  h2 {
    margin: 0;
    font-size: 1.5rem;
  }

  .dashboards {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .dashboard-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1.5rem;
    gap: 1rem;
  }

  .dashboard-info {
    flex: 1;
  }

  .dashboard-info h3 {
    margin: 0 0 0.25rem 0;
    font-size: 1.125rem;
  }

  .path {
    margin: 0.25rem 0;
    color: var(--accent);
    font-size: 0.875rem;
    font-family: monospace;
  }

  .meta {
    margin: 0.5rem 0 0 0;
    color: var(--text-secondary);
    font-size: 0.875rem;
  }

  .dashboard-actions {
    display: flex;
    gap: 0.5rem;
  }

  .btn-primary, .btn-secondary, .btn-danger {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 1rem;
    border: none;
    border-radius: 0.375rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
  }

  .btn-primary {
    background: var(--accent);
    color: white;
  }

  .btn-primary:hover {
    background: var(--accent-hover);
  }

  .btn-secondary {
    background: var(--bg-tertiary);
    color: var(--text-primary);
    text-decoration: none;
  }

  .btn-secondary:hover {
    background: var(--accent);
    color: white;
  }

  .btn-danger {
    background: transparent;
    color: #ef4444;
  }

  .btn-danger:hover {
    background: #fee2e2;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 4rem 2rem;
    text-align: center;
    color: var(--text-secondary);
  }

  .empty-state p {
    margin: 1rem 0 1.5rem 0;
  }
</style>
