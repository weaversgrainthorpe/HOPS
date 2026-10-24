<script lang="ts">
  import { page } from '$app/stores';
  import { config, configLoading, configError, resolveDashboardRoute } from '$lib/stores/config';
  import Dashboard from '$lib/components/Dashboard.svelte';
  import DashboardSkeleton from '$lib/components/DashboardSkeleton.svelte';

  // Path first, then id.
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
    background: var(--accent-solid);
    color: var(--on-accent);
    border-radius: 0.5rem;
    text-decoration: none;
  }

  .not-found a:hover {
    background: var(--accent-solid-hover);
  }
</style>
