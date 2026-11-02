<script lang="ts">
  import { isOffline, offlineSinceLabel } from '$lib/stores/network';
  import { configReadRunning, keptFailure, retryLoadForPage, showingKept } from '$lib/stores/config';
  import { pageUnsaved, session } from '$lib/stores/editSession';
  import Icon from '@iconify/svelte';

  let retrying = $state(false);

  async function retry() {
    if (configReadRunning()) return;
    retrying = true;
    await retryLoadForPage();
    retrying = false;
  }
</script>

{#if $isOffline}
  <div class="offline-banner" role="status" aria-live="polite">
    <Icon icon="mdi:cloud-off-outline" width="20" />
    <span class="text">
      You're offline.
      {#if $offlineSinceLabel}
        <span class="since">Last reachable {$offlineSinceLabel}.</span>
      {/if}
      Tiles below show their last known status.
    </span>
  </div>
{:else if $showingKept}
  <!-- The server answers (or hasn't failed a probe yet), but this page is still a saved copy. -->
  <div class="offline-banner" role="status" aria-live="polite">
    <Icon icon="mdi:cloud-off-outline" width="20" />
    <span class="text">
      This is a saved copy, and may be out of date.
      {#if $keptFailure}Couldn't update it: {$keptFailure}.{:else}HOPS will update it when it can.{/if}
    </span>
    <!-- Open edits are never re-read under the person making them (see outageRecovery). -->
    {#if $keptFailure && $session === null && !$pageUnsaved}
      <button type="button" class="retry" disabled={retrying} onclick={retry}>Retry</button>
    {/if}
  </div>
{/if}

<style>
  .offline-banner {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.55rem 1rem;
    background: linear-gradient(180deg, #78350f 0%, #92400e 100%);
    color: #fef3c7;
    font-size: 0.9rem;
    border-bottom: 1px solid #b45309;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
  }

  .text {
    line-height: 1.4;
  }

  .retry {
    flex: none;
    margin-left: auto;
    padding: 0.2rem 0.75rem;
    border: 1px solid currentColor;
    background: none;
    color: inherit;
  }

  .retry:hover:not(:disabled) {
    background: rgba(0, 0, 0, 0.2);
  }

  .since {
    opacity: 0.85;
    margin: 0 0.25rem;
  }

  @media (max-width: 600px) {
    .offline-banner {
      font-size: 0.85rem;
      padding: 0.45rem 0.75rem;
    }
  }
</style>
