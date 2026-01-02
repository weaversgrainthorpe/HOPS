<script lang="ts">
  import Icon from '@iconify/svelte';
  import ColorPicker from './ColorPicker.svelte';
  import OpacitySlider from './OpacitySlider.svelte';

  interface Props {
    groupName: string;
    groupColor?: string;
    groupOpacity?: number;
    groupTextColor?: 'auto' | 'light' | 'dark';
    onSave: (name: string, color?: string, opacity?: number, textColor?: 'auto' | 'light' | 'dark') => void;
    onCancel: () => void;
    onDelete?: () => void;
  }

  let { groupName, groupColor, groupOpacity, groupTextColor, onSave, onCancel, onDelete }: Props = $props();
  let name = $state(groupName);
  let color = $state(groupColor);
  let opacity = $state(groupOpacity);
  let textColor = $state<'auto' | 'light' | 'dark'>(groupTextColor || 'auto');

  function handleSave() {
    if (name.trim()) {
      onSave(name.trim(), color, opacity, textColor);
    }
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
      <h2>{groupName ? 'Edit Group' : 'New Group'}</h2>
      <button class="close-btn" onclick={onCancel}>
        <Icon icon="mdi:close" width="24" />
      </button>
    </div>

    <form onsubmit={(e) => { e.preventDefault(); handleSave(); }}>
      <div class="form-group">
        <label for="name">Group Name *</label>
        <input
          id="name"
          type="text"
          bind:value={name}
          required
          placeholder="e.g., Services, Media, Tools"
          autofocus
        />
      </div>

      <ColorPicker
        selectedColor={color}
        onSelect={(c) => color = c}
      />

      <OpacitySlider
        opacity={opacity}
        onSelect={(o) => opacity = o}
      />

      <div class="form-group">
        <label>Text Color</label>
        <div class="text-color-options">
          <button
            type="button"
            class="text-color-btn"
            class:active={textColor === 'auto'}
            onclick={() => textColor = 'auto'}
          >
            <Icon icon="mdi:auto-fix" width="20" />
            Auto
          </button>
          <button
            type="button"
            class="text-color-btn"
            class:active={textColor === 'light'}
            onclick={() => textColor = 'light'}
          >
            <Icon icon="mdi:weather-sunny" width="20" />
            Light
          </button>
          <button
            type="button"
            class="text-color-btn"
            class:active={textColor === 'dark'}
            onclick={() => textColor = 'dark'}
          >
            <Icon icon="mdi:weather-night" width="20" />
            Dark
          </button>
        </div>
        <small>Auto determines text color based on background</small>
      </div>

      <div class="modal-actions">
        {#if groupName && onDelete}
          <button type="button" class="btn-danger" onclick={onDelete}>
            <Icon icon="mdi:delete" width="20" />
            Delete
          </button>
        {/if}
        <div class="actions-right">
          <button type="button" class="btn-secondary" onclick={onCancel}>
            Cancel
          </button>
          <button type="submit" class="btn-primary">
            <Icon icon="mdi:content-save" width="20" />
            {groupName ? 'Save' : 'Create'}
          </button>
        </div>
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
    max-width: 400px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1.5rem;
    border-bottom: 1px solid var(--border);
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

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-bottom: 1.5rem;
  }

  label {
    font-weight: 500;
    font-size: 0.875rem;
    color: var(--text-primary);
  }

  input[type="text"] {
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

  .modal-actions {
    display: flex;
    gap: 0.75rem;
    justify-content: space-between;
    align-items: center;
  }

  .actions-right {
    display: flex;
    gap: 0.75rem;
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

  .btn-danger {
    background: #dc2626;
    color: white;
  }

  .btn-danger:hover {
    background: #b91c1c;
  }

  .text-color-options {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.5rem;
  }

  .text-color-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 0.75rem;
    background: var(--bg-tertiary);
    border: 2px solid var(--border);
    border-radius: 0.5rem;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.2s;
    font-size: 0.875rem;
    font-weight: 500;
  }

  .text-color-btn:hover {
    background: var(--bg-primary);
    border-color: var(--accent);
    color: var(--text-primary);
  }

  .text-color-btn.active {
    background: var(--accent);
    border-color: var(--accent);
    color: white;
  }
</style>
