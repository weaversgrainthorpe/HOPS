<script lang="ts">
  interface Props {
    opacity?: number;
    onSelect: (opacity: number | undefined) => void;
  }

  let { opacity, onSelect }: Props = $props();

  // Convert opacity (0-1) to percentage (0-100)
  // svelte-ignore state_referenced_locally
  let opacityPercent = $state((opacity ?? 0.95) * 100);

  $effect(() => {
    opacityPercent = (opacity ?? 0.95) * 100;
  });

  function handleChange(e: Event) {
    const value = parseInt((e.target as HTMLInputElement).value);
    opacityPercent = value;
    onSelect(value / 100);
  }

  function handleReset() {
    opacityPercent = 95;
    onSelect(undefined);
  }
</script>

<div class="opacity-slider">
  <div class="opacity-header">
    <label for="opacity">Opacity: {Math.round(opacityPercent)}%</label>
    <button type="button" class="reset-btn" onclick={handleReset} title="Reset to default">
      Reset
    </button>
  </div>
  <input
    id="opacity"
    type="range"
    min="0"
    max="100"
    value={opacityPercent}
    oninput={handleChange}
    class="slider"
  />
  <div class="opacity-labels">
    <span>Transparent</span>
    <span>Opaque</span>
  </div>
</div>

<style>
  .opacity-slider {
    margin-bottom: 1rem;
  }

  .opacity-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.5rem;
  }

  label {
    font-weight: 500;
    font-size: 0.875rem;
    color: var(--text-primary);
  }

  .reset-btn {
    background: none;
    border: none;
    color: var(--accent);
    font-size: 0.75rem;
    cursor: pointer;
    padding: 0.25rem 0.5rem;
    border-radius: 0.25rem;
    transition: background 0.2s;
  }

  .reset-btn:hover {
    background: var(--bg-tertiary);
  }

  .slider {
    width: 100%;
    height: 6px;
    border-radius: 3px;
    background: linear-gradient(to right,
      rgba(var(--accent-rgb, 59, 130, 246), 0.2),
      rgba(var(--accent-rgb, 59, 130, 246), 1)
    );
    outline: none;
    -webkit-appearance: none;
    appearance: none;
  }

  .slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: white;
    border: 3px solid var(--accent);
    cursor: pointer;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
  }

  .slider::-webkit-slider-thumb:hover {
    transform: scale(1.1);
  }

  .slider::-moz-range-thumb {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: white;
    cursor: pointer;
    border: 3px solid var(--accent);
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
  }

  .slider::-moz-range-thumb:hover {
    transform: scale(1.1);
  }

  .opacity-labels {
    display: flex;
    justify-content: space-between;
    font-size: 0.75rem;
    color: var(--text-secondary);
    margin-top: 0.25rem;
  }
</style>
