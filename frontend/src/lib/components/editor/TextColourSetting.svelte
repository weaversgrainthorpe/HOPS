<script lang="ts">
  /**
   * The Text colour choice (Auto / Light / Dark), the same control on the tile and the folder dialog.
   * Auto is the one rule (the more readable of white and black). `contrast` is the contrast of an
   * explicit choice that is hard to read on the colour, or null: the warning is shown only then (never
   * for Auto, and never where there is no fill to measure against).
   */
  import { MIN_TEXT_CONTRAST, type TextColorMode } from '$lib/utils/colorContrast';

  interface Props {
    value: TextColorMode;
    /** The radio group's name (unique per dialog). */
    name: string;
    contrast?: number | null;
  }
  let { value = $bindable(), name, contrast = null }: Props = $props();
  const CHOICES: [TextColorMode, string][] = [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']];
</script>

<fieldset class="text-colour" data-text-colour>
  <legend>Text colour</legend>
  <div class="choice-row">
    {#each CHOICES as [v, label] (v)}
      <label class="choice">
        <input type="radio" {name} value={v} bind:group={value} />
        {label}
      </label>
    {/each}
  </div>
  {#if contrast !== null && Number.isFinite(contrast) && value !== 'auto'}
    <p class="problem" role="status" data-contrast-warning>
      {value === 'light' ? 'Light' : 'Dark'} text is hard to read on this colour (contrast {contrast.toFixed(1)}:1,
      needs {MIN_TEXT_CONTRAST}:1). Choose Auto or another colour.
    </p>
  {/if}
</fieldset>

<style>
  .text-colour {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin: 0 0 1.25rem;
    border: none;
    padding: 0;
    min-width: 0;
  }
  legend {
    font-weight: 500;
    font-size: 0.875rem;
    color: var(--text-primary);
    padding: 0;
    margin-bottom: 0.5rem;
  }
  .choice-row {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
  }
  .choice {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font-weight: 400;
    font-size: 0.875rem;
    color: var(--text-primary);
  }
  /* On every preset, light and dark, the error text token reaches 4.5:1. */
  .problem {
    margin: 0;
    color: var(--color-error-text);
    font-size: 0.875rem;
  }
</style>
