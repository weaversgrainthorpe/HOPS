<script lang="ts">
  // The status-check row of the tile, folder, tab and dashboard dialogs. A tile is On or Off; a
  // dashboard, tab or folder is a gate, Enabled or Disabled, for every tile inside it. The row
  // says when a Disabled gate above stops this one (or the tile) having any effect. The value is
  // the dialog's own state (saved with the dialog; Cancel discards it).
  import {
    contextGateName, gatePlace, gatesAbove, type Block, type GateSetting, type StatusContext, type TileSetting
  } from '$lib/editor/statusChecks';
  import { statusBaseFor, refreshStatusBase, type BaseState } from '$lib/stores/statusCheckBase';

  interface Props {
    level: 'tile' | 'folder' | 'tab' | 'dashboard';
    /** A tile's On / Off, or a gate's Enabled / Disabled ('invalid': a wrong-typed stored value). */
    value: TileSetting | GateSetting;
    /** The levels above; without it the row can't say whether a gate above stops this one. */
    context?: StatusContext;
  }
  let { level, value = $bindable(), context }: Props = $props();

  const uid = `status-checks-${Math.random().toString(36).slice(2, 9)}`;
  const isTile = $derived(level === 'tile');
  const choices = $derived<[string, string][]>(
    isTile ? [['on', 'On'], ['off', 'Off']] : [['enabled', 'Enabled'], ['disabled', 'Disabled']]
  );
  const legend = $derived(isTile ? 'Status check' : `Status checks for tiles in this ${level}`);

  // The tile row only needs the gates above while it is On; a gate row always says what is above it.
  const needsGates = $derived(!isTile || value === 'on');
  const local = $derived(
    context && needsGates ? gatesAbove(null, context.tab, context.folders, level === 'dashboard') : undefined
  );
  const needsBase = $derived(!!context && needsGates && local === undefined);

  let baseState = $state<BaseState | null>(null);
  $effect(() => {
    if (!needsBase || !context) {
      baseState = null;
      return;
    }
    return statusBaseFor(context.dashboardId).subscribe((s) => (baseState = s));
  });

  /** The gate above that stops this level: null = none, undefined = not known yet. */
  const block = $derived.by<Block | null | undefined>(() => {
    if (!context || !needsGates) return undefined;
    if (local !== undefined) return local;
    if (baseState?.state !== 'ok') return undefined;
    return gatesAbove(baseState.base, context.tab, context.folders, level === 'dashboard');
  });

  function blockText(b: Block): string {
    const name = context ? contextGateName(context, b) : undefined;
    if (b.source === 'invalid') {
      const where = name ?? 'a level above';
      return isTile
        ? `Not checked: invalid status-check setting on ${where}. Open it and choose Enabled or Disabled.`
        : `Invalid status-check setting on ${where}, so this setting has no effect. Open it and choose Enabled or Disabled.`;
    }
    const place = gatePlace(b.source, name);
    return isTile
      ? `Not checked: status monitoring is disabled ${place}`
      : `Status monitoring is disabled ${place}, so this setting has no effect`;
  }

  const baseError = $derived(needsBase && baseState?.state === 'error' ? baseState.message : null);
  const pending = $derived(!!context && needsGates && block === undefined && !baseError);
</script>

<fieldset class="status-checks" data-level={level}>
  <legend>{legend}</legend>
  <div class="choices">
    {#each choices as [v, label] (v)}
      <label class="choice">
        <input type="radio" name={uid} value={v} checked={value === v} onchange={() => (value = v as typeof value)} />
        {label}
      </label>
    {/each}
  </div>
  {#if value === 'invalid'}
    <p class="row-text warn" role="alert">
      {#if isTile}
        Invalid setting here: this tile is not checked. Choose On or Off to fix it.
      {:else if level === 'dashboard'}
        Invalid setting here: it is ignored (treated as Enabled). Choose Enabled or Disabled to fix it.
      {:else}
        Invalid setting here: no tile in this {level} is checked. Choose Enabled or Disabled to fix it.
      {/if}
    </p>
  {/if}
  {#if !isTile && value === 'disabled'}
    <p class="row-text" data-testid="status-gate-hint">No tile in this {level} is checked, whatever its own setting.</p>
  {/if}
  {#if baseError}
    <p class="row-text warn" role="alert">
      Couldn't check whether status monitoring is enabled above this {level}: {baseError}
      <button type="button" class="retry-btn" onclick={() => context && refreshStatusBase(context.dashboardId)}>
        Retry
      </button>
    </p>
  {:else if pending}
    <p class="row-text pending" aria-live="polite">Checking…</p>
  {:else if block}
    <p class="row-text warn" aria-live="polite" data-testid="status-blocked">{blockText(block)}</p>
  {:else if !context && needsGates}
    <p class="row-text warn">Can't tell whether status monitoring is enabled above this {level}.</p>
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
  .retry-btn {
    margin-left: 0.5rem;
    background: none;
    border: 1px solid var(--border);
    color: var(--text-secondary);
    border-radius: 0.375rem;
    padding: 0.25rem 0.6rem;
    font-size: 0.8rem;
    cursor: pointer;
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
