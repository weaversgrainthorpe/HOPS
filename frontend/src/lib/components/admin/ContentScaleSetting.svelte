<script lang="ts">
  /**
   * The dashboard's "Tile content size" (the dashboard dialog's Settings section): how big the icon,
   * name and description are drawn inside every tile and minimised folder on this dashboard. Tiles,
   * folders and the grid keep their size. Like the Header and Background, it goes to the draft on the
   * dialog's Save (the parent reads `value()`), so the editor shows it at once and Save in the edit
   * toolbar stores it; Cancel discards it.
   */
  import { CONTENT_SCALE, contentScaleOf, contentScaleProblem } from '$lib/layout/contentScale';

  interface Props {
    /** The dashboard's stored contentScale (missing = 100%). */
    stored?: unknown;
  }

  let { stored }: Props = $props();
  const uid = $props.id();

  // svelte-ignore state_referenced_locally
  const problem = contentScaleProblem(stored);
  // svelte-ignore state_referenced_locally
  const initial = contentScaleOf(stored);
  let scale = $state(initial);

  /**
   * The value to write, or undefined to leave the dashboard as it is (unchanged). A stored value the
   * server would refuse is replaced by what the slider shows, so a Save fixes it.
   */
  export function value(): number | undefined {
    if (problem) return scale;
    return scale === initial ? undefined : scale;
  }
</script>

<div class="row scale-row">
  <div class="row-head">
    <label class="row-label" for="{uid}-range">Tile content size</label>
    <!-- Shown, not announced: the slider's own value text says it. -->
    <output for="{uid}-range" class="readout" aria-hidden="true">{scale}%</output>
  </div>
  <p class="hint" id="{uid}-hint">
    Makes the icon, name and description inside every tile and minimised folder on this dashboard bigger or
    smaller. Tiles and folders stay the same size. Small tiles change least: their text is already at its
    smallest readable size.
  </p>
  <div class="row-body">
    <span class="end" aria-hidden="true">{CONTENT_SCALE.min}%</span>
    <input
      id="{uid}-range"
      type="range"
      min={CONTENT_SCALE.min}
      max={CONTENT_SCALE.max}
      step={CONTENT_SCALE.step}
      value={scale}
      aria-valuetext={`${scale}%`}
      aria-describedby="{uid}-hint"
      oninput={(e) => (scale = contentScaleOf(Number(e.currentTarget.value)))}
    />
    <span class="end" aria-hidden="true">{CONTENT_SCALE.max}%</span>
    <button
      type="button"
      class="reset-btn"
      disabled={scale === CONTENT_SCALE.normal}
      onclick={() => (scale = CONTENT_SCALE.normal)}
    >
      Reset to 100%
    </button>
  </div>
  {#if problem}
    <p class="row-warning" role="status">
      This dashboard's tile content size ({String(stored)}) can't be used, so it's drawn at 100%. Save to store
      the size shown here.
    </p>
  {/if}
</div>

<style>
  .row { padding: 0 0 0.75rem; border-bottom: 1px solid var(--border); }
  .row-head { display: flex; justify-content: space-between; align-items: center; gap: 1rem; }
  .row-label { font-weight: 500; color: var(--text-primary); }
  .readout { font-variant-numeric: tabular-nums; font-weight: 600; color: var(--text-primary); }
  .hint { color: var(--text-secondary); font-size: 0.875rem; margin: 0.25rem 0 0; }
  .row-body { display: flex; align-items: center; gap: 0.75rem; margin-top: 0.5rem; min-height: 2rem; flex-wrap: wrap; }
  .row-body input[type='range'] { flex: 1; min-width: 8rem; accent-color: var(--accent); }
  .end { color: var(--text-secondary); font-size: 0.8rem; font-variant-numeric: tabular-nums; }
  .reset-btn {
    background: none;
    border: 1px solid var(--border);
    color: var(--text-secondary);
    border-radius: 0.375rem;
    padding: 0.25rem 0.6rem;
    font-size: 0.8rem;
    cursor: pointer;
  }
  .reset-btn:disabled { opacity: 0.4; cursor: default; }
  .row-warning {
    margin: 0.5rem 0 0;
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--warning-solid, #b45309);
    border-radius: 0.375rem;
    color: var(--text-primary);
    font-size: 0.85rem;
  }
</style>
