<script lang="ts">
  /**
   * The dashboard header's form (the dashboard dialog's Header section, walkthrough §4C).
   * The parent reads the result with `value()` on Save.
   */
  import Icon from '@iconify/svelte';
  import type { HeaderConfig } from '$lib/types';

  interface Props {
    header?: HeaderConfig;
  }

  let { header }: Props = $props();

  // Form state initialized from props (intentionally captures initial values)
  // svelte-ignore state_referenced_locally
  let showLeft = $state(header?.showLeft !== false);
  // svelte-ignore state_referenced_locally
  let showCenter = $state(header?.showCenter !== false);
  // svelte-ignore state_referenced_locally
  let leftText = $state(header?.leftText || '');
  // svelte-ignore state_referenced_locally
  let centerTitle = $state(header?.centerTitle || '');
  // svelte-ignore state_referenced_locally
  const initial = { showLeft, showCenter, leftText, centerTitle };

  /** The header the form describes; the stored one, untouched, when nothing was changed. */
  export function value(): HeaderConfig | undefined {
    if (
      showLeft === initial.showLeft && showCenter === initial.showCenter &&
      leftText === initial.leftText && centerTitle === initial.centerTitle
    ) {
      return header;
    }
    return {
      showLeft,
      showCenter,
      leftText: leftText.trim() || undefined,
      centerTitle: centerTitle.trim() || undefined
    };
  }
</script>

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
    <p>Text size controls, theme toggle, edit mode, help, about, and admin link always visible</p>
  </div>
</div>

<style>
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
</style>
