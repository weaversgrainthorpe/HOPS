<script lang="ts">
  import { dashboards, configLoading, configError } from '$lib/stores/config';
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';

  onMount(() => {
    // Redirect to first dashboard if available
    const unsubscribe = dashboards.subscribe(($dashboards) => {
      if ($dashboards.length > 0) {
        const defaultDashboard = $dashboards[0];
        goto(defaultDashboard.path);
      }
    });

    return unsubscribe;
  });
</script>

{#if $configLoading}
  <div class="loading">
    <p>Loading HOPS...</p>
  </div>
{:else if $configError}
  <div class="error">
    <h1>Error Loading Configuration</h1>
    <p>{$configError}</p>
  </div>
{:else}
  <div class="welcome">
    <h1>HOPS</h1>
    <p>Home Operations Portal System</p>
    <p class="hint">No dashboards configured. Visit <a href="/admin">/admin</a> to get started.</p>
  </div>
{/if}

<style>
  .loading,
  .error,
  .welcome {
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

  .hint {
    margin-top: 2rem;
    opacity: 0.7;
  }

  a {
    color: #3b82f6;
    text-decoration: none;
  }

  a:hover {
    text-decoration: underline;
  }
</style>
