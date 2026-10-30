<script lang="ts">
  // Settings › Dashboards › Blocked status checks: every tile whose own status check is On but
  // which is not checked because a dashboard, tab or folder above it is Disabled (or holds a
  // wrong-typed value). A report only: each row opens the tile on its dashboard. When the global
  // setting is Disabled nothing is checked anywhere, and the page says only that. An unknown
  // global value is never guessed.
  import { config, dashboardHref } from '$lib/stores/config';
  import { listSettings } from '$lib/utils/api';
  import { findBlocked, type BlockedRow } from '$lib/editor/blockedStatusChecks';
  import type { LayoutDashboard } from '$lib/types/layout';
  import { showOnDashboard } from '$lib/utils/showIt';

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
      if (!s || (s.value !== 'true' && s.value !== 'false')) throw new Error('the server did not list the setting');
      global = s.value === 'true';
    } catch (e) {
      globalError = e instanceof Error && e.message ? e.message : 'the request failed';
    }
  }
  void loadGlobal();

  const rows = $derived(global === true ? findBlocked(dashboards) : []);
  const groups = $derived(
    dashboards.map((d) => ({ d, rows: rows.filter((r) => r.dashboardId === d.id) })).filter((g) => g.rows.length)
  );

  const named = (s: string) => s || '(no name)';
  const where = (d: LayoutDashboard, r: BlockedRow) => [d.name, ...r.path.slice(0, -1)].map(named).join(' › ');
  function blockedByText(r: BlockedRow): string {
    const b = r.blockedBy;
    const what = b.source === 'invalid' ? `invalid setting on ${b.name}` : `${b.source} ${b.name}`;
    return b.more ? `${what} +${b.more} more` : what;
  }

  function show(d: LayoutDashboard, r: BlockedRow) {
    showOnDashboard({
      kind: 'tile', id: r.tileId, dashboardId: d.id, dashboardPath: d.path,
      dashboardName: d.name, tabId: r.tabId, folderIds: r.folderIds
    });
  }
</script>

<section class="blocked" aria-labelledby="bsc-title" data-testid="blocked-status-checks">
  <h3 id="bsc-title">Blocked status checks</h3>
  {#if !$config}
    <p class="muted">Loading…</p>
  {:else if global === null}
    {#if globalError}
      <p>
        <span class="error">Can't tell whether status monitoring is enabled ({globalError}).</span>
        <button type="button" class="btn-secondary small" aria-label="Retry global setting" onclick={loadGlobal}>Retry</button>
      </p>
    {:else}
      <p class="muted" role="status">Checking…</p>
    {/if}
  {:else if global === false}
    <p class="state" role="status" data-state="global-disabled">
      Status monitoring is disabled in Settings, so nothing is checked.
      <a href="/settings/global#status-checks">Settings › Global › Status checks</a>
    </p>
  {:else}
    <p class="muted">Tiles whose status check is On but which aren't checked, because a dashboard, tab or folder above them is Disabled.</p>
    {#if rows.length === 0}
      <p class="state ok" role="status" data-state="none">No blocked status checks.</p>
    {:else}
      {#each groups as g (g.d.id)}
        <div class="group" data-bsc-group={g.d.id}>
          <div class="head">
            <strong>{named(g.d.name)}</strong>
            <a href={dashboardHref(g.d.path)}>Open dashboard</a>
          </div>
          <ul class="rows">
            {#each g.rows as r (r.key)}
              <li class="row" class:warn={r.blockedBy.source === 'invalid'} data-testid="bsc-row" data-key={r.key}>
                <span class="tile">
                  <button type="button" class="link" onclick={() => show(g.d, r)}>{named(r.path[r.path.length - 1])}</button>
                </span>
                <span class="where muted">{where(g.d, r)}</span>
                <span class="by">Blocked by {blockedByText(r)}</span>
              </li>
            {/each}
          </ul>
        </div>
      {/each}
    {/if}
  {/if}
</section>

<style>
  .blocked { margin-top: 2rem; padding-top: 1.25rem; border-top: 1px solid var(--border); }
  h3 { margin: 0 0 0.5rem; }
  p { margin: 0.4rem 0; line-height: 1.45; }
  .muted { color: var(--text-secondary); font-size: 0.9rem; }
  .error { color: var(--color-error, #ef4444); }
  .state { padding: 0.6rem 0.8rem; border: 1px solid var(--border); border-left: 3px solid var(--accent); border-radius: 0.4rem; }
  .group { margin: 0.75rem 0; padding: 0.6rem 0.8rem; border: 1px solid var(--border); border-left: 3px solid var(--accent); border-radius: 0.4rem; }
  .head { display: flex; flex-wrap: wrap; gap: 0.5rem 1rem; align-items: baseline; justify-content: space-between; }
  .head a:hover { text-decoration: underline; }
  /* The list is its own size container: the rows lay out by the width they actually get. */
  .rows { list-style: none; margin: 0.5rem 0 0; padding: 0; display: flex; flex-direction: column; gap: 0.4rem; container-type: inline-size; }
  .row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 2fr) minmax(0, 1.5fr); gap: 0.25rem 0.75rem; align-items: baseline; }
  .row.warn { border-left: 3px solid var(--color-warning, #f59e0b); padding-left: 0.4rem; }
  .tile, .where, .by { min-width: 0; overflow-wrap: anywhere; }
  .link { background: none; border: 0; padding: 0; color: var(--accent); cursor: pointer; text-align: left; font: inherit; overflow-wrap: anywhere; }
  .link:hover { text-decoration: underline; }
  .small { padding: 0.1rem 0.6rem; font-size: 0.85rem; }
  @container (max-width: 34rem) {
    .row { grid-template-columns: minmax(0, 1fr); }
  }
</style>
