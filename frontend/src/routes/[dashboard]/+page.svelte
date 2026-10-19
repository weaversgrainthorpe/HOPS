<script lang="ts">
  import { page } from '$app/stores';
  import { config, configLoading, configError, resolveDashboardRoute, loadConfig } from '$lib/stores/config';
  import Dashboard from '$lib/components/Dashboard.svelte';
  import DashboardSkeleton from '$lib/components/DashboardSkeleton.svelte';
  import type { Dashboard as DashboardT } from '$lib/types';

  // Path first across legacy and v3-only dashboards, then id.
  let resolved = $derived(
    $config && $page.params.dashboard ? resolveDashboardRoute($page.params.dashboard, $config) : undefined
  );
</script>

{#if $configLoading}
  <DashboardSkeleton />
{:else if $configError}
  <div class="error">
    <h1>Error</h1>
    <p>{$configError}</p>
  </div>
{:else if resolved?.kind === 'legacy'}
  <Dashboard dashboard={resolved.dashboard} />
{:else if resolved?.kind === 'v3only'}
  <!-- A v3-only dashboard renders view-only from the layout doc (same header/tab keys). -->
  <Dashboard dashboard={resolved.dashboard as unknown as DashboardT} v3Only />
{:else if resolved?.kind === 'missing-layout'}
  <div class="error" role="alert">
    <h1>{resolved.name}</h1>
    <p>Layout data missing for this dashboard — reload</p>
    <button type="button" onclick={() => loadConfig()}>Reload</button>
  </div>
{:else}
  <div class="not-found">
    <h1>Dashboard Not Found</h1>
    <p>The dashboard "/{$page.params.dashboard}" doesn't exist.</p>
    <a href="/">Go Home</a>
  </div>
{/if}

<style>
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

  .not-found a {
    margin-top: 1rem;
    padding: 0.75rem 1.5rem;
    background: var(--accent);
    color: white;
    border-radius: 0.5rem;
    text-decoration: none;
  }

  .not-found a:hover {
    background: var(--accent-hover);
  }
</style>
