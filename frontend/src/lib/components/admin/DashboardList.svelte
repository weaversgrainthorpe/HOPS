<script lang="ts">
  import { config, updateConfig, loadConfig } from '$lib/stores/config';
  import { editMode, enableEditMode } from '$lib/stores/editMode';
  import { confirm } from '$lib/stores/confirmModal';
  import { toast } from '$lib/stores/toast';
  import { goto } from '$app/navigation';
  import { exportConfig } from '$lib/utils/api';
  import type { Dashboard } from '$lib/types';
  import Icon from '@iconify/svelte';
  import ImportModal from './ImportModal.svelte';

  let editingId = $state<string | null>(null);
  let editName = $state('');
  let editPath = $state('');
  let showImport = $state(false);
  let exportingId = $state<string | null>(null);

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
    const confirmed = await confirm({
      title: 'Delete Dashboard',
      message: `Are you sure you want to delete "${dashboard.name}"? This action cannot be undone.`,
      confirmText: 'Delete',
      confirmStyle: 'danger'
    });
    if (!confirmed) return;

    if ($config) {
      const updatedConfig = {
        ...$config,
        dashboards: $config.dashboards.filter(d => d.id !== dashboard.id)
      };
      await updateConfig(updatedConfig);
    }
  }

  function startEdit(dashboard: Dashboard) {
    editingId = dashboard.id;
    editName = dashboard.name;
    editPath = dashboard.path;
  }

  function cancelEdit() {
    editingId = null;
    editName = '';
    editPath = '';
  }

  async function saveEdit(dashboard: Dashboard) {
    if (!$config) return;

    const updatedConfig = {
      ...$config,
      dashboards: $config.dashboards.map(d =>
        d.id === dashboard.id
          ? { ...d, name: editName, path: editPath }
          : d
      )
    };
    await updateConfig(updatedConfig);
    editingId = null;
  }

  async function openDashboard(dashboard: Dashboard) {
    enableEditMode();
    await goto(dashboard.path);
  }

  async function handleExport(dashboard: Dashboard) {
    exportingId = dashboard.id;
    try {
      // Export only this specific dashboard
      const blob = await exportConfig('json', dashboard.id);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const safeName = dashboard.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
      a.download = `hops-${safeName}-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      toast.success(`Exported "${dashboard.name}"`);
    } catch (err) {
      toast.error('Export failed');
    } finally {
      exportingId = null;
    }
  }
</script>

<div class="dashboard-list">
  <div class="list-header">
    <h2>Dashboards</h2>
    <div class="header-actions">
      <button onclick={() => showImport = true} class="btn-secondary">
        <Icon icon="mdi:upload" width="20" />
        Import
      </button>
      <button onclick={handleNew} class="btn-primary">
        <Icon icon="mdi:plus" width="20" />
        New Dashboard
      </button>
    </div>
  </div>

  {#if $config?.dashboards && $config.dashboards.length > 0}
    <div class="dashboards">
      {#each $config.dashboards as dashboard (dashboard.id)}
        <div class="dashboard-item card">
          {#if editingId === dashboard.id}
            <div class="dashboard-edit-form">
              <div class="edit-fields">
                <div class="field">
                  <label for="name-{dashboard.id}">Name</label>
                  <input
                    id="name-{dashboard.id}"
                    type="text"
                    bind:value={editName}
                    placeholder="Dashboard name"
                  />
                </div>
                <div class="field">
                  <label for="path-{dashboard.id}">URL Path</label>
                  <input
                    id="path-{dashboard.id}"
                    type="text"
                    bind:value={editPath}
                    placeholder="/my-dashboard"
                  />
                </div>
              </div>
              <div class="edit-actions">
                <button onclick={() => saveEdit(dashboard)} class="btn-primary btn-sm">
                  <Icon icon="mdi:check" width="18" />
                  Save
                </button>
                <button onclick={cancelEdit} class="btn-secondary btn-sm">
                  Cancel
                </button>
              </div>
            </div>
          {:else}
            <button class="dashboard-info" onclick={() => openDashboard(dashboard)} title="Open dashboard">
              <h3>{dashboard.name}</h3>
              <p class="path">{dashboard.path}</p>
              <p class="meta">{dashboard.tabs.length} tabs</p>
            </button>

            <div class="dashboard-actions">
              <button onclick={() => startEdit(dashboard)} class="btn-secondary" title="Rename">
                <Icon icon="mdi:pencil" width="20" />
              </button>
              <button onclick={() => handleExport(dashboard)} class="btn-secondary" title="Export" disabled={exportingId === dashboard.id}>
                {#if exportingId === dashboard.id}
                  <Icon icon="mdi:loading" width="20" class="spin" />
                {:else}
                  <Icon icon="mdi:download" width="20" />
                {/if}
              </button>
              <a href={dashboard.path} target="_blank" class="btn-secondary" title="Open in new tab">
                <Icon icon="mdi:open-in-new" width="20" />
              </a>
              <button onclick={() => handleDelete(dashboard)} class="btn-danger" title="Delete">
                <Icon icon="mdi:trash-can" width="20" />
              </button>
            </div>
          {/if}
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

{#if showImport}
  <ImportModal onClose={() => showImport = false} onImportSuccess={loadConfig} />
{/if}

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

  .header-actions {
    display: flex;
    gap: 0.75rem;
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
    text-align: left;
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 0.5rem;
    margin: -0.5rem;
    border-radius: 0.5rem;
    transition: background 0.2s;
  }

  .dashboard-info:hover {
    background: var(--bg-tertiary);
  }

  .dashboard-info h3 {
    margin: 0 0 0.25rem 0;
    font-size: 1.125rem;
    color: var(--text-primary);
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

  .dashboard-edit-form {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .edit-fields {
    display: flex;
    gap: 1rem;
  }

  .field {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .field label {
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--text-secondary);
  }

  .field input {
    width: 100%;
    padding: 0.5rem;
    border: 1px solid var(--border);
    border-radius: 0.375rem;
    background: var(--bg-secondary);
    color: var(--text-primary);
  }

  .edit-actions {
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

  .btn-sm {
    padding: 0.375rem 0.75rem;
    font-size: 0.875rem;
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
    background: var(--bg-tertiary);
    color: var(--color-error);
  }

  .btn-danger:hover {
    background: color-mix(in srgb, var(--color-error) 10%, var(--bg-tertiary));
    color: var(--color-error-dark);
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

  @media (max-width: 640px) {
    .dashboard-item {
      flex-direction: column;
      align-items: flex-start;
    }

    .dashboard-actions {
      width: 100%;
      justify-content: flex-start;
    }

    .edit-fields {
      flex-direction: column;
    }
  }

  :global(.spin) {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
</style>
