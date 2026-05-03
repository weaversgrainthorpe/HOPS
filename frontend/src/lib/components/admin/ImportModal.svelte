<script lang="ts">
  import Icon from '@iconify/svelte';
  import Modal from '$lib/components/shared/Modal.svelte';
  import { importConfig } from '$lib/utils/api';
  import { toast } from '$lib/stores/toast';

  interface Props {
    onClose: () => void;
    onImportSuccess?: () => void;
  }

  let { onClose, onImportSuccess }: Props = $props();
  let importing = $state(false);
  let error = $state<string | null>(null);
  let success = $state<string | null>(null);
  let fileInput: HTMLInputElement;
  let selectedFile = $state<File | null>(null);
  let autoMatchIcons = $state(true);

  function handleFileChange(e: Event) {
    const target = e.target as HTMLInputElement;
    selectedFile = target.files?.[0] || null;
  }

  async function handleImport() {
    if (!selectedFile) {
      error = 'Please select a file to import';
      toast.warning('Please select a file first');
      return;
    }

    importing = true;
    error = null;
    success = null;

    try {
      const result = await importConfig(selectedFile, { autoMatchIcons });
      success = result.message || 'Configuration imported successfully!';
      toast.success('Configuration imported');

      // Close and notify parent after successful import
      setTimeout(() => {
        onClose();
        onImportSuccess?.();
      }, 1500);
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to import configuration';
      toast.error('Import failed');
    } finally {
      importing = false;
    }
  }

  function selectFile() {
    fileInput?.click();
  }
</script>

<Modal
  id="import-config"
  title="Import Configuration"
  titleIcon="mdi:upload"
  onClose={onClose}
  maxWidth="550px"
>
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

  <p class="description">Upload a configuration file to add dashboards. Imported dashboards will be added alongside your existing ones.</p>

  <div class="file-input-container">
    <input
      type="file"
      accept=".json,.yml,.yaml"
      bind:this={fileInput}
      onchange={handleFileChange}
      style="display: none;"
    />
    <button class="btn-secondary" onclick={selectFile}>
      <Icon icon="mdi:file-upload" width="20" />
      Select File
    </button>
    {#if selectedFile}
      <span class="file-name">{selectedFile.name}</span>
    {/if}
  </div>

  <div class="supported-formats">
    <p class="formats-title">Supported formats:</p>
    <ul>
      <li><strong>HOPS JSON</strong> - Native format</li>
      <li><strong>Homer YAML</strong> - config.yml from Homer dashboard</li>
      <li><strong>Dashy YAML</strong> - conf.yml from Dashy dashboard</li>
      <li><strong>Heimdall JSON</strong> - Export from Heimdall dashboard</li>
    </ul>
  </div>

  <label class="checkbox-option">
    <input type="checkbox" bind:checked={autoMatchIcons} />
    <span class="checkbox-label">
      <Icon icon="mdi:auto-fix" width="18" />
      Auto-match icons
    </span>
    <span class="checkbox-description">Search for matching icons based on tile names</span>
  </label>

  <div class="info-box">
    <Icon icon="mdi:information" width="20" />
    <div>
      <p><strong>Note:</strong> Imported dashboards are added to your existing configuration. If a dashboard path already exists, the imported one will be renamed with a suffix (e.g., /home becomes /home-1).</p>
    </div>
  </div>

  {#snippet footer()}
    <div class="modal-actions">
      <button type="button" class="btn-secondary" onclick={onClose}>
        Cancel
      </button>
      <button
        class="btn-primary"
        onclick={handleImport}
        disabled={importing || !selectedFile}
      >
        {#if importing}
          <Icon icon="mdi:loading" width="20" class="spin" />
          Importing...
        {:else}
          <Icon icon="mdi:upload" width="20" />
          Import
        {/if}
      </button>
    </div>
  {/snippet}
</Modal>

<style>
  .description {
    margin: 0 0 1rem 0;
    font-size: 0.875rem;
    color: var(--text-secondary);
    line-height: 1.5;
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

  .modal-actions {
    display: flex;
    gap: 0.75rem;
    justify-content: flex-end;
    width: 100%;
  }

  /* .btn-primary, .btn-secondary styles are defined globally in app.css */

  .alert {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 1rem;
    border-radius: 0.5rem;
    margin-bottom: 1rem;
  }

  .alert-error {
    background: color-mix(in srgb, var(--color-error-dark) 10%, transparent);
    color: var(--color-error-dark);
    border: 1px solid color-mix(in srgb, var(--color-error-dark) 20%, transparent);
  }

  .alert-success {
    background: color-mix(in srgb, var(--color-success) 10%, transparent);
    color: var(--color-success);
    border: 1px solid color-mix(in srgb, var(--color-success) 20%, transparent);
  }

  .info-box {
    display: flex;
    gap: 0.75rem;
    padding: 1rem;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 0.5rem;
  }

  .info-box p {
    margin: 0;
    font-size: 0.875rem;
    color: var(--text-secondary);
  }

  .supported-formats {
    margin: 0 0 1rem 0;
    padding: 1rem;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 0.5rem;
  }

  .formats-title {
    margin: 0 0 0.5rem 0;
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .supported-formats ul {
    margin: 0;
    padding-left: 1.5rem;
    list-style: disc;
  }

  .supported-formats li {
    font-size: 0.875rem;
    color: var(--text-secondary);
    margin-bottom: 0.25rem;
  }

  .supported-formats li:last-child {
    margin-bottom: 0;
  }

  .checkbox-option {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    padding: 1rem;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    margin-bottom: 1rem;
    cursor: pointer;
    transition: all 0.2s;
  }

  .checkbox-option:hover {
    border-color: var(--accent);
  }

  .checkbox-option input[type="checkbox"] {
    width: 1.125rem;
    height: 1.125rem;
    accent-color: var(--accent);
    cursor: pointer;
  }

  .checkbox-label {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    font-weight: 500;
    color: var(--text-primary);
  }

  .checkbox-description {
    width: 100%;
    margin-left: 1.625rem;
    font-size: 0.8125rem;
    color: var(--text-secondary);
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
