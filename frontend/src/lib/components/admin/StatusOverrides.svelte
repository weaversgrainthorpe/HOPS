<script lang="ts">
  // Settings › Dashboards › Status check overrides (rc5 Part B): every dashboard, tab, folder and
  // tile that sets status checks itself (On, Off or an invalid value), what it would get if it
  // inherited, and a bulk "Restore inheritance". It saves the way Duplicates' merge does: refused
  // while a dashboard is being edited, one revision-checked save at a time, and a failure part-way
  // says what was already saved. An unknown dashboard or global value is never guessed.
  import { get } from 'svelte/store';
  import { untrack } from 'svelte';
  import { config, applySavedLayout, showSaveWarning, loadConfig, findLayoutDashboard, dashboardHref } from '$lib/stores/config';
  import { session, parkedDraft } from '$lib/stores/editSession';
  import { saveDashboardV3, saveDashboardSettings, listSettings, ConflictError } from '$lib/utils/api';
  import { statusBaseFor, refreshStatusBase, type BaseState } from '$lib/stores/statusCheckBase';
  import { findOverrides, previewRestore, withInheritanceRestored, type Bases, type OverrideRow, type TileRef } from '$lib/editor/statusOverrides';
  import { levelNameIn, type Resolution } from '$lib/editor/statusChecks';
  import { locate } from '$lib/editor/treeOps';
  import type { LayoutDashboard } from '$lib/types/layout';
  import { showOnDashboard } from '$lib/utils/showIt';
  import { toast } from '$lib/stores/toast';

  const dashboards = $derived<LayoutDashboard[]>($config?.dashboards ?? []);

  // ---- the global setting: known, or null with a visible error and Retry
  let global = $state<boolean | null>(null);
  let globalError = $state('');
  async function loadGlobal() {
    globalError = '';
    global = null;
    try {
      const { settings } = await listSettings();
      const s = settings?.find((x) => x.key === 'status.checks_enabled');
      if (!s) throw new Error('the server did not list the setting');
      global = s.value === 'true';
    } catch (e) {
      globalError = e instanceof Error && e.message ? e.message : 'the request failed';
    }
  }
  void loadGlobal();

  // ---- each dashboard's own level (statusCheckBase store); loading or failed = unknown (null)
  let baseStates = $state.raw<Record<string, BaseState>>({});
  $effect(() => {
    const ids = dashboards.map((d) => d.id);
    const stops = ids.map((id) =>
      statusBaseFor(id).subscribe((s) => {
        baseStates = { ...untrack(() => baseStates), [id]: s };
      })
    );
    return () => stops.forEach((f) => f());
  });
  const bases = $derived.by<Bases>(() => {
    const out: Bases = {};
    for (const d of dashboards) {
      const s = baseStates[d.id];
      out[d.id] = s?.state === 'ok' ? s.base : null;
    }
    return out;
  });
  const allKnown = $derived(global !== null && dashboards.every((d) => bases[d.id] !== null));

  const rows = $derived(findOverrides(dashboards, bases, global));

  // ---- filter, remembered per browser
  type Filter = 'changes' | 'none' | 'all';
  const FILTERS: { id: Filter; label: string }[] = [
    { id: 'changes', label: 'Would change something' },
    { id: 'none', label: 'No effect' },
    { id: 'all', label: 'All' }
  ];
  const FILTER_KEY = 'hops.statusOverrides.filter';
  function loadFilter(): Filter {
    try {
      const v = localStorage.getItem(FILTER_KEY);
      if (FILTERS.some((x) => x.id === v)) return v as Filter;
    } catch {
      /* storage unavailable: the default is fine, this is only a viewer convenience */
    }
    return 'changes';
  }
  let filter = $state<Filter>(loadFilter());
  // A row whose effect can't be known yet can't be ruled out, so it sits with "Would change something".
  const inFilter = (r: OverrideRow, f: Filter) =>
    f === 'all' || (f === 'changes' ? r.changes || r.effect === null : !r.changes && r.effect !== null);
  const counts = $derived(Object.fromEntries(FILTERS.map((f) => [f.id, rows.filter((r) => inFilter(r, f.id)).length])) as Record<Filter, number>);
  const shown = $derived(rows.filter((r) => inFilter(r, filter)));
  function setFilter(f: Filter) {
    filter = f;
    previewing = false;
    refusal = '';
    try {
      localStorage.setItem(FILTER_KEY, f);
    } catch {
      /* not remembered; still works for this visit */
    }
  }
  function filterKeys(e: KeyboardEvent) {
    const i = FILTERS.findIndex((x) => x.id === filter);
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const next = FILTERS[(i + d + FILTERS.length) % FILTERS.length].id;
    setFilter(next);
    (e.currentTarget as HTMLElement).querySelector<HTMLInputElement>(`input[value="${next}"]`)?.focus();
  }

  /** Dashboards in their own order: those with shown rows, and any whose level is unknown (said so). */
  const groups = $derived(
    dashboards
      .map((d) => ({ d, rows: shown.filter((r) => r.dashboardId === d.id) }))
      .filter((g) => g.rows.length || bases[g.d.id] === null)
  );

  // ---- ticking and restoring
  let ticked = $state<string[]>([]);
  // Only rows that still exist and can be known count (the list is recomputed after every save).
  const selected = $derived(ticked.filter((k) => rows.some((r) => r.key === k && r.effect !== null)));
  let previewing = $state(false);
  let busy = $state(false);
  let refusal = $state('');

  function toggle(key: string, on: boolean) {
    ticked = on ? [...ticked.filter((k) => k !== key), key] : ticked.filter((k) => k !== key);
    previewing = false;
    refusal = '';
  }
  function selectAllShown() {
    ticked = [...new Set([...ticked, ...shown.filter((r) => r.effect !== null).map((r) => r.key)])];
    previewing = false;
    refusal = '';
  }
  const preview = $derived(previewing ? previewRestore(dashboards, bases, global, selected) : { start: [], stop: [] });

  const tiles = (n: number) => `${n} tile${n === 1 ? '' : 's'}`;
  const onOff = (b: boolean) => (b ? 'On' : 'Off');
  const NOW: Record<OverrideRow['now'], string> = { on: 'On (set here)', off: 'Off (set here)', invalid: 'Invalid (treated as off)' };
  const dashName = (id: string) => dashboards.find((d) => d.id === id)?.name || '(no name)';
  const rowPath = (r: OverrideRow) => (r.level === 'dashboard' ? dashName(r.dashboardId) : r.path.map((p) => p || '(no name)').join(' › '));
  const refPath = (t: TileRef) => t.path.map((p) => p || '(no name)').join(' › ');
  // The preview names every ticked row, including ticks the current filter hides.
  const pickedRows = $derived(rows.filter((r) => selected.includes(r.key)));
  const pickedManyDashboards = $derived(new Set(pickedRows.map((r) => r.dashboardId)).size > 1);
  const pickedLabel = (r: OverrideRow, manyDashboards: boolean) =>
    r.level === 'dashboard'
      ? `${dashName(r.dashboardId)}: the dashboard's own setting`
      : `${manyDashboards ? `${dashName(r.dashboardId)}: ` : ''}${rowPath(r)} (${r.level})`;

  function fromText(res: Resolution): string {
    if (res.source === 'invalid') return `→ Off, invalid setting on ${levelNameIn(dashboards, res.source, res.sourceId)}`;
    const from = res.source === 'global' ? 'global' : `${res.source} ${levelNameIn(dashboards, res.source, res.sourceId)}`;
    return `→ ${onOff(res.on)}, from ${from}`;
  }
  function effectText(r: OverrideRow): string {
    const e = r.effect!;
    if (r.level === 'tile') return e.start ? 'starts checking' : e.stop ? 'stops checking' : 'no effect';
    const parts = [e.start ? `starts checking ${tiles(e.start)}` : '', e.stop ? `stops checking ${tiles(e.stop)}` : ''].filter(Boolean);
    return parts.length ? parts.join(' and ') : 'no effect';
  }
  function headerText(id: string): string {
    const s = baseStates[id];
    if (!s || s.state === 'loading') return "dashboard: Can't tell yet (loading…)";
    if (s.state === 'error') return `dashboard: Can't tell yet (${s.message})`;
    return s.base.source === 'dashboard'
      ? `dashboard: ${onOff(s.base.on)} (set here)`
      : `dashboard: follows global (${s.base.on ? 'on' : 'off'})`;
  }

  /** Reveal a tile or folder on its dashboard; a tab or dashboard row opens the dashboard. */
  function show(r: OverrideRow) {
    const d = dashboards.find((x) => x.id === r.dashboardId);
    const loc = d ? locate(d, r.id) : undefined;
    if (!d || !loc) return;
    showOnDashboard({
      kind: r.level === 'folder' ? 'folder' : 'tile', id: r.id, dashboardId: d.id, dashboardPath: d.path,
      dashboardName: d.name, tabId: loc.tabId, folderIds: loc.folderChain
    });
  }

  async function confirmRestore() {
    if (busy) return;
    refusal = '';
    const keys = selected;
    // The plan is fixed before the first write: each save replaces $config and so recomputes the rows.
    const picked = rows.filter((r) => keys.includes(r.key));
    const byDash = dashboards
      .map((d) => ({
        id: d.id, name: d.name,
        layoutKeys: picked.filter((r) => r.dashboardId === d.id && r.level !== 'dashboard').map((r) => r.key),
        own: picked.some((r) => r.dashboardId === d.id && r.level === 'dashboard')
      }))
      .filter((p) => p.layoutKeys.length || p.own);

    // Refuse before anything is saved if any affected dashboard is open for editing.
    const editing = new Set([get(session)?.dashboardId, get(parkedDraft)?.dashboardId].filter(Boolean));
    const blocked = byDash.find((d) => editing.has(d.id));
    if (blocked) {
      refusal = `Not restored: "${blocked.name}" is being edited (an edit session or unsaved draft is open). Save or discard that first, then restore.`;
      return;
    }

    busy = true;
    const done: string[] = [];
    try {
      for (const { id, name, layoutKeys, own } of byDash) {
        const d = findLayoutDashboard(id, get(config)); // the store's plain value: structuredClone-safe
        if (!d) throw new Error(`Dashboard "${name}" no longer exists. Reload and try again.`);
        let revision = d.revision;
        if (layoutKeys.length) {
          const resp = await saveDashboardV3(d.id, withInheritanceRestored(d, layoutKeys), d.revision);
          applySavedLayout(resp);
          if (resp.warning) showSaveWarning(resp.warning);
          done.push(`"${d.name}" (tabs, folders and tiles)`);
          revision = resp.revision;
        }
        if (own) {
          const resp = await saveDashboardSettings(d.id, { statusChecksEnabled: null }, revision);
          applySavedLayout(resp);
          done.push(`"${d.name}" (dashboard setting)`);
        }
      }
      toast.success(`Restored inheritance for ${keys.length} setting${keys.length === 1 ? '' : 's'}.`);
      previewing = false;
      ticked = [];
    } catch (e) {
      const partial = done.length ? ` Already saved before this failed: ${done.join(', ')}.` : '';
      refusal = e instanceof ConflictError
        ? `Not restored: a dashboard was changed somewhere else, so nothing more was saved. The list below has been reloaded; check it and try again.${partial}`
        : `Restore failed: ${e instanceof Error ? e.message : 'request failed'}.${partial}`;
    } finally {
      busy = false;
      // Recompute from what was actually saved: the stored document and the dashboards' own levels.
      void loadConfig({ background: true });
      for (const d of byDash) void refreshStatusBase(d.id);
    }
  }
