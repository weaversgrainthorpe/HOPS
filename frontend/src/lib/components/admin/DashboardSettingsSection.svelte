<script lang="ts">
  /**
   * The dashboard's own settings (overrides of the global ones), the dashboard dialog's Settings
   * section (walkthrough §4C). They save to the server, not the draft: the dialog calls `save()`
   * first on its Save, and only a changed setting is sent.
   */
  import { onMount } from 'svelte';
  import type { DashboardSettings } from '$lib/types';
  import {
    getDashboardSettings,
    ConflictError,
    MigrationFailedError,
    type EffectiveDashboardSettings
  } from '$lib/utils/api';
  import { saveDashboardSettingsChanges, migrationFailure } from '$lib/stores/config';

  interface Props {
    dashboardId: string;
    /** Out: an overridden number field holds no valid number (the dialog disables Save). */
    invalid?: boolean;
    /** Out: the settings couldn't be loaded (the dialog marks the Settings section). */
    loadFailed?: boolean;
  }

  let { dashboardId, invalid = $bindable(false), loadFailed = $bindable(false) }: Props = $props();

  type Key = keyof DashboardSettings;
  type Value = string | number | boolean;
  type Kind = 'bool' | 'int';

  const ROWS: { key: Key; label: string; kind: Kind; min?: number }[] = [
    { key: 'statusChecksEnabled', label: 'Status checks', kind: 'bool' },
    { key: 'statusCheckIntervalMinutes', label: 'Check interval (minutes)', kind: 'int', min: 1 },
    { key: 'statusCheckTimeoutSeconds', label: 'Check timeout (seconds)', kind: 'int', min: 1 },
    { key: 'editIdleTimeoutMinutes', label: 'Edit mode idle timeout (minutes)', kind: 'int', min: 0 },
    { key: 'animatedFolderBackgrounds', label: 'Animated folder backgrounds', kind: 'bool' }
  ];

  let loading = $state(true);
  let loadError = $state<string | null>(null);
  let saveError = $state<string | null>(null);
  let saving = $state(false);

  let original = $state<DashboardSettings | null>(null);
  let effective = $state<EffectiveDashboardSettings | null>(null);
  let enabled = $state<Record<string, boolean>>({});
  let values = $state<Record<string, Value>>({});

  function normalize(kind: Kind, v: unknown): Value {
    if (kind === 'bool') return v === true || v === 'true';
    if (kind === 'int') return Number(v);
    return String(v);
  }

  async function load() {
    loading = true;
    loadError = null;
    try {
      const resp = await getDashboardSettings(dashboardId);
      original = resp.overrides;
      effective = resp.effective;
      const en: Record<string, boolean> = {};
      const vals: Record<string, Value> = {};
      for (const r of ROWS) {
        const o = resp.overrides[r.key];
        en[r.key] = o !== null && o !== undefined;
        vals[r.key] = normalize(r.kind, en[r.key] ? o : resp.effective[r.key]);
      }
      enabled = en;
      values = vals;
    } catch (e) {
      if (e instanceof MigrationFailedError) migrationFailure.set(e.detail);
      loadError = e instanceof Error ? e.message : 'Failed to load dashboard settings';
    } finally {
      loading = false;
    }
  }

  onMount(load);

  function display(kind: Kind, v: unknown): string {
    if (kind === 'bool') return v === true || v === 'true' ? 'On' : 'Off';
    return String(v);
  }

  // An overridden number field must hold a whole number >= its minimum.
  function rowProblem(r: { key: Key; kind: Kind; min?: number }): string | null {
    if (r.kind !== 'int' || !enabled[r.key]) return null;
    const v = values[r.key];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < (r.min ?? 0)) {
      return `Enter a whole number of at least ${r.min ?? 0}.`;
    }
    return null;
  }
  let hasInvalid = $derived(ROWS.some((r) => rowProblem(r) !== null));
  $effect(() => {
    invalid = hasInvalid;
  });
  $effect(() => {
    loadFailed = loadError !== null;
  });

  function toggle(key: Key, on: boolean) {
    enabled[key] = on;
    if (on && effective) {
      const row = ROWS.find((r) => r.key === key)!;
      values[key] = normalize(row.kind, effective[key]);
    }
  }

  // Only changed keys: a value for a newly-set/edited override, an explicit
  // null for a reset. Untouched keys are absent (server merge semantics).
  function buildChanges(): Partial<Record<Key, Value | null>> {
    const changes: Partial<Record<Key, Value | null>> = {};
    if (!original) return changes;
    for (const r of ROWS) {
      const before = original[r.key];
      const wasSet = before !== null && before !== undefined;
      if (!enabled[r.key]) {
        if (wasSet) changes[r.key] = null;
      } else if (!wasSet || normalize(r.kind, before) !== values[r.key]) {
        changes[r.key] = values[r.key];
      }
    }
    return changes;
  }

  /**
   * Save the changed settings (none changed: nothing is sent). Returns true when there is nothing
   * left to save, false on a failure, which is shown here. Not loaded (still loading, or the load
   * failed, shown here): there is nothing this section can save, so true.
   */
  export async function save(): Promise<boolean> {
    if (!original || saving) return !saving;
    if (hasInvalid) return false;
    saveError = null;
    const changes = buildChanges();
    if (Object.keys(changes).length === 0) return true;
    saving = true;
    try {
      // Revision-checked against the store's revision (not the one fetched
      // above), so a stale page gets a 409 instead of being fast-forwarded.
      // The store raises the conflict banner / migration page itself, and
      // refreshes the status-check base after a save (M4 Task 7).
      await saveDashboardSettingsChanges(dashboardId, changes);
      // Saved: this is the new baseline, so a retried dialog Save never resends it.
      const next = { ...original };
      for (const r of ROWS) (next as Record<string, unknown>)[r.key] = enabled[r.key] ? values[r.key] : null;
      original = next;
      return true;
    } catch (e) {
      if (e instanceof ConflictError) {
        saveError = 'Not saved — this dashboard was changed somewhere else. Close this dialog and reload to see the latest settings.';
      } else if (e instanceof MigrationFailedError) {
        saveError = 'Not saved — the configuration failed to migrate. ' + e.message;
      } else {
        saveError = e instanceof Error ? e.message : 'Failed to save settings';
      }
      return false;
    } finally {
      saving = false;
    }
  }
