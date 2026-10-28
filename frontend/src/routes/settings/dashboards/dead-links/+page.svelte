<script lang="ts">
  import { migrationFailure } from '$lib/stores/config';
  import DeadLinks from '$lib/components/admin/DeadLinks.svelte';

  // Settings → Dashboards → Dead links: its own page under the Dashboards sub-menu.
</script>

{#if $migrationFailure}
  <h2 class="section-title">Dead links</h2>
  <!-- Never an empty result as if all were well: the dashboards can't be read right now. -->
  <p class="error">The dead links check can't be shown until the configuration is restored from a backup (above).</p>
{:else}
  <DeadLinks />
{/if}

<style>
  .error {
    color: var(--color-error, #ef4444);
  }
</style>
