<script lang="ts">
  import type { Entry } from '$lib/types';
  import Icon from '@iconify/svelte';

  let { entry }: { entry: Entry } = $props();

  function handleClick() {
    switch (entry.openMode) {
      case 'newtab':
        window.open(entry.url, '_blank');
        break;
      case 'sametab':
        window.location.href = entry.url;
        break;
      case 'iframe':
        // TODO: Open in modal iframe
        window.open(entry.url, '_blank');
        break;
      case 'modal':
        // TODO: Open in popup modal
        window.open(entry.url, '_blank');
        break;
    }
  }

  // Get size classes
  const sizeClass = entry.size || 'medium';
</script>

<button class="entry {sizeClass}" onclick={handleClick} title={entry.description || entry.name}>
  <div class="icon">
    {#if entry.iconUrl}
      <img src={entry.iconUrl} alt={entry.name} />
    {:else if entry.icon}
      <Icon icon={entry.icon} width="48" />
    {:else}
      <Icon icon="mdi:application" width="48" />
    {/if}
  </div>

  <div class="name">{entry.name}</div>

  {#if entry.statusCheck?.enabled}
    <div class="status-indicator">
      <span class="status-dot unknown" title="Status check pending"></span>
    </div>
  {/if}
</button>

<style>
  .entry {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    padding: 1.5rem;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 0.75rem;
    cursor: pointer;
    transition: all 0.2s;
    text-decoration: none;
    color: var(--text-primary);
    position: relative;
    min-height: 120px;
  }

  .entry:hover {
    background: var(--bg-tertiary);
    border-color: var(--accent);
    transform: translateY(-2px);
    box-shadow: 0 4px 12px var(--shadow);
  }

  .icon {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--accent);
  }

  .icon img {
    width: 48px;
    height: 48px;
    object-fit: contain;
  }

  .name {
    font-weight: 500;
    text-align: center;
    font-size: 0.9rem;
  }

  .status-indicator {
    position: absolute;
    top: 0.5rem;
    right: 0.5rem;
  }

  .status-dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }

  .status-dot.online {
    background: #10b981;
  }

  .status-dot.offline {
    background: #ef4444;
  }

  .status-dot.unknown {
    background: #6b7280;
  }

  /* Size variants */
  .small {
    min-height: 80px;
    padding: 1rem;
  }

  .small .icon {
    font-size: 32px;
  }

  .small .name {
    font-size: 0.8rem;
  }

  .medium {
    min-height: 120px;
  }

  .large {
    min-height: 160px;
    padding: 2rem;
  }

  .large .icon {
    font-size: 64px;
  }

  .large .name {
    font-size: 1.1rem;
  }
</style>
