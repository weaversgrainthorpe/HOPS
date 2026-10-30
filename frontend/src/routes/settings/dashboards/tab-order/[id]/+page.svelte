<script lang="ts">
  import { page } from '$app/stores';
  import { migrationFailure } from '$lib/stores/config';
  import TabOrder from '$lib/components/admin/TabOrder.svelte';

  // Settings → Dashboards → Tab order: its own page for one dashboard's tab order.
  const id = $derived($page.params.id ?? '');
</script>

{#if $migrationFailure}
  <h2 class="section-title">Tab order</h2>
  <!-- Never an empty result as if all were well: the dashboards can't be read right now. -->
  <p class="error">The tab order can't be shown until the configuration is restored from a backup (above).</p>
{:else}
  {#key id}
    <TabOrder dashboardId={id} />
  {/key}
{/if}

<style>
  .error {
    color: var(--color-error, #ef4444);
  }
</style>
