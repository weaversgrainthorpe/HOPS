<script lang="ts">
  import Icon from '@iconify/svelte';
  import { exportConfig } from '$lib/utils/api';
  import { config } from '$lib/stores/config';
  import { toast } from '$lib/stores/toast';
  import { focusTrap } from '$lib/utils/focusTrap';

  interface Props {
    onClose: () => void;
  }

  let { onClose }: Props = $props();
  let exporting = $state(false);
  let exportingId = $state<string | null>(null);

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      onClose();
    }
  }

  async function handleExportAll() {
    exporting = true;

    try {
      const blob = await exportConfig('json');
      downloadBlob(blob, `hops-all-dashboards-${new Date().toISOString().split('T')[0]}.json`);
      toast.success('All dashboards exported');
      onClose();
    } catch (err) {
      toast.error('Export failed');
    } finally {
      exporting = false;
    }
  }

  async function handleExportSingle(dashboardId: string, dashboardName: string) {
    exportingId = dashboardId;

    try {
      const blob = await exportConfig('json', dashboardId);
      const safeName = dashboardName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
      downloadBlob(blob, `hops-${safeName}-${new Date().toISOString().split('T')[0]}.json`);
      toast.success(`Exported "${dashboardName}"`);
    } catch (err) {
      toast.error('Export failed');
    } finally {
      exportingId = null;
    }
  }

  function downloadBlob(blob: Blob, filename: string) {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="modal-backdrop" onclick={onClose} onkeydown={(e) => e.key === 'Escape' && onClose()}>
  <div
    class="modal-content"
    onclick={(e) => e.stopPropagation()}
    onkeydown={(e) => e.stopPropagation()}
    role="dialog"
    aria-modal="true"
    aria-labelledby="export-title"
    tabindex="-1"
    use:focusTrap
  >
    <div class="modal-header">
      <h2 id="export-title">Export Configuration</h2>
      <button class="close-btn" onclick={onClose}>
        <Icon icon="mdi:close" width="24" />
      </button>
    </div>

    <div class="modal-body">
      <p class="description">Export your HOPS configuration as JSON. You can export all dashboards or individual dashboards.</p>

      <div class="export-section">
        <h3>Export All Dashboards</h3>
        <p class="section-description">Download your complete configuration including all dashboards, tabs, groups, and tiles.</p>
        <button class="btn-primary" onclick={handleExportAll} disabled={exporting}>
          {#if exporting}
            <Icon icon="mdi:loading" width="20" class="spin" />
            Exporting...
          {:else}
            <Icon icon="mdi:download-multiple" width="20" />
            Export All ({$config?.dashboards.length || 0} dashboards)
          {/if}
        </button>
      </div>

      {#if $config?.dashboards && $config.dashboards.length > 0}
        <div class="export-section">
          <h3>Export Individual Dashboard</h3>
          <p class="section-description">Export a single dashboard. This can be imported into another HOPS instance and will be added alongside existing dashboards.</p>
          <div class="dashboard-list">
            {#each $config.dashboards as dashboard (dashboard.id)}
              <div class="dashboard-item">
                <div class="dashboard-info">
                  <span class="dashboard-name">{dashboard.name}</span>
                  <span class="dashboard-path">{dashboard.path}</span>
                </div>
                <button
                  class="btn-secondary btn-sm"
                  onclick={() => handleExportSingle(dashboard.id, dashboard.name)}
                  disabled={exportingId === dashboard.id}
                >
                  {#if exportingId === dashboard.id}
                    <Icon icon="mdi:loading" width="18" class="spin" />
                  {:else}
                    <Icon icon="mdi:download" width="18" />
                  {/if}
                  Export
                </button>
              </div>
            {/each}
          </div>
        </div>
      {/if}

      <div class="info-box">
        <Icon icon="mdi:information" width="20" />
        <div>
          <p><strong>Tip:</strong> Individual dashboard exports can be imported into any HOPS instance. The dashboard will be added alongside existing dashboards, with paths automatically adjusted if needed.</p>
        </div>
      </div>
    </div>
  </div>
</div>

<style>
  .modal-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: var(--z-modal);
    padding: 1rem;
  }

  .modal-content {
    background: var(--bg-primary);
    border-radius: 0.75rem;
    box-shadow: 0 10px 40px var(--shadow);
    width: 100%;
    max-width: 550px;
    max-height: 80vh;
    overflow-y: auto;
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem 1.5rem;
    border-bottom: 1px solid var(--border);
    position: sticky;
    top: 0;
    background: var(--bg-primary);
    z-index: 1;
  }

  .modal-header h2 {
    margin: 0;
    font-size: 1.25rem;
    color: var(--text-primary);
  }

  .close-btn {
    background: none;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    padding: 0.5rem;
    border-radius: 0.375rem;
    transition: all 0.2s;
  }

  .close-btn:hover {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }

  .modal-body {
    padding: 1.5rem;
  }

  .description {
    margin: 0 0 1.5rem 0;
    font-size: 0.875rem;
    color: var(--text-secondary);
    line-height: 1.5;
  }

  .export-section {
    padding: 1rem;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    margin-bottom: 1rem;
  }

  .export-section h3 {
    margin: 0 0 0.5rem 0;
    font-size: 1rem;
    color: var(--text-primary);
  }

  .section-description {
    margin: 0 0 1rem 0;
    font-size: 0.8125rem;
    color: var(--text-secondary);
  }

  .dashboard-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .dashboard-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.75rem;
    background: var(--bg-tertiary);
    border-radius: 0.375rem;
  }

  .dashboard-info {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    min-width: 0;
  }

  .dashboard-name {
    font-weight: 500;
    color: var(--text-primary);
    font-size: 0.875rem;
  }

  .dashboard-path {
    font-size: 0.75rem;
    color: var(--accent);
    font-family: monospace;
  }

  .info-box {
    display: flex;
    gap: 0.75rem;
    padding: 1rem;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    margin-top: 0.5rem;
  }

  .info-box p {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--text-secondary);
  }

  .btn-primary, .btn-secondary {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 1.5rem;
    border-radius: 0.5rem;
    font-weight: 500;
    transition: all 0.2s;
    border: none;
    cursor: pointer;
  }

  .btn-primary {
    background: var(--accent);
    color: white;
  }

  .btn-primary:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  .btn-secondary {
    background: var(--bg-primary);
    color: var(--text-primary);
    border: 1px solid var(--border);
  }

  .btn-secondary:hover:not(:disabled) {
    background: var(--accent);
    color: white;
    border-color: var(--accent);
  }

  .btn-sm {
    padding: 0.5rem 0.75rem;
    font-size: 0.8125rem;
  }

  .btn-primary:disabled,
  .btn-secondary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  :global(.spin) {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }
</style>
