<script lang="ts">
  interface Props {
    selectedColor?: string;
    onSelect: (color: string | undefined) => void;
    /** Heading shown above the swatch grid. Defaults to "Background Color". */
    label?: string;
    /** Title for the "no colour" swatch. Defaults to "None (use theme default)". */
    noneTitle?: string;
  }

  let {
    selectedColor,
    onSelect,
    label = 'Background Color',
    noneTitle = 'None (use theme default)',
  }: Props = $props();

  // Preset palette. Order roughly follows the colour wheel, then ends with
  // greys + white so a user looking for a neutral lands at the right edge.
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
    { name: 'Black', value: '#000000' },
    { name: 'White', value: '#ffffff' },
  ];

  // A colour is "custom" when it's set but isn't one of the preset swatches.
  let isCustom = $derived(
    !!selectedColor && !colorPalette.some((c) => c.value.toLowerCase() === selectedColor!.toLowerCase()),
  );

  // The hex text input. Mirrors the current selection when it's custom; we
  // don't pre-fill it for preset swatches so the user knows it's empty until
  // they intentionally type something.
  let hexDraft = $state('');

  // Keep the hex draft in sync when the parent changes selectedColor (e.g.
  // user clicks a preset swatch — clear the draft so it's obvious the
  // custom field isn't driving the selection). Runs on mount too, which
  // populates the field for tiles already saved with a custom colour.
  $effect(() => {
    if (!isCustom) {
      hexDraft = '';
    } else if (selectedColor && hexDraft.toLowerCase() !== selectedColor.toLowerCase()) {
      hexDraft = selectedColor;
    }
  });

  // Accept #rgb / #rrggbb (with or without the leading hash). Returns the
  // expanded, lowercase 6-digit form, or null if invalid.
  function normaliseHex(input: string): string | null {
    let v = input.trim().toLowerCase();
    if (v.startsWith('#')) v = v.slice(1);
    if (/^[0-9a-f]{3}$/.test(v)) {
      v = v.split('').map((ch) => ch + ch).join('');
    }
    if (/^[0-9a-f]{6}$/.test(v)) return '#' + v;
    return null;
  }

  function handleNativePicker(e: Event) {
    const value = (e.target as HTMLInputElement).value;
    hexDraft = value;
    onSelect(value);
  }

  function handleHexInput(e: Event) {
    const raw = (e.target as HTMLInputElement).value;
    hexDraft = raw; // let the user keep typing even when intermediate is invalid
    const normalised = normaliseHex(raw);
    if (normalised) onSelect(normalised);
  }
</script>

<div class="color-picker">
  <div class="color-label">{label}</div>
  <div class="color-grid">
    <button
      type="button"
      class="color-swatch none"
      class:selected={!selectedColor}
      onclick={() => onSelect(undefined)}
      aria-label={noneTitle}
      aria-pressed={!selectedColor}
      title={noneTitle}
    >
      <span class="none-icon">—</span>
    </button>
    {#each colorPalette as color}
      <button
        type="button"
        class="color-swatch"
        class:selected={selectedColor?.toLowerCase() === color.value.toLowerCase()}
        class:bordered={color.value === '#ffffff' || color.value === '#000000'}
        style:background-color={color.value}
        onclick={() => onSelect(color.value)}
        aria-label={color.name}
        aria-pressed={selectedColor?.toLowerCase() === color.value.toLowerCase()}
        title={color.name}
      >
      </button>
    {/each}
  </div>

  <div class="custom-row">
    <label class="custom-picker-label" title="Pick any colour">
      <input
        type="color"
        class="custom-picker-input"
        value={isCustom ? selectedColor : '#888888'}
        onchange={handleNativePicker}
      />
      <span class="custom-picker-swatch" class:selected={isCustom} aria-hidden="true">
        <!-- Diagonal rainbow band hints "any colour you like" -->
        <span class="rainbow"></span>
      </span>
      <span class="custom-picker-text">Custom</span>
    </label>
    <input
      type="text"
      class="hex-input"
      placeholder="#rrggbb"
      maxlength="7"
      value={hexDraft}
      oninput={handleHexInput}
      spellcheck="false"
      autocomplete="off"
    />
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

  /* White needs a visible outline against the modal's dark background or
     it disappears entirely. */
  .color-swatch.bordered {
    border: 2px solid var(--border);
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

  .color-swatch.none.selected,
  .color-swatch.bordered.selected {
    border-style: solid;
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--bg-primary), 0 0 0 4px var(--accent);
  }

  /* Custom colour row */
  .custom-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-top: 0.75rem;
  }

  .custom-picker-label {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    cursor: pointer;
    color: var(--text-secondary);
    font-size: 0.875rem;
    user-select: none;
  }

  /* The real <input type="color"> sits invisible on top of our styled
     swatch — clicking the swatch opens the native picker. */
  .custom-picker-input {
    position: absolute;
    opacity: 0;
    width: 2.5rem;
    height: 2.5rem;
    cursor: pointer;
    margin: 0;
  }

  .custom-picker-swatch {
    position: relative;
    display: inline-block;
    width: 2.5rem;
    height: 2.5rem;
    border-radius: 0.375rem;
    border: 2px solid var(--border);
    overflow: hidden;
    transition: all 0.2s;
  }

  .custom-picker-swatch .rainbow {
    position: absolute;
    inset: 0;
    background: conic-gradient(
      from 0deg,
      #ef4444, #f59e0b, #eab308, #22c55e, #06b6d4,
      #3b82f6, #8b5cf6, #ec4899, #ef4444
    );
  }

  .custom-picker-label:hover .custom-picker-swatch {
    transform: scale(1.1);
    border-color: var(--text-secondary);
  }

  .custom-picker-swatch.selected {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--bg-primary), 0 0 0 4px var(--accent);
  }

  .custom-picker-text {
    font-size: 0.875rem;
  }

  .hex-input {
    flex: 1;
    max-width: 9rem;
    padding: 0.45rem 0.6rem;
    border: 1px solid var(--border);
    border-radius: 0.375rem;
    background: var(--bg-secondary);
    color: var(--text-primary);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.85rem;
  }

  .hex-input:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 2px rgba(79, 140, 255, 0.25);
  }
</style>
