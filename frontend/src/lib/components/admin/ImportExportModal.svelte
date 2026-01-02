<script lang="ts">
  import Icon from '@iconify/svelte';
  import { getAuthToken } from '$lib/utils/api';

  interface Props {
    onClose: () => void;
  }

  let { onClose }: Props = $props();
  let importing = $state(false);
  let exporting = $state(false);
  let error = $state<string | null>(null);
  let success = $state<string | null>(null);
  let fileInput = $state<HTMLInputElement>();

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      onClose();
    }
  }

  async function handleExport() {
    exporting = true;
    error = null;

    try {
      const token = getAuthToken();
      const response = await fetch('/api/config/export', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        throw new Error('Export failed');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `hops-config-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      success = 'Configuration exported successfully!';
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to export configuration';
    } finally {
      exporting = false;
    }
  }

  async function handleImport() {
    if (!fileInput?.files?.[0]) {
      error = 'Please select a file to import';
      return;
    }

    importing = true;
    error = null;
    success = null;

    try {
      const formData = new FormData();
      formData.append('file', fileInput.files[0]);

      const token = getAuthToken();
      const response = await fetch('/api/config/import', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        body: formData
      });

      if (!response.ok) {
        const data = await response.text();
        throw new Error(data || 'Import failed');
      }

      const data = await response.json();
      success = data.message || 'Configuration imported successfully!';

      // Reload page after successful import
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to import configuration';
    } finally {
      importing = false;
    }
  }

  function selectFile() {
    fileInput?.click();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="modal-backdrop" onclick={onClose}>
  <div class="modal-content" onclick={(e) => e.stopPropagation()}>
    <div class="modal-header">
      <h2>Import / Export Configuration</h2>
      <button class="close-btn" onclick={onClose}>
        <Icon icon="mdi:close" width="24" />
      </button>
    </div>

    <div class="modal-body">
      {#if error}
        <div class="alert alert-error">
          <Icon icon="mdi:alert-circle" width="24" />
          <span>{error}</span>
        </div>
      {/if}

      {#if success}
        <div class="alert alert-success">
          <Icon icon="mdi:check-circle" width="24" />
          <span>{success}</span>
        </div>
      {/if}

      <section class="section">
        <h3>Export Configuration</h3>
        <p class="description">Download your current dashboard configuration as a JSON file. This includes all dashboards, tabs, groups, and tiles.</p>
        <button class="btn-primary" onclick={handleExport} disabled={exporting}>
          {#if exporting}
            <Icon icon="mdi:loading" width="20" class="spin" />
            Exporting...
          {:else}
            <Icon icon="mdi:download" width="20" />
            Export as JSON
          {/if}
        </button>
      </section>

      <div class="divider"></div>

      <section class="section">
        <h3>Import Configuration</h3>
        <p class="description">Upload a HOPS configuration file to replace your current configuration. This will overwrite all existing dashboards.</p>

        <div class="file-input-container">
          <input
            type="file"
            accept=".json"
            bind:this={fileInput}
            style="display: none;"
          />
          <button class="btn-secondary" onclick={selectFile}>
            <Icon icon="mdi:file-upload" width="20" />
            Select File
          </button>
          {#if fileInput?.files?.[0]}
            <span class="file-name">{fileInput.files[0].name}</span>
          {/if}
        </div>

        <button
          class="btn-primary"
          onclick={handleImport}
          disabled={importing || !fileInput?.files?.[0]}
        >
          {#if importing}
            <Icon icon="mdi:loading" width="20" class="spin" />
            Importing...
          {:else}
            <Icon icon="mdi:upload" width="20" />
            Import Configuration
          {/if}
        </button>
      </section>

      <div class="info-box">
        <Icon icon="mdi:information" width="20" />
        <div>
          <p><strong>Note:</strong> Importing a configuration will completely replace your current setup. Make sure to export your current configuration first if you want to keep a backup.</p>
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
    z-index: 9999;
    padding: 1rem;
  }

  .modal-content {
    background: var(--bg-primary);
    border-radius: 0.75rem;
    box-shadow: 0 10px 40px var(--shadow);
    width: 100%;
    max-width: 600px;
    max-height: 90vh;
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

  .section {
    margin-bottom: 2rem;
  }

  .section:last-child {
    margin-bottom: 0;
  }

  .section h3 {
    margin: 0 0 0.5rem 0;
    font-size: 1.125rem;
    color: var(--text-primary);
  }

  .description {
    margin: 0 0 1rem 0;
    font-size: 0.875rem;
    color: var(--text-secondary);
    line-height: 1.5;
  }

  .divider {
    height: 1px;
    background: var(--border);
    margin: 2rem 0;
  }

  .file-input-container {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1rem;
  }

  .file-name {
    font-size: 0.875rem;
    color: var(--text-secondary);
  }

  .btn-primary,
  .btn-secondary {
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

  .btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-secondary {
    background: var(--bg-secondary);
    color: var(--text-primary);
    border: 1px solid var(--border);
  }

  .btn-secondary:hover {
    background: var(--bg-tertiary);
    border-color: var(--accent);
  }

  .alert {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 1rem;
    border-radius: 0.5rem;
    margin-bottom: 1rem;
  }

  .alert-error {
    background: rgba(220, 38, 38, 0.1);
    color: #dc2626;
    border: 1px solid rgba(220, 38, 38, 0.2);
  }

  .alert-success {
    background: rgba(16, 185, 129, 0.1);
    color: #10b981;
    border: 1px solid rgba(16, 185, 129, 0.2);
  }

  .info-box {
    display: flex;
    gap: 0.75rem;
    padding: 1rem;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    margin-top: 2rem;
  }

  .info-box p {
    margin: 0;
    font-size: 0.875rem;
    color: var(--text-secondary);
  }

  .spin {
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