</script>

<section class="overrides" aria-labelledby="so-title" data-testid="status-overrides">
  <h3 id="so-title">Status check overrides</h3>
  {#if !$config}
    <p class="muted">Loading…</p>
  {:else}
    <p class="muted">Places where status checks are set by hand instead of following the level above.</p>
    <p class="global">
      Global setting:
      {#if global !== null}
        <a href="/settings/global#status-checks"><strong>{onOff(global)}</strong> (Settings › Global)</a>
      {:else if globalError}
        <span class="error">can't tell yet ({globalError})</span>
        <button type="button" class="btn-secondary small" aria-label="Retry global setting" onclick={loadGlobal}>Retry</button>
      {:else}
        <span class="muted">Checking…</span>
      {/if}
    </p>

    {#if rows.length === 0 && allKnown}
      <p class="state ok" role="status" data-state="none">
        Everything follows the level above: no dashboard, tab, folder or tile sets its own status checks.
      </p>
    {:else}
      <div class="scope" role="radiogroup" aria-label="Show overrides" tabindex="-1" data-testid="so-filter" onkeydown={filterKeys}>
        <span class="muted">Show</span>
        {#each FILTERS as o (o.id)}
          <label class="seg" class:on={filter === o.id}>
            <input type="radio" name="so-filter" value={o.id} checked={filter === o.id} disabled={busy} onchange={() => setFilter(o.id)} />
            {o.label} ({counts[o.id]})
          </label>
        {/each}
      </div>

      {#if !groups.length}
        <p class="muted" role="status">Nothing to show under this filter.</p>
      {/if}
      {#each groups as g (g.d.id)}
        {@const st = baseStates[g.d.id]}
        <div class="group" data-so-group={g.d.id}>
          <div class="head">
            <strong>{g.d.name || '(no name)'}</strong>
            <span class="muted" class:error={st?.state === 'error'}>{headerText(g.d.id)}</span>
            {#if st?.state === 'error'}
              <button type="button" class="btn-secondary small" aria-label={`Retry ${g.d.name}`} onclick={() => refreshStatusBase(g.d.id)}>Retry</button>
            {/if}
          </div>
          {#if g.rows.length}
            <ul class="rows">
              {#each g.rows as r (r.key)}
                <li class="row" class:warn={r.now === 'invalid'} data-testid="so-row" data-key={r.key}>
                  <input
                    type="checkbox"
                    aria-label={`Select ${rowPath(r)}`}
                    checked={ticked.includes(r.key) && r.effect !== null}
                    disabled={busy || r.effect === null}
                    onchange={(e) => toggle(r.key, e.currentTarget.checked)}
                  />
                  <span class="what">
                    {#if r.level === 'tile' || r.level === 'folder'}
                      <button type="button" class="link" onclick={() => show(r)}>{rowPath(r)}</button>
                    {:else}
                      <a href={dashboardHref(g.d.path)}>{rowPath(r)}</a>
                    {/if}
                    <span class="muted">{r.level}</span>
                  </span>
                  <span class="change">
                    <span class:warn-text={r.now === 'invalid'}>{NOW[r.now]}</span>
                    {#if r.inherited}<span>{fromText(r.inherited)}</span>{:else}<span class="muted">→ Can't tell yet</span>{/if}
                  </span>
                  <span class="effect">{r.effect ? effectText(r) : "Can't tell yet"}</span>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      {/each}

      <div class="btns">
        <button type="button" class="btn-secondary" disabled={busy || !shown.some((r) => r.effect !== null)} onclick={selectAllShown}>Select all shown</button>
        <button type="button" class="btn-primary" disabled={busy || selected.length === 0} onclick={() => { refusal = ''; previewing = true; }}>
          Restore inheritance for {selected.length} selected
        </button>
      </div>

      {#if previewing && selected.length}
        <div class="preview" role="group" aria-label="Restore preview" data-testid="so-preview">
          <p>
            <strong>Restoring {selected.length} setting{selected.length === 1 ? '' : 's'} will start checking {tiles(preview.start.length)} and stop checking {tiles(preview.stop.length)}.</strong>
          </p>
          <ul class="picked">
            {#each pickedRows as r (r.key)}
              <li data-so-picked={r.key}>
                {pickedLabel(r, pickedManyDashboards)}: {NOW[r.now]}{#if !shown.some((x) => x.key === r.key)}{' '}<span class="muted">(not shown under this filter)</span>{/if}
              </li>
            {/each}
          </ul>
          {#each [{ label: 'Starts checking', list: preview.start }, { label: 'Stops checking', list: preview.stop }] as part (part.label)}
            {#if part.list.length}
              <p class="muted">
                {part.label}: {part.list.slice(0, 10).map(refPath).join(', ')}{part.list.length > 10 ? `, and ${part.list.length - 10} more` : ''}
              </p>
            {/if}
          {/each}
          <p class="muted">Saved as a normal edit of each affected dashboard, after the usual safety backup.</p>
          <div class="btns">
            <button type="button" class="btn-primary" disabled={busy} onclick={confirmRestore}>{busy ? 'Restoring…' : 'Confirm'}</button>
            <button type="button" class="btn-secondary" disabled={busy} onclick={() => { previewing = false; refusal = ''; }}>Cancel</button>
          </div>
        </div>
      {/if}
      {#if refusal}<p class="error" role="alert" data-testid="so-refusal">{refusal}</p>{/if}
    {/if}
  {/if}
</section>

<style>
  .overrides { margin-top: 2rem; padding-top: 1.25rem; border-top: 1px solid var(--border); }
  h3 { margin: 0 0 0.5rem; }
  p { margin: 0.4rem 0; line-height: 1.45; }
  .muted { color: var(--text-secondary); font-size: 0.9rem; }
  .error { color: var(--color-error, #ef4444); }
  .state { padding: 0.6rem 0.8rem; border: 1px solid var(--border); border-left: 3px solid var(--accent); border-radius: 0.4rem; }
  .scope { display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem; margin: 0.6rem 0; }
  .seg { position: relative; padding: 0.25rem 0.8rem; border: 1px solid var(--border); border-radius: 0.4rem; cursor: pointer; }
  .seg.on { background: var(--accent-solid); color: var(--on-accent); border-color: var(--accent-solid); }
  .seg input { position: absolute; opacity: 0; inset: 0; margin: 0; cursor: pointer; }
  .seg:has(input:focus-visible) { outline: 2px solid var(--accent); outline-offset: 2px; }
  .group { margin: 0.75rem 0; padding: 0.6rem 0.8rem; border: 1px solid var(--border); border-left: 3px solid var(--accent); border-radius: 0.4rem; }
  .head { display: flex; flex-wrap: wrap; gap: 0.5rem 1rem; align-items: baseline; justify-content: space-between; }
  .rows { list-style: none; margin: 0.5rem 0 0; padding: 0; display: flex; flex-direction: column; gap: 0.4rem; }
  .row { display: grid; grid-template-columns: auto minmax(10rem, 2fr) minmax(10rem, 2fr) minmax(7rem, 1fr); gap: 0.5rem 0.75rem; align-items: baseline; }
  .row.warn { border-left: 3px solid var(--color-warning, #f59e0b); padding-left: 0.4rem; }
  .warn-text { color: var(--color-warning, #f59e0b); font-weight: 600; }
  .what, .change { display: flex; flex-wrap: wrap; gap: 0.25rem 0.5rem; min-width: 0; overflow-wrap: anywhere; }
  .link { background: none; border: 0; padding: 0; color: var(--accent); cursor: pointer; text-align: left; font: inherit; overflow-wrap: anywhere; }
  .link:hover, .what a:hover { text-decoration: underline; }
  .small { padding: 0.1rem 0.6rem; font-size: 0.85rem; }
  .preview { margin-top: 0.5rem; padding: 0.6rem 0.8rem; border: 1px solid var(--accent); border-radius: 0.4rem; }
  .picked { margin: 0.3rem 0; padding-left: 1.2rem; overflow-wrap: anywhere; }
  .btns { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-top: 0.6rem; }
  /* Phone: the path, then Now → If inherited, then the effect, under the checkbox. */
  @media (max-width: 480px) {
    .row { grid-template-columns: auto 1fr; }
    .change, .effect { grid-column: 2; }
  }
</style>
