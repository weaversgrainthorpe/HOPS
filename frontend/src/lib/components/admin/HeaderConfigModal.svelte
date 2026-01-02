<script lang="ts">
  import Icon from '@iconify/svelte';
  import type { HeaderConfig } from '$lib/types';

  interface Props {
    header?: HeaderConfig;
    onSave: (header: HeaderConfig) => void;
    onCancel: () => void;
  }

  let { header, onSave, onCancel }: Props = $props();

  let showLeft = $state(header?.showLeft !== false);
  let showCenter = $state(header?.showCenter !== false);
  let leftText = $state(header?.leftText || '');
  let centerTitle = $state(header?.centerTitle || '');

  function handleSave() {
    onSave({
      showLeft,
      showCenter,
      leftText: leftText.trim() || undefined,
      centerTitle: centerTitle.trim() || undefined
    });
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      onCancel();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="modal-backdrop" onclick={onCancel}>
  <div class="modal-content" onclick={(e) => e.stopPropagation()}>
    <div class="modal-header">
      <h2>Configure Header</h2>
      <button class="close-btn" onclick={onCancel}>
        <Icon icon="mdi:close" width="24" />
      </button>
    </div>

    <form onsubmit={(e) => { e.preventDefault(); handleSave(); }}>
      <div class="section">
        <h3>Left Section</h3>
        <div class="form-group checkbox-group">
          <label>
            <input type="checkbox" bind:checked={showLeft} />
            Show left section
          </label>
        </div>
        {#if showLeft}
          <div class="form-group">
            <label for="leftText">Custom Text (optional)</label>
            <input
              id="leftText"
              type="text"
              bind:value={leftText}
              placeholder="Leave empty for default logo & links"
            />
            <small>If empty, shows HOPS logo and dashboard links</small>
          </div>
        {/if}
      </div>

      <div class="section">
        <h3>Center Section</h3>
        <div class="form-group checkbox-group">
          <label>
            <input type="checkbox" bind:checked={showCenter} />
            Show center title
          </label>
        </div>
        {#if showCenter}
          <div class="form-group">
            <label for="centerTitle">Custom Title (optional)</label>
            <input
              id="centerTitle"
              type="text"
              bind:value={centerTitle}
              placeholder="Leave empty for dashboard name"
            />
            <small>If empty, shows the current dashboard name</small>
          </div>
        {/if}
      </div>

      <div class="info-box">
        <Icon icon="mdi:information" width="20" />
        <div>
          <strong>Right Section (Fixed)</strong>
          <p>Theme toggle, edit mode, and admin link always visible</p>
        </div>
      </div>

      <div class="modal-actions">
        <button type="button" class="btn-secondary" onclick={onCancel}>
          Cancel
        </button>
        <button type="submit" class="btn-primary">
          <Icon icon="mdi:content-save" width="20" />
          Save
        </button>
      </div>
    </form>
  </div>
</div>

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 1rem;
  }

  .modal-content {
    background: var(--bg-primary);
    border-radius: 0.75rem;
    width: 100%;
    max-width: 500px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
    max-height: 90vh;
    overflow-y: auto;
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1.5rem;
    border-bottom: 1px solid var(--border);
    position: sticky;
    top: 0;
    background: var(--bg-primary);
    z-index: 1;
  }

  .modal-header h2 {
    margin: 0;
    font-size: 1.5rem;
  }

  .close-btn {
    background: none;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    padding: 0.5rem;
    border-radius: 0.375rem;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .close-btn:hover {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }

  form {
    padding: 1.5rem;
  }

  .section {
    margin-bottom: 2rem;
    padding-bottom: 1.5rem;
    border-bottom: 1px solid var(--border);
  }

  .section:last-of-type {
    border-bottom: none;
  }

  .section h3 {
    margin: 0 0 1rem 0;
    font-size: 1.125rem;
    color: var(--text-primary);
  }

  .form-group {
    margin-bottom: 1rem;
  }

  .form-group:last-child {
    margin-bottom: 0;
  }

  label {
    display: block;
    font-weight: 500;
    font-size: 0.875rem;
    color: var(--text-primary);
    margin-bottom: 0.5rem;
  }

  .checkbox-group label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    cursor: pointer;
  }

  .checkbox-group input[type="checkbox"] {
    cursor: pointer;
  }

  input[type="text"] {
    width: 100%;
    padding: 0.75rem;
    border: 1px solid var(--border);
    border-radius: 0.375rem;
    background: var(--bg-secondary);
    color: var(--text-primary);
    font-size: 1rem;
  }

  input[type="text"]:focus {
    outline: none;
    border-color: var(--accent);
  }

  small {
    display: block;
    margin-top: 0.25rem;
    font-size: 0.75rem;
    color: var(--text-secondary);
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

  .info-box strong {
    display: block;
    margin-bottom: 0.25rem;
    color: var(--text-primary);
  }

  .info-box p {
    margin: 0;
    font-size: 0.875rem;
    color: var(--text-secondary);
  }

  .modal-actions {
    display: flex;
    gap: 0.75rem;
    justify-content: flex-end;
  }

  button {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.625rem 1.25rem;
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

  .btn-primary:hover {
    background: #2563eb;
  }

  .btn-secondary {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }

  .btn-secondary:hover {
    background: var(--bg-secondary);
  }
</style>
