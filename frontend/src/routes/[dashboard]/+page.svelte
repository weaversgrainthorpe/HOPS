<script lang="ts">
  import { page } from '$app/stores';
  import { config, configLoading, configError } from '$lib/stores/config';
  import Dashboard from '$lib/components/Dashboard.svelte';
  import DashboardSkeleton from '$lib/components/DashboardSkeleton.svelte';
  import { findDashboard } from '$lib/stores/config';

  let dashboard = $derived($config && $page.params.dashboard ? findDashboard($page.params.dashboard, $config) : undefined);

  // Create a reactive key based on the entire dashboard structure to force re-render on any change
  let dashboardKey = $derived(dashboard ? JSON.stringify(dashboard) : '');
</script>

{#if $configLoading}
  <DashboardSkeleton />
{:else if $configError}
  <div class="error">
    <h1>Error</h1>
    <p>{$configError}</p>
  </div>
{:else if dashboard}
  {#key dashboardKey}
    <Dashboard {dashboard} />
  {/key}
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
    color: #ef4444;
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
