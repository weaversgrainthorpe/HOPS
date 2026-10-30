<script lang="ts">
  import { migrationFailure } from '$lib/stores/config';
  import BlockedStatusChecks from '$lib/components/admin/BlockedStatusChecks.svelte';

  // Settings → Dashboards → Blocked status checks: its own page under the Dashboards sub-menu.
</script>

{#if $migrationFailure}
  <h2 class="section-title">Blocked status checks</h2>
  <!-- Never an empty result as if all were well: the dashboards can't be read right now. -->
  <p class="error">The blocked status checks can't be shown until the configuration is restored from a backup (above).</p>
{:else}
  <BlockedStatusChecks />
{/if}

<style>
  .error {
    color: var(--color-error, #ef4444);
  }
</style>
