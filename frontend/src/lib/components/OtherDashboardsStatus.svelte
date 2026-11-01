<script lang="ts">
  // Where the background load of the other dashboards stands, for anything that needs every
  // dashboard (search across them, Settings): "Loading…", or "Couldn't load…" with Retry. Shows
  // nothing once they have arrived. Used only while the store holds index entries.
  import { otherDashboards, retryOtherDashboards } from '$lib/stores/config';

  let { onRetry = retryOtherDashboards }: { onRetry?: () => unknown } = $props();
</script>

{#if $otherDashboards === 'loading'}
  <p class="other-dashboards" role="status">Loading the other dashboards…</p>
{:else if typeof $otherDashboards === 'object'}
  <div class="other-dashboards failed" role="alert">
    <span>Couldn't load the other dashboards: {$otherDashboards.error}</span>
    <button type="button" class="btn-secondary" onclick={() => void onRetry()}>Retry</button>
  </div>
{/if}

<style>
  .other-dashboards {
    margin: 0;
    padding: 0.6rem 1.1rem;
    color: var(--text-secondary);
    font-size: 0.9rem;
  }
  .failed {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 0.5rem;
    color: var(--color-error-text);
  }
  .failed button {
    min-height: 44px;
  }
</style>
