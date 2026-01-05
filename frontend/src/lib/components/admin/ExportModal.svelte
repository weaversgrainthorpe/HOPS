<script lang="ts">
  import Icon from '@iconify/svelte';
  import { exportConfig } from '$lib/utils/api';
  import { currentDashboard } from '$lib/stores/config';
  import { toast } from '$lib/stores/toast';
  import { focusTrap } from '$lib/utils/focusTrap';

  interface Props {
    onClose: () => void;
  }

  let { onClose }: Props = $props();
  let exporting = $state(false);

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      onClose();
    }
  }

  async function handleExport() {
    exporting = true;

    try {
      const blob = await exportConfig('json');
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const dashboardName = $currentDashboard?.name?.toLowerCase().replace(/\s+/g, '-') || 'config';
      a.download = `hops-${dashboardName}-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast.success('Configuration exported');
      onClose();
    } catch (err) {
      toast.error('Export failed');
    } finally {
      exporting = false;
    }
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
      <p class="description">Download your current dashboard configuration as a JSON file. This includes all dashboards, tabs, groups, and tiles.</p>

      <div class="info-box">
        <Icon icon="mdi:information" width="20" />
        <div>
          <p>The export includes your complete HOPS configuration. You can import this file on the Admin page to restore or migrate your setup.</p>
        </div>
      </div>

      <button class="btn-primary" onclick={handleExport} disabled={exporting}>
        {#if exporting}
          <Icon icon="mdi:loading" width="20" class="spin" />
          Exporting...
        {:else}
          <Icon icon="mdi:download" width="20" />
          Export as JSON
        {/if}
      </button>
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
    max-width: 450px;
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem 1.5rem;
    border-bottom: 1px solid var(--border);
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

  .info-box {
    display: flex;
    gap: 0.75rem;
    padding: 1rem;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    margin-bottom: 1.5rem;
  }

  .info-box p {
    margin: 0;
    font-size: 0.875rem;
    color: var(--text-secondary);
  }

  .btn-primary {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 1.5rem;
    border-radius: 0.5rem;
    font-weight: 500;
    transition: all 0.2s;
    border: none;
    cursor: pointer;
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
