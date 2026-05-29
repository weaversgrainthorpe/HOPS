<script lang="ts">
  import { isOffline, offlineSinceLabel } from '$lib/stores/network';
  import Icon from '@iconify/svelte';
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
