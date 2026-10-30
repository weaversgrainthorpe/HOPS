<script lang="ts">
  import { goto } from '$app/navigation';
  import Icon from '@iconify/svelte';
  import { isBackendOffline, backendStatus } from '$lib/stores/backendStatus';
  import {
    config, configLoading, configError, migrationFailure, dashboards, dashboardHref, loadConfig
  } from '$lib/stores/config';
  import MigrationFailed from '$lib/components/MigrationFailed.svelte';
  import Button from '$lib/components/shared/Button.svelte';

  // "/" shows a dashboard: it forwards to the first one, in display order. The admin
  // home is Settings (the gear). Every other state says what it is — a load that failed is never
  // shown as "no dashboards", and an old document held after a failed reload is never followed.
  let first = $derived(
    !$configLoading && !$configError && !$migrationFailure && $config ? $dashboards[0] : undefined
  );
  let redirected = false;
  // A redirect that fails (an aborted navigation, a route that won't load) is shown, with a plain
  // link to the dashboard — never "Opening…" forever.
  let redirectError = $state<string | null>(null);

  $effect(() => {
    if (first && !redirected) {
      redirected = true;
      goto(dashboardHref(first.path), { replaceState: true }).catch((e: unknown) => {
        redirectError = e instanceof Error && e.message ? e.message : 'the page could not be opened';
      });
    }
  });
</script>

<div class="home">
  {#if $migrationFailure}
    <MigrationFailed />
  {:else if $configLoading}
    <p class="muted" role="status">Loading dashboards…</p>
  {:else if $configError || !$config}
    <div class="card load-failed" role="alert">
      <Icon icon={$isBackendOffline ? 'mdi:cloud-off-outline' : 'mdi:alert-circle-outline'} width="32" />
      <h1>Couldn't load your dashboards</h1>
      <p>{$configError ?? 'The configuration has not been loaded.'}</p>
      {#if $backendStatus.status === 'offline'}
        <p class="muted">The HOPS server can't be reached. Check that it's running and your network is up.</p>
      {:else if $backendStatus.status === 'error'}
        <p class="muted">The HOPS server was reached but answered with an error. Check its logs.</p>
      {/if}
      <div class="actions">
        <Button variant="primary" icon="mdi:refresh" onclick={() => { backendStatus.check(); void loadConfig(); }}>
          Retry
        </Button>
      </div>
    </div>
  {:else if first && redirectError}
    <div class="card load-failed" role="alert">
      <Icon icon="mdi:alert-circle-outline" width="32" />
      <h1>Couldn't open {first.name}</h1>
      <p>{redirectError}</p>
      <div class="actions">
        <a class="btn-primary" href={dashboardHref(first.path)} data-sveltekit-reload>Open {first.name}</a>
      </div>
    </div>
  {:else if first}
    <p class="muted" role="status">Opening {first.name}…</p>
  {:else}
    <div class="card empty">
      <Icon icon="mdi:view-dashboard-outline" width="40" />
      <h1>No dashboards yet</h1>
      <p>Create your first dashboard in Settings.</p>
      <div class="actions">
        <Button variant="primary" icon="mdi:cog" onclick={() => goto('/settings')}>Open Settings</Button>
      </div>
    </div>
  {/if}
</div>

<style>
  .home {
    min-height: calc(100vh - 70px);
    padding: 2rem 1rem;
  }

  .card {
    max-width: 440px;
    margin: 4rem auto 0;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
  }

  .card :global(svg) {
    color: var(--text-secondary);
  }

  .load-failed :global(svg) {
    color: var(--color-error, #ef4444);
  }

  h1 {
    margin: 0;
    font-size: var(--font-h1);
  }

  p {
    margin: 0;
    color: var(--text-secondary);
  }

  .actions {
    margin: 0.5rem 0;
  }

  .muted {
    text-align: center;
    color: var(--text-secondary);
    margin-top: 4rem;
  }

  .card .muted {
    margin-top: 0;
  }
</style>
