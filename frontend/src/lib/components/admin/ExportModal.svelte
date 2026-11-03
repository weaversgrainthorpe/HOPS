<script lang="ts">
  import Icon from '@iconify/svelte';
  import Modal from '$lib/components/shared/Modal.svelte';
  import { exportConfig } from '$lib/utils/api';
  import { dashboards, ensureFullConfig } from '$lib/stores/config';
  import { toast } from '$lib/stores/toast';
  import { missingAssetsWarning } from '$lib/utils/exportResult';

  interface Props {
    onClose: () => void;
  }

  let { onClose }: Props = $props();
  let exporting = $state(false);
  let exportingId = $state<string | null>(null);
  // Every dashboard the server exports, in display order.
  const allDashboards = $derived($dashboards);

  // Export, like Settings, works from the whole config: loaded first if the page holds only the
  // index of the other dashboards. False (said in a toast) when it can't be.
  async function loadAll(): Promise<boolean> {
    try {
      await ensureFullConfig();
      return true;
    } catch (e) {
      toast.error(`Export failed: couldn't load all your dashboards: ${e instanceof Error && e.message ? e.message : 'the request failed'}`);
      return false;
    }
  }

  async function handleExportAll() {
    exporting = true;

    try {
      if (!(await loadAll())) return;
      const { blob, missing, importWarning } = await exportConfig('json', 'all-dashboards');
      downloadBlob(blob, `hops-all-dashboards-${new Date().toISOString().split('T')[0]}.json`);
      // Pictures left out, or a file too big to import back, are said and stay on screen until dismissed.
      const warning = missingAssetsWarning(missing);
      if (warning) toast.warning(warning, 0);
      if (importWarning) toast.warning(importWarning, 0);
      if (!warning && !importWarning) toast.success('All dashboards exported');
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
      if (!(await loadAll())) return;
      const { blob, missing, importWarning } = await exportConfig('json', dashboardId);
      const safeName = dashboardName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
      downloadBlob(blob, `hops-${safeName}-${new Date().toISOString().split('T')[0]}.json`);
      const warning = missingAssetsWarning(missing);
      if (warning) toast.warning(warning, 0);
      if (importWarning) toast.warning(importWarning, 0);
      if (!warning && !importWarning) toast.success(`Exported "${dashboardName}"`);
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

<Modal
  id="export-config"
  title="Export dashboards"
  titleIcon="mdi:tray-arrow-up"
  onClose={onClose}
  maxWidth="550px"
>
  <p class="description">Save dashboards as a JSON file, which Import reads back. Each export holds the dashboards with their tabs, folders and tiles, and the pictures they use. Settings, the theme and the icons library are not included: they are in <a href="/settings/backups">Settings › Backups</a>.</p>

  <div class="export-section">
    <h3>Export all</h3>
    <p class="section-description">Saves every dashboard in one file. It is not a backup of the app.</p>
    <button class="btn-primary" onclick={handleExportAll} disabled={exporting}>
      {#if exporting}
        <Icon icon="mdi:loading" width="20" class="spin" />
        Exporting…
      {:else}
        <Icon icon="mdi:download-multiple" width="20" />
        Export all ({allDashboards.length} dashboards)
      {/if}
    </button>
  </div>

  {#if allDashboards.length > 0}
    <div class="export-section">
      <h3>Export one dashboard</h3>
      <p class="section-description">Saves a single dashboard. It can be imported into another HOPS instance and will be added alongside existing dashboards.</p>
      <div class="dashboard-list">
        {#each allDashboards as dashboard (dashboard.id)}
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
      <p><strong>Tip:</strong> A single dashboard can be imported into any HOPS instance. It is added alongside existing dashboards, with its path adjusted if needed.</p>
    </div>
  </div>
</Modal>

<style>
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
    color: var(--accent-text);
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

  /* .btn-primary, .btn-secondary, .btn-sm styles are defined globally in app.css */
  /* .spin animation is defined globally in app.css */
</style>
