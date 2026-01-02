<script lang="ts">
  import Icon from '@iconify/svelte';

  interface Props {
    url: string;
    title: string;
    onClose: () => void;
  }

  let { url, title, onClose }: Props = $props();

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      onClose();
    }
  }

  function openInNewTab() {
    window.open(url, '_blank');
    onClose();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="modal-backdrop" onclick={onClose}>
  <div class="modal-content" onclick={(e) => e.stopPropagation()}>
    <div class="modal-header">
      <h2>{title}</h2>
      <div class="header-actions">
        <button class="action-btn" onclick={openInNewTab} title="Open in new tab">
          <Icon icon="mdi:open-in-new" width="20" />
        </button>
        <button class="close-btn" onclick={onClose} title="Close (Esc)">
          <Icon icon="mdi:close" width="24" />
        </button>
      </div>
    </div>

    <div class="modal-body">
      <div class="info-box">
        <Icon icon="mdi:information" width="24" />
        <div>
          <p><strong>Opening:</strong> {title}</p>
          <p style="margin-top: 0.5rem; color: var(--text-secondary);">{url}</p>
        </div>
      </div>

      <div class="action-buttons">
        <a href={url} target="_blank" class="btn-primary" onclick={onClose}>
          <Icon icon="mdi:open-in-new" width="20" />
          Open in New Tab
        </a>
        <a href={url} class="btn-secondary">
          <Icon icon="mdi:link" width="20" />
          Open in Same Tab
        </a>
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
    display: flex;
    flex-direction: column;
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

  .header-actions {
    display: flex;
    gap: 0.5rem;
  }

  .action-btn {
    background: none;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    padding: 0.5rem;
    border-radius: 0.375rem;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .action-btn:hover {
    background: var(--bg-tertiary);
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
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .close-btn:hover {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }

  .modal-body {
    padding: 2rem 1.5rem;
  }

  .info-box {
    display: flex;
    gap: 1rem;
    padding: 1rem;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    margin-bottom: 2rem;
  }

  .info-box p {
    margin: 0;
    color: var(--text-primary);
  }

  .action-buttons {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .btn-primary,
  .btn-secondary {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 0.875rem 1.5rem;
    border-radius: 0.5rem;
    font-weight: 500;
    text-decoration: none;
    transition: all 0.2s;
    border: 1px solid;
  }

  .btn-primary {
    background: var(--accent);
    color: white;
    border-color: var(--accent);
  }

  .btn-primary:hover {
    background: var(--accent-hover);
    border-color: var(--accent-hover);
  }

  .btn-secondary {
    background: var(--bg-secondary);
    color: var(--text-primary);
    border-color: var(--border);
  }

  .btn-secondary:hover {
    background: var(--bg-tertiary);
    border-color: var(--accent);
  }
</style>
