<script lang="ts">
  import { migrationFailure } from '$lib/stores/config';
  import StatusOverrides from '$lib/components/admin/StatusOverrides.svelte';

  // Settings → Dashboards → Status check overrides: its own page under the Dashboards sub-menu.
</script>

{#if $migrationFailure}
  <h2 class="section-title">Status check overrides</h2>
  <!-- Never an empty result as if all were well: the dashboards can't be read right now. -->
  <p class="error">The status check overrides can't be shown until the configuration is restored from a backup (above).</p>
{:else}
  <StatusOverrides />
{/if}

<style>
  .error {
    color: var(--color-error, #ef4444);
  }
</style>
