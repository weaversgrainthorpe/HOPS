<script lang="ts">
  interface Props {
    selectedColor?: string;
    onSelect: (color: string | undefined) => void;
  }

  let { selectedColor, onSelect }: Props = $props();

  const colorPalette = [
    { name: 'Red', value: '#ef4444' },
    { name: 'Orange', value: '#f97316' },
    { name: 'Amber', value: '#f59e0b' },
    { name: 'Yellow', value: '#eab308' },
    { name: 'Lime', value: '#84cc16' },
    { name: 'Green', value: '#22c55e' },
    { name: 'Emerald', value: '#10b981' },
    { name: 'Teal', value: '#14b8a6' },
    { name: 'Cyan', value: '#06b6d4' },
    { name: 'Sky', value: '#0ea5e9' },
    { name: 'Blue', value: '#3b82f6' },
    { name: 'Indigo', value: '#6366f1' },
    { name: 'Violet', value: '#8b5cf6' },
    { name: 'Purple', value: '#a855f7' },
    { name: 'Fuchsia', value: '#d946ef' },
    { name: 'Pink', value: '#ec4899' },
    { name: 'Rose', value: '#f43f5e' },
    { name: 'Slate', value: '#64748b' },
  ];
</script>

<div class="color-picker">
  <div class="color-label">Background Color</div>
  <div class="color-grid">
    <button
      type="button"
      class="color-swatch none"
      class:selected={!selectedColor}
      onclick={() => onSelect(undefined)}
      title="None (use theme default)"
    >
      <span class="none-icon">—</span>
    </button>
    {#each colorPalette as color}
      <button
        type="button"
        class="color-swatch"
        class:selected={selectedColor === color.value}
        style:background-color={color.value}
        onclick={() => onSelect(color.value)}
        title={color.name}
      >
      </button>
    {/each}
  </div>
</div>

<style>
  .color-picker {
    margin-bottom: 1rem;
  }

  .color-label {
    font-weight: 500;
    font-size: 0.875rem;
    color: var(--text-primary);
    margin-bottom: 0.5rem;
  }

  .color-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(2.5rem, 1fr));
    gap: 0.5rem;
  }

  .color-swatch {
    width: 2.5rem;
    height: 2.5rem;
    border-radius: 0.375rem;
    border: 2px solid transparent;
    cursor: pointer;
    transition: all 0.2s;
    position: relative;
  }

  .color-swatch.none {
    background: var(--bg-tertiary);
    border: 2px dashed var(--border);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .none-icon {
    color: var(--text-secondary);
    font-size: 1.25rem;
    font-weight: bold;
  }

  .color-swatch:hover {
    transform: scale(1.1);
    border-color: var(--text-secondary);
  }

  .color-swatch.selected {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--bg-primary), 0 0 0 4px var(--accent);
  }

  .color-swatch.none.selected {
    border-style: solid;
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--bg-primary), 0 0 0 4px var(--accent);
  }
</style>
