<script lang="ts">
  // Settings › Dashboards: tiles whose status check has failed without a break for longer than
  // Global settings › Status checks › "Treat a link as dead after", so they can be fixed or removed.
  // Never a bare empty list: it says when checks are off, when nothing is checked, and how far back
  // the failure history goes.
  import { onMount } from 'svelte';
  import { getDeadLinks, type DeadLinksReport, type DeadLink } from '$lib/utils/api';
  import { formatHours, failingFor } from '$lib/utils/hoursDays';
  import { showOnDashboard } from '$lib/utils/showIt';
  import { safeOpenUrl, isValidUrl } from '$lib/utils/url';
  import { isSshUrl, openSshInPlace } from '$lib/utils/ssh';
  import { toast } from '$lib/stores/toast';

  let report = $state<DeadLinksReport | null>(null);
  let loadError = $state('');
  let loading = $state(true);

  async function load() {
    loading = true;
    loadError = '';
    try {
      report = await getDeadLinks();
    } catch (e) {
      report = null;
      loadError = e instanceof Error ? e.message : 'request failed';
    } finally {
      loading = false;
    }
  }
  onMount(() => void load());

  const fmtDate = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  };
  const fmtDay = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { dateStyle: 'medium' });
  };

  function show(l: DeadLink) {
    showOnDashboard({ kind: 'tile', ...l });
  }

  function openAddress(l: DeadLink) {
    if (isSshUrl(l.url) && isValidUrl(l.url)) {
      openSshInPlace(l.url);
      return;
    }
    if (!safeOpenUrl(l.url, '_blank')) toast.error(`Couldn't open "${l.url}": it isn't an address HOPS can open.`);
  }
</script>

<section class="dead" aria-labelledby="dead-links-title" data-testid="dead-links">
  <h3 id="dead-links-title">Dead links</h3>
  {#if loading}
    <p class="muted">Loading…</p>
  {:else if loadError}
    <p class="error" role="alert">
      Couldn't load the dead-link report: {loadError}.
      <button type="button" class="btn-secondary" onclick={load}>Try again</button>
    </p>
  {:else if report}
    <p class="muted">
      Tiles whose status check has failed without a break for more than
      <strong>{formatHours(report.thresholdHours)}</strong>
      (<a href="/settings/global#status-checks">change</a>).
    </p>
    {#if !report.checksEnabled}
      <p class="state" role="status" data-state="checks-off">
        Status checks are turned off for all dashboards, so HOPS isn't watching for dead links.
        Turn them on in <a href="/settings/global#status-checks">Global settings › Status checks</a>.
      </p>
    {:else if report.checkedTiles === 0}
      <p class="state" role="status" data-state="none-checked">
        No tiles have status checks turned on, so there's nothing to watch. Turn on "Enable Status Check"
        on a tile (or for a whole dashboard, tab or folder) to have it watched.
      </p>
    {:else if report.links.length === 0}
      <p class="state ok" role="status" data-state="none-dead">
        No dead links: none of the {report.checkedTiles} checked tile{report.checkedTiles === 1 ? '' : 's'} has been failing that long.
      </p>
    {:else}
      <ul class="rows">
        {#each report.links as l (l.id)}
          <li class="row" data-dead-link={l.id}>
            <div class="what">
              <div class="name">{l.name || '(no name)'}</div>
              <div class="path">{l.path.join(' › ')}</div>
              <div class="url"><code>{l.url}</code></div>
              <div class="since">
                Failing since {fmtDate(l.failingSince)} — for {failingFor(l.failingSince)}
              </div>
              {#if l.lastError}<div class="err">Last error: {l.lastError}</div>{/if}
            </div>
            <div class="actions">
              <button type="button" class="btn-secondary" onclick={() => show(l)}>Show it</button>
              <button type="button" class="btn-secondary" onclick={() => openAddress(l)}>Open address</button>
            </div>
          </li>
        {/each}
      </ul>
    {/if}
    {#if report.checksEnabled && report.historyStartedAt}
      <p class="muted" data-state="history">
        Failure history started on {fmtDay(report.historyStartedAt)}, so a failure older than that may be longer than shown.
      </p>
    {/if}
  {/if}
</section>

<style>
  .dead {
    margin-top: 2rem;
    padding-top: 1.25rem;
    border-top: 1px solid var(--border);
  }
  h3 {
    margin: 0 0 0.5rem;
  }
  p {
    margin: 0.4rem 0;
    line-height: 1.45;
  }
  .muted {
    color: var(--text-secondary);
    font-size: 0.9rem;
  }
  .error {
    color: var(--color-error, #ef4444);
  }
  .state {
    padding: 0.6rem 0.8rem;
    border: 1px solid var(--border);
    border-left: 3px solid var(--accent);
    border-radius: 0.4rem;
  }
  .rows {
    list-style: none;
    margin: 0.5rem 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    justify-content: space-between;
    padding: 0.6rem 0.8rem;
    border: 1px solid var(--border);
    border-left: 3px solid var(--color-error, #ef4444);
    border-radius: 0.4rem;
  }
  .what {
    min-width: 0;
    flex: 1 1 18rem;
  }
  .name {
    font-weight: 600;
  }
  .path,
  .since,
  .err {
    color: var(--text-secondary);
    font-size: 0.85rem;
  }
  .url code {
    font-size: 0.8rem;
    overflow-wrap: anywhere;
  }
  .actions {
    display: flex;
    gap: 0.5rem;
    align-items: flex-start;
    flex-wrap: wrap;
  }
</style>
