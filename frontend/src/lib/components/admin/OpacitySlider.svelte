<script lang="ts">
  interface Props {
    opacity?: number;
    onSelect: (opacity: number | undefined) => void;
    /** Visible label (default "Opacity"). */
    label?: string;
    /** Input id; must be unique when several sliders share a dialog. */
    id?: string;
    /** The value shown for an unset field and restored by Reset, 0–1 (default 0.95). */
    defaultValue?: number;
  }

  let { opacity, onSelect, label = 'Opacity', id = 'opacity', defaultValue = 0.95 }: Props = $props();

  // A stored value is shown clamped to 0–1; anything non-numeric shows the default.
  const toPercent = (o: number | undefined) =>
    (typeof o === 'number' && Number.isFinite(o) ? Math.min(1, Math.max(0, o)) : defaultValue) * 100;

  // Convert opacity (0-1) to percentage (0-100)
  // svelte-ignore state_referenced_locally
  let opacityPercent = $state(toPercent(opacity));

  $effect(() => {
    opacityPercent = toPercent(opacity);
  });

  function handleChange(e: Event) {
    const value = parseInt((e.target as HTMLInputElement).value);
    opacityPercent = value;
    onSelect(value / 100);
  }

  function handleReset() {
    opacityPercent = defaultValue * 100;
    onSelect(undefined);
  }
</script>

<div class="opacity-slider">
  <div class="opacity-header">
    <label for={id}>{label}: {Math.round(opacityPercent)}%</label>
    <button type="button" class="reset-btn" onclick={handleReset} title="Reset to default">
      Reset
    </button>
  </div>
  <input
    {id}
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
    /* Readable link text (>= 4.5:1) in both themes; the plain accent is 3.4–4:1. */
    color: #93c5fd;
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
  :global([data-theme='light']) .reset-btn {
    color: #1d4ed8;
  }
</style>
