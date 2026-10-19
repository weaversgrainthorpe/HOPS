<script lang="ts">
  import Icon from '@iconify/svelte';
  import { onMount } from 'svelte';
  import type { DashboardSettings } from '$lib/types';
  import { focusTrap } from '$lib/utils/focusTrap';
  import {
    getDashboardSettings,
    saveDashboardSettings,
    ConflictError,
    MigrationFailedError,
    type EffectiveDashboardSettings
  } from '$lib/utils/api';
  import { applyDashboardSettings, migrationFailure } from '$lib/stores/config';

  interface Props {
    dashboardId: string;
    onClose: () => void;
  }

  let { dashboardId, onClose }: Props = $props();

  type Key = keyof DashboardSettings;
  type Value = string | number | boolean;
  type Kind = 'bool' | 'int' | 'layout';

  const ROWS: { key: Key; label: string; kind: Kind; min?: number }[] = [
    { key: 'statusChecksEnabled', label: 'Status checks', kind: 'bool' },
    { key: 'statusCheckIntervalMinutes', label: 'Check interval (minutes)', kind: 'int', min: 1 },
    { key: 'statusCheckTimeoutSeconds', label: 'Check timeout (seconds)', kind: 'int', min: 1 },
    { key: 'editIdleTimeoutMinutes', label: 'Edit mode idle timeout (minutes)', kind: 'int', min: 0 },
    { key: 'animatedFolderBackgrounds', label: 'Animated folder backgrounds', kind: 'bool' },
    { key: 'defaultLayout', label: 'Default layout for new tabs', kind: 'layout' }
  ];

  let loading = $state(true);
  let loadError = $state<string | null>(null);
  let saveError = $state<string | null>(null);
  let saving = $state(false);

  let original = $state<DashboardSettings | null>(null);
  let effective = $state<EffectiveDashboardSettings | null>(null);
  let revision = $state(0);
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
      revision = resp.revision;
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

  async function handleSave() {
    if (!original || saving) return;
    saveError = null;
    const changes = buildChanges();
    saving = true;
    try {
      if (Object.keys(changes).length > 0) {
        const resp = await saveDashboardSettings(dashboardId, changes, revision);
        const merged = { ...original, ...changes } as DashboardSettings;
        applyDashboardSettings(dashboardId, merged, resp.revision);
      }
      onClose();
    } catch (e) {
      if (e instanceof ConflictError) {
        saveError = 'Not saved — this dashboard was changed somewhere else. Close this dialog and reload to see the latest settings.';
      } else if (e instanceof MigrationFailedError) {
        migrationFailure.set(e.detail);
        saveError = 'Not saved — the configuration failed to migrate. ' + e.message;
      } else {
        saveError = e instanceof Error ? e.message : 'Failed to save settings';
      }
    } finally {
      saving = false;
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onClose();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="modal-backdrop" onclick={onClose} onkeydown={(e) => e.key === 'Escape' && onClose()}>
  <div
    class="modal-content"
    onclick={(e) => e.stopPropagation()}
    onkeydown={(e) => e.stopPropagation()}
    role="dialog"
    aria-modal="true"
    aria-labelledby="dash-settings-title"
    tabindex="-1"
    use:focusTrap
  >
    <div class="modal-header">
      <h2 id="dash-settings-title">Dashboard settings</h2>
      <button type="button" class="close-btn" onclick={onClose} aria-label="Close">
        <Icon icon="mdi:close" width="24" />
      </button>
    </div>

    <form onsubmit={(e) => { e.preventDefault(); handleSave(); }}>
      {#if loading}
        <p class="hint">Loading settings…</p>
      {:else if loadError}
        <div class="error-box" role="alert">
          Couldn't load this dashboard's settings: {loadError}
        </div>
        <div class="modal-actions">
          <button type="button" class="btn-secondary" onclick={onClose}>Cancel</button>
          <button type="button" class="btn-primary" onclick={load}>Retry</button>
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
              {:else if row.kind === 'int'}
                <input
                  type="number"
                  step="1"
                  min={row.min}
                  aria-labelledby={`lbl-${row.key}`}
                  value={values[row.key]}
                  oninput={(e) => (values[row.key] = Number(e.currentTarget.value))}
                />
              {:else}
                <select
                  aria-labelledby={`lbl-${row.key}`}
                  value={values[row.key]}
                  onchange={(e) => (values[row.key] = e.currentTarget.value)}
                >
                  <option value="grid">grid</option>
                  <option value="free">free</option>
                </select>
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
          </div>
        {/each}

        {#if saveError}
          <div class="error-box" role="alert">{saveError}</div>
        {/if}

        <div class="modal-actions">
          <button type="button" class="btn-secondary" onclick={onClose}>Cancel</button>
          <button type="submit" class="btn-primary" disabled={saving}>
            <Icon icon="mdi:content-save" width="20" />
            Save
          </button>
        </div>
      {/if}
    </form>
  </div>
</div>

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: var(--z-modal);
    padding: 1rem;
  }
  .modal-content {
    background: var(--bg-primary);
    border-radius: 0.75rem;
    width: 100%;
    max-width: 560px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
    max-height: 90vh;
    overflow-y: auto;
  }
  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1.5rem;
    border-bottom: 1px solid var(--border);
    position: sticky;
    top: 0;
    background: var(--bg-primary);
    z-index: 1;
  }
  .modal-header h2 { margin: 0; font-size: 1.5rem; }
  .close-btn {
    background: none;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    padding: 0.5rem;
    border-radius: 0.375rem;
    display: flex;
  }
  .close-btn:hover { background: var(--bg-tertiary); color: var(--text-primary); }
  form { padding: 1.5rem; }
  .hint { color: var(--text-secondary); font-size: 0.875rem; margin: 0 0 1rem; }
  .row { padding: 0.75rem 0; border-bottom: 1px solid var(--border); }
  .row-head { display: flex; justify-content: space-between; align-items: center; gap: 1rem; flex-wrap: wrap; }
  .row-label { font-weight: 500; color: var(--text-primary); }
  .override-toggle { display: flex; align-items: center; gap: 0.4rem; font-size: 0.8rem; color: var(--text-secondary); cursor: pointer; }
  .row-body { display: flex; align-items: center; gap: 0.75rem; margin-top: 0.5rem; min-height: 2rem; }
  .inherited { color: var(--text-secondary); font-size: 0.875rem; flex: 1; }
  .row-body input[type='number'], .row-body select {
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
  .error-box {
    margin: 1rem 0 0;
    padding: 0.75rem 1rem;
    border: 1px solid var(--error, #c0392b);
    border-radius: 0.5rem;
    color: var(--error, #c0392b);
    font-size: 0.875rem;
  }
  .modal-actions { display: flex; gap: 0.75rem; justify-content: flex-end; margin-top: 1.5rem; }
  .modal-actions button { display: flex; align-items: center; gap: 0.5rem; padding: 0.625rem 1.25rem; border: none; border-radius: 0.375rem; font-weight: 500; cursor: pointer; }
</style>
