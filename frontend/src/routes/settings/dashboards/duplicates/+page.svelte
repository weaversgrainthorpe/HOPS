<script lang="ts">
  import { migrationFailure } from '$lib/stores/config';
  import Duplicates from '$lib/components/admin/Duplicates.svelte';

  // Settings → Dashboards → Duplicates: its own page under the Dashboards sub-menu.
</script>

{#if $migrationFailure}
  <h2 class="section-title">Duplicates</h2>
  <!-- Never an empty result as if all were well: the dashboards can't be read right now. -->
  <p class="error">The duplicates check can't be shown until the configuration is restored from a backup (above).</p>
{:else}
  <Duplicates />
{/if}

<style>
  .error {
    color: var(--color-error, #ef4444);
  }
</style>