</script>

{#if loading}
  <p class="hint">Loading settings…</p>
{:else if loadError}
  <div class="error-box" role="alert">
    Couldn't load this dashboard's settings: {loadError}
  </div>
  <div class="retry-row">
    <button type="button" class="btn-secondary" onclick={load}>Retry</button>
  </div>
{:else if effective}
  <p class="hint">Each setting inherits the global value unless you override it for this dashboard.</p>
  {#each ROWS as row (row.key)}
    <div class="row">
      <div class="row-head">
        <span class="row-label" id={`lbl-${row.key}`}>{row.label}</span>
        <label class="override-toggle">
          <input
            type="checkbox"
            checked={enabled[row.key]}
            aria-label={`Override for this dashboard: ${row.label}`}
            onchange={(e) => toggle(row.key, e.currentTarget.checked)}
          />
          Override for this dashboard
        </label>
      </div>
      <div class="row-body">
        {#if !enabled[row.key]}
          <span class="inherited">Inherited: {display(row.kind, effective[row.key])}</span>
        {:else if row.kind === 'bool'}
          <input
            type="checkbox"
            aria-labelledby={`lbl-${row.key}`}
            checked={values[row.key] === true}
            onchange={(e) => (values[row.key] = e.currentTarget.checked)}
          />
        {:else}
          <input
            type="number"
            step="1"
            min={row.min}
            aria-labelledby={`lbl-${row.key}`}
            value={values[row.key]}
            oninput={(e) => (values[row.key] = e.currentTarget.value.trim() === '' ? NaN : Number(e.currentTarget.value))}
          />
        {/if}
        <button
          type="button"
          class="reset-btn"
          disabled={!enabled[row.key]}
          aria-label={`Reset to inherit: ${row.label}`}
          onclick={() => toggle(row.key, false)}
        >
          Reset to inherit
        </button>
      </div>
      {#if rowProblem(row)}
        <small class="row-error" role="alert">{rowProblem(row)}</small>
      {/if}
    </div>
  {/each}

  {#if saveError}
    <div class="error-box" role="alert">{saveError}</div>
  {/if}
{/if}

<style>
  .hint { color: var(--text-secondary); font-size: 0.875rem; margin: 0 0 1rem; }
  .row { padding: 0.75rem 0; border-bottom: 1px solid var(--border); }
  .row-head { display: flex; justify-content: space-between; align-items: center; gap: 1rem; flex-wrap: wrap; }
  .row-label { font-weight: 500; color: var(--text-primary); }
  .override-toggle { display: flex; align-items: center; gap: 0.4rem; font-size: 0.8rem; color: var(--text-secondary); cursor: pointer; }
  .row-body { display: flex; align-items: center; gap: 0.75rem; margin-top: 0.5rem; min-height: 2rem; }
  .inherited { color: var(--text-secondary); font-size: 0.875rem; flex: 1; }
  .row-body input[type='number'] {
    padding: 0.5rem;
    border: 1px solid var(--border);
    border-radius: 0.375rem;
    background: var(--bg-secondary);
    color: var(--text-primary);
    flex: 1;
  }
  .reset-btn {
    margin-left: auto;
    background: none;
    border: 1px solid var(--border);
    color: var(--text-secondary);
    border-radius: 0.375rem;
    padding: 0.25rem 0.6rem;
    font-size: 0.8rem;
    cursor: pointer;
  }
  .reset-btn:disabled { opacity: 0.4; cursor: default; }
  .row-error { display: block; margin-top: 0.25rem; color: var(--error, #c0392b); font-size: 0.8rem; }
  .retry-row { display: flex; justify-content: flex-end; margin-top: 1rem; }
  .retry-row button { padding: 0.5rem 1rem; border: none; border-radius: 0.375rem; cursor: pointer; }
  .error-box {
    margin: 1rem 0 0;
    padding: 0.75rem 1rem;
    border: 1px solid var(--error, #c0392b);
    border-radius: 0.5rem;
    color: var(--error, #c0392b);
    font-size: 0.875rem;
  }
</style>
