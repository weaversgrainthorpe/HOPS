<script lang="ts">
  import Icon from '@iconify/svelte';
  import { importConfig } from '$lib/utils/api';
  import { toast } from '$lib/stores/toast';
  import { focusTrap } from '$lib/utils/focusTrap';

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

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      onClose();
    }
  }

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

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="modal-backdrop" onclick={onClose} onkeydown={(e) => e.key === 'Escape' && onClose()}>
  <div
    class="modal-content"
    onclick={(e) => e.stopPropagation()}
    onkeydown={(e) => e.stopPropagation()}
    role="dialog"
    aria-modal="true"
    aria-labelledby="import-title"
    tabindex="-1"
    use:focusTrap
  >
    <div class="modal-header">
      <h2 id="import-title">Import Configuration</h2>
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
        <span class="checkbox-description">Search for matching icons based on service names</span>
      </label>

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
          Import Configuration
        {/if}
      </button>

      <div class="info-box">
        <Icon icon="mdi:information" width="20" />
        <div>
          <p><strong>Note:</strong> Imported dashboards are added to your existing configuration. If a dashboard path already exists, the imported one will be renamed with a suffix (e.g., /home becomes /home-1).</p>
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
    margin-top: 1.5rem;
  }

  .info-box p {
    margin: 0;
    font-size: 0.875rem;
    color: var(--text-secondary);
  }

  .supported-formats {
    margin: 1rem 0;
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
