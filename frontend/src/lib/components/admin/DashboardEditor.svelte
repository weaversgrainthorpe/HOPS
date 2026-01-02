<script lang="ts">
  import { config, updateConfig } from '$lib/stores/config';
  import type { Dashboard, Tab, Group, Entry } from '$lib/types';
  import Icon from '@iconify/svelte';

  let { dashboard, onClose }: { dashboard: Dashboard; onClose: () => void } = $props();

  let editedDashboard = $state<Dashboard>(JSON.parse(JSON.stringify(dashboard)));

  async function handleSave() {
    if ($config) {
      const updatedConfig = {
        ...$config,
        dashboards: $config.dashboards.map(d =>
          d.id === editedDashboard.id ? editedDashboard : d
        )
      };
      await updateConfig(updatedConfig);
      onClose();
    }
  }

  function addTab() {
    editedDashboard.tabs = [...editedDashboard.tabs, {
      id: `tab-${Date.now()}`,
      name: 'New Tab',
      groups: [],
      order: editedDashboard.tabs.length
    }];
  }

  function deleteTab(tabId: string) {
    editedDashboard.tabs = editedDashboard.tabs.filter(t => t.id !== tabId);
  }

  function addGroup(tab: Tab) {
    const tabIndex = editedDashboard.tabs.findIndex(t => t.id === tab.id);
    if (tabIndex >= 0) {
      editedDashboard.tabs[tabIndex].groups = [...tab.groups, {
        id: `group-${Date.now()}`,
        name: 'New Group',
        collapsed: false,
        entries: [],
        order: tab.groups.length
      }];
    }
  }

  function deleteGroup(tab: Tab, groupId: string) {
    const tabIndex = editedDashboard.tabs.findIndex(t => t.id === tab.id);
    if (tabIndex >= 0) {
      editedDashboard.tabs[tabIndex].groups = tab.groups.filter(g => g.id !== groupId);
    }
  }

  function addEntry(tab: Tab, group: Group) {
    const tabIndex = editedDashboard.tabs.findIndex(t => t.id === tab.id);
    const groupIndex = tab.groups.findIndex(g => g.id === group.id);

    if (tabIndex >= 0 && groupIndex >= 0) {
      editedDashboard.tabs[tabIndex].groups[groupIndex].entries = [...group.entries, {
        id: `entry-${Date.now()}`,
        name: 'New Service',
        url: 'https://example.com',
        icon: 'mdi:application',
        openMode: 'newtab',
        size: 'medium',
        order: group.entries.length
      }];
    }
  }

  function deleteEntry(tab: Tab, group: Group, entryId: string) {
    const tabIndex = editedDashboard.tabs.findIndex(t => t.id === tab.id);
    const groupIndex = tab.groups.findIndex(g => g.id === group.id);

    if (tabIndex >= 0 && groupIndex >= 0) {
      editedDashboard.tabs[tabIndex].groups[groupIndex].entries =
        group.entries.filter(e => e.id !== entryId);
    }
  }
</script>

