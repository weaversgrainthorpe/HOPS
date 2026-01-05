<script lang="ts">
  import Icon from '@iconify/svelte';
  import { focusTrap } from '$lib/utils/focusTrap';

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
    aria-labelledby="iframe-modal-title"
    tabindex="-1"
    use:focusTrap
  >
    <div class="modal-header">
      <h2 id="iframe-modal-title">{title}</h2>
      <button class="close-btn" onclick={onClose} title="Close (Esc)">
        <Icon icon="mdi:close" width="24" />
      </button>
    </div>

    <div class="iframe-container">
      <iframe src={url} title={title} sandbox="allow-same-origin allow-scripts allow-forms allow-popups"></iframe>
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
    z-index: var(--z-modal-overlay);
    padding: 1rem;
  }

  .modal-content {
    background: var(--bg-primary);
    border-radius: 0.75rem;
    box-shadow: 0 10px 40px var(--shadow);
    width: 100%;
    max-width: 1400px;
    height: 90vh;
    display: flex;
    flex-direction: column;
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem 1.5rem;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
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
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .close-btn:hover {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }

  .iframe-container {
    flex: 1;
    position: relative;
    overflow: hidden;
    border-radius: 0 0 0.75rem 0.75rem;
  }

  iframe {
    width: 100%;
    height: 100%;
    border: none;
    background: white;
  }
</style>
