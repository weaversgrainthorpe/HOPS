<script lang="ts">
  import { page } from '$app/stores';
  import { get } from 'svelte/store';
  import {
    config, configLoading, configError, resolveDashboardRoute, loadConfig, dashboardFetches, fetchDashboard,
    hasPartialDashboards, otherDashboards
  } from '$lib/stores/config';
  import { editEntry } from '$lib/stores/editMode';
  import Dashboard from '$lib/components/Dashboard.svelte';
  import DashboardSkeleton from '$lib/components/DashboardSkeleton.svelte';
  import OtherDashboardsStatus from '$lib/components/OtherDashboardsStatus.svelte';

  // Path first, then id.
  let resolved = $derived(
    $config && $page.params.dashboard ? resolveDashboardRoute($page.params.dashboard, $config) : undefined
  );
  // Held only as an index entry (opened before the other dashboards arrived): fetch it on its own.
  // Never rendered meanwhile; a failure shows here, with Retry.
  let fetchFailed = $derived(resolved?.partial === true ? $dashboardFetches[resolved.id] : undefined);
  $effect(() => {
    const d = resolved;
    if (d?.partial === true && !$configLoading && get(dashboardFetches)[d.id] === undefined) void fetchDashboard(d.id);
  });
  // A failed background load never vanishes: a small bar, the open dashboard stays usable. Not
  // while a whole-page error says more, nor when the pencil's own status (+layout) already shows it.
  let backgroundFailed = $derived(
    typeof $otherDashboards === 'object' && hasPartialDashboards($config) && !$configError &&
      !($editEntry && $editEntry.dashboardId === resolved?.id)
  );
</script>

{#if backgroundFailed}
  <div class="background-failure"><OtherDashboardsStatus /></div>
{/if}

{#if $configLoading}
  <DashboardSkeleton />
{:else if $configError}
  <div class="error" role="alert">
    <h1>Error</h1>
    <p>{$configError}</p>
    <button type="button" onclick={() => loadConfig({ dashboard: $page.params.dashboard ?? '' })}>Retry</button>
  </div>
{:else if resolved?.partial === true}
  {#if typeof fetchFailed === 'object'}
    <div class="error" role="alert">
      <h1>Couldn't load {resolved.name}</h1>
      <p>{fetchFailed.error}</p>
      <!-- Index and dashboard again: the failure may be that the dashboard has gone since the index. -->
      <button type="button" onclick={() => loadConfig({ background: true, dashboard: $page.params.dashboard ?? '' })}>Retry</button>
    </div>
  {:else}
    <DashboardSkeleton />
  {/if}
{:else if resolved}
  <Dashboard dashboard={resolved} />
{:else}
  <div class="not-found">
    <h1>Dashboard Not Found</h1>
    <p>The dashboard "/{$page.params.dashboard}" doesn't exist.</p>
    <a href="/">Go Home</a>
  </div>
{/if}

<style>
  .background-failure {
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border);
  }

  .error,
  .not-found {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    text-align: center;
    padding: 2rem;
  }

  .error {
    color: var(--color-error-text);
  }

  .error button,
  .not-found a {
    margin-top: 1rem;
    padding: 0.75rem 1.5rem;
    background: var(--accent-solid);
    color: var(--on-accent);
    border-radius: 0.5rem;
    text-decoration: none;
  }

  .error button {
    min-height: 44px;
    border: none;
    font: inherit;
    cursor: pointer;
  }

  .error button:hover,
  .not-found a:hover {
    background: var(--accent-solid-hover);
  }
</style>
