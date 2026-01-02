<script lang="ts">
  import Icon from '@iconify/svelte';
  import { ICON_PRESETS, ICON_CATEGORIES } from '$lib/constants/iconPresets';

  interface Props {
    currentIcon?: string;
    onSelect: (iconName: string) => void;
    onCancel: () => void;
  }

  let { currentIcon, onSelect, onCancel }: Props = $props();

  let selectedCategory = $state('containers');
  let searchQuery = $state('');

  const categoryPresets = $derived(
    ICON_PRESETS.filter(p => p.category === selectedCategory)
  );

  const filteredIcons = $derived(
    searchQuery.trim()
      ? ICON_PRESETS.filter(p =>
          p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          p.id.toLowerCase().includes(searchQuery.toLowerCase())
        )
      : categoryPresets
  );

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      onCancel();
    }
  }

  function handleSelectIcon(icon: string) {
    onSelect(icon);
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="modal-backdrop" onclick={onCancel}>
  <div class="modal-content" onclick={(e) => e.stopPropagation()}>
    <div class="modal-header">
      <h2>Choose an Icon</h2>
      <button class="close-btn" onclick={onCancel}>
        <Icon icon="mdi:close" width="24" />
      </button>
    </div>

    <div class="modal-body">
      <!-- Search Bar -->
      <div class="search-bar">
        <Icon icon="mdi:magnify" width="20" />
        <input
          type="text"
          bind:value={searchQuery}
          placeholder="Search icons..."
          class="search-input"
        />
      </div>

      <!-- Category Tabs (hidden when searching) -->
      {#if !searchQuery.trim()}
        <div class="category-tabs">
          {#each ICON_CATEGORIES as category}
            <button
              class="category-tab"
              class:active={selectedCategory === category.id}
              onclick={() => selectedCategory = category.id}
            >
              <Icon icon={category.icon} width="20" />
              <span>{category.name}</span>
            </button>
          {/each}
        </div>
      {/if}

      <!-- Icon Grid -->
      <div class="icon-grid">
        {#each filteredIcons as preset}
          <button
            class="icon-card"
            class:selected={currentIcon === preset.icon}
            onclick={() => handleSelectIcon(preset.icon)}
            title={preset.name}
          >
            <div class="icon-preview">
              <Icon icon={preset.icon} width="48" />
            </div>
            <div class="icon-name">{preset.name}</div>
          </button>
        {/each}
      </div>

      {#if filteredIcons.length === 0}
        <div class="empty-message">
          No icons found matching "{searchQuery}"
        </div>
      {/if}
    </div>

    <div class="modal-footer">
      <button class="btn-secondary" onclick={onCancel}>Cancel</button>
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
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 1rem;
  }

  .modal-content {
    background: var(--bg-secondary);
    border-radius: 0.75rem;
    width: 100%;
    max-width: 900px;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1.5rem;
    border-bottom: 1px solid var(--border);
  }

  .modal-header h2 {
    font-size: 1.5rem;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
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
    flex: 1;
    overflow-y: auto;
    padding: 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .search-bar {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem 1rem;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    color: var(--text-secondary);
  }

  .search-input {
    flex: 1;
    background: none;
    border: none;
    color: var(--text-primary);
    font-size: 1rem;
    outline: none;
  }

  .search-input::placeholder {
    color: var(--text-secondary);
  }

  .category-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid var(--border);
  }

  .category-tab {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 1rem;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.2s;
    font-size: 0.875rem;
    font-weight: 500;
  }

  .category-tab:hover {
    background: var(--bg-primary);
    border-color: var(--accent);
    color: var(--text-primary);
  }

  .category-tab.active {
    background: var(--accent);
    border-color: var(--accent);
    color: white;
  }

  .icon-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 1rem;
  }

  .icon-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    padding: 1rem;
    background: var(--bg-tertiary);
    border: 2px solid var(--border);
    border-radius: 0.5rem;
    cursor: pointer;
    transition: all 0.2s;
    text-align: center;
  }

  .icon-card:hover {
    background: var(--bg-primary);
    border-color: var(--accent);
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  }

  .icon-card.selected {
    background: var(--accent);
    border-color: var(--accent);
    color: white;
  }

  .icon-preview {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--accent);
  }

  .icon-card.selected .icon-preview {
    color: white;
  }

  .icon-name {
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--text-secondary);
    word-break: break-word;
  }

  .icon-card.selected .icon-name {
    color: white;
  }

  .empty-message {
    text-align: center;
    padding: 3rem;
    color: var(--text-secondary);
    font-size: 0.875rem;
  }

  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 1rem;
    padding: 1.5rem;
    border-top: 1px solid var(--border);
  }

  .btn-secondary {
    padding: 0.75rem 1.5rem;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    color: var(--text-primary);
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
  }

  .btn-secondary:hover {
    background: var(--bg-primary);
    border-color: var(--accent);
  }
</style>
