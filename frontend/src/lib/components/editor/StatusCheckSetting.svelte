<script lang="ts">
  // The "Status checks" row of the tile, folder and tab dialogs: Inherit / On /
  // Off, plus one line saying where the effective value comes from and what this level does to
  // it. The value is the dialog's own state (draft-only: it is saved with the dialog, one undo
  // step; Cancel discards it).
  import {
    contextNameOf, resolveStatusChecks, statusRowText, type LevelSetting, type StatusContext
  } from '$lib/editor/statusChecks';
  import { statusBaseFor, refreshStatusBase, type BaseState } from '$lib/stores/statusCheckBase';

  interface Props {
    level: 'tile' | 'folder' | 'tab';
    /** This level's setting. A tile with no setting is 'inherit', like a folder. */
    value: LevelSetting;
    /** The levels above; without it the row can only say it cannot tell. */
    context?: StatusContext;
  }
  let { level, value = $bindable(), context }: Props = $props();

  const uid = `status-checks-${Math.random().toString(36).slice(2, 9)}`;
  const choice = $derived(value === 'invalid' ? null : value);

  function pick(v: 'inherit' | 'on' | 'off') {
    value = v;
  }

  // What this level would get by inheriting, without the dashboard level first.
  const local = $derived(
    context ? resolveStatusChecks(null, context.tab, context.folders, null) : null
  );
  const needsParent = $derived(value === 'inherit' || value === 'on' || value === 'off');
  const needsBase = $derived(!!context && needsParent && local === null);

  let baseState = $state<BaseState | null>(null);
  $effect(() => {
    if (!needsBase || !context) {
      baseState = null;
      return;
    }
    return statusBaseFor(context.dashboardId).subscribe((s) => (baseState = s));
  });

  const parent = $derived.by(() => {
    if (!context) return null;
    if (local) return local;
    return baseState?.state === 'ok' ? resolveStatusChecks(baseState.base, context.tab, context.folders, null) : null;
  });
  const row = $derived(
    !context && needsParent
      ? { text: "Can't tell what this inherits here.", tone: 'warn' as const }
      : statusRowText(value, parent, context ? contextNameOf(context) : () => '')
  );
  const baseError = $derived(needsBase && baseState?.state === 'error' ? baseState.message : null);
</script>

<fieldset class="status-checks" data-level={level}>
  <legend>Status checks</legend>
  <div class="choices">
    {#each [['inherit', 'Inherit'], ['on', 'On'], ['off', 'Off']] as [v, label] (v)}
      <label class="choice">
        <input
          type="radio"
          name={uid}
          value={v}
          checked={choice === v}
          onchange={() => pick(v as 'inherit' | 'on' | 'off')}
        />
        {label}
      </label>
    {/each}
    <button
      type="button"
      class="reset-btn"
      disabled={value === 'inherit'}
      onclick={() => pick('inherit')}
    >
      Reset to inherit
    </button>
  </div>
  {#if baseError}
    <p class="row-text warn" role="alert">
      Couldn't check this dashboard's status-check setting: {baseError}
      <button type="button" class="retry-btn" onclick={() => context && refreshStatusBase(context.dashboardId)}>
        Retry
      </button>
    </p>
  {:else}
    <p class="row-text" class:warn={row.tone === 'warn'} class:pending={row.tone === 'pending'} aria-live="polite">
      {row.text}
    </p>
  {/if}
</fieldset>

<style>
  .status-checks {
    border: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  legend {
    font-weight: 500;
    font-size: 0.875rem;
    color: var(--text-primary);
    padding: 0;
    margin-bottom: 0.4rem;
  }
  .choices {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.9rem;
  }
  .choice {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.875rem;
    color: var(--text-primary);
    cursor: pointer;
  }
  .reset-btn,
  .retry-btn {
    margin-left: auto;
    background: none;
    border: 1px solid var(--border);
    color: var(--text-secondary);
    border-radius: 0.375rem;
    padding: 0.25rem 0.6rem;
    font-size: 0.8rem;
    cursor: pointer;
  }
  .retry-btn {
    margin-left: 0.5rem;
  }
  /* Disabled stays readable (text >= 4.5:1): no fading — a dashed edge says it is off. */
  .reset-btn:disabled {
    opacity: 1;
    border-style: dashed;
    cursor: default;
  }
  .row-text {
    margin: 0;
    color: var(--text-secondary);
    font-size: 0.85rem;
  }
  .row-text.pending {
    font-style: italic;
  }
  .row-text.warn {
    color: var(--warning, #b45309);
  }
</style>