<div class="editor-overlay">
  <div class="editor-panel">
    <div class="editor-header">
      <h2>Edit Dashboard</h2>
      <button onclick={onClose} class="btn-icon">
        <Icon icon="mdi:close" width="24" />
      </button>
    </div>

    <div class="editor-content">
      <div class="form-section">
        <label>
          Dashboard Name
          <input type="text" bind:value={editedDashboard.name} />
        </label>

        <label>
          URL Path
          <input type="text" bind:value={editedDashboard.path} placeholder="/home" />
        </label>
      </div>

      <div class="tabs-section">
        <div class="section-header">
          <h3>Tabs</h3>
          <button onclick={addTab} class="btn-sm">
            <Icon icon="mdi:plus" width="16" />
            Add Tab
          </button>
        </div>

        {#each editedDashboard.tabs as tab (tab.id)}
          <div class="tab-editor card">
            <div class="tab-header">
              <input type="text" bind:value={tab.name} placeholder="Tab name" />
              <button onclick={() => deleteTab(tab.id)} class="btn-danger-sm">
                <Icon icon="mdi:delete" width="16" />
              </button>
            </div>

            <div class="groups-section">
              <button onclick={() => addGroup(tab)} class="btn-sm">
                <Icon icon="mdi:plus" width="16" />
                Add Group
              </button>

              {#each tab.groups as group (group.id)}
                <div class="group-editor">
                  <div class="group-header">
                    <input type="text" bind:value={group.name} placeholder="Group name" />
                    <button onclick={() => deleteGroup(tab, group.id)} class="btn-danger-sm">
                      <Icon icon="mdi:delete" width="16" />
                    </button>
                  </div>

                  <button onclick={() => addEntry(tab, group)} class="btn-xs">
                    <Icon icon="mdi:plus" width="14" />
                    Add Entry
                  </button>

                  {#each group.entries as entry (entry.id)}
                    <div class="entry-editor">
                      <input type="text" bind:value={entry.name} placeholder="Service name" class="entry-name" />
                      <input type="text" bind:value={entry.url} placeholder="https://..." class="entry-url" />
                      <input type="text" bind:value={entry.icon} placeholder="mdi:application" class="entry-icon" />
                      <button onclick={() => deleteEntry(tab, group, entry.id)} class="btn-danger-xs">
                        <Icon icon="mdi:close" width="14" />
                      </button>
                    </div>
                  {/each}
                </div>
              {/each}
            </div>
          </div>
        {/each}
      </div>
    </div>

    <div class="editor-footer">
      <button onclick={onClose} class="btn-secondary">Cancel</button>
      <button onclick={handleSave} class="btn-primary">Save Changes</button>
    </div>
  </div>
</div>

<style>
  .editor-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 1rem;
  }

  .editor-panel {
    background: var(--bg-primary);
    border-radius: 0.5rem;
    width: 100%;
    max-width: 900px;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
  }

  .editor-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1.5rem;
    border-bottom: 1px solid var(--border);
  }

  .editor-header h2 {
    margin: 0;
  }

  .editor-content {
    flex: 1;
    overflow-y: auto;
    padding: 1.5rem;
  }

  .editor-footer {
    display: flex;
    gap: 1rem;
    justify-content: flex-end;
    padding: 1.5rem;
    border-top: 1px solid var(--border);
  }

  .form-section {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    margin-bottom: 2rem;
  }

  label {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    font-weight: 500;
  }

  input[type="text"] {
    width: 100%;
  }

  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 1rem;
  }

  .section-header h3 {
    margin: 0;
  }

  .tab-editor {
    margin-bottom: 1rem;
    padding: 1rem;
  }

  .tab-header {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 1rem;
  }

  .groups-section {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .group-editor {
    padding: 1rem;
    background: var(--bg-tertiary);
    border-radius: 0.375rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .group-header {
    display: flex;
    gap: 0.5rem;
  }

  .entry-editor {
    display: grid;
    grid-template-columns: 2fr 3fr 2fr auto;
    gap: 0.5rem;
    align-items: center;
  }

  .entry-name, .entry-url, .entry-icon {
    font-size: 0.875rem;
  }

  /* Button styles */
  .btn-primary, .btn-secondary, .btn-sm, .btn-xs {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
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

  .btn-secondary {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }

  .btn-sm {
    padding: 0.375rem 0.75rem;
    font-size: 0.875rem;
  }

  .btn-xs {
    padding: 0.25rem 0.5rem;
    font-size: 0.75rem;
  }

  .btn-icon, .btn-danger-sm, .btn-danger-xs {
    background: transparent;
    border: none;
    cursor: pointer;
    color: #ef4444;
    padding: 0.25rem;
    border-radius: 0.25rem;
    display: inline-flex;
    align-items: center;
  }

  .btn-icon:hover, .btn-danger-sm:hover, .btn-danger-xs:hover {
    background: #fee2e2;
  }
</style>
