<script lang="ts">
  import { uiVersionMismatch } from '$lib/stores/network';
  import Icon from '@iconify/svelte';

  const uiVersion = __APP_VERSION__;
</script>

<!-- The UI bundle and the server disagree on version: the page is an old
     copy (a reload or a cleared cache fixes it). In a dev build it can also be
     a stale on-disk UI. Never let that pass silently. -->
{#if $uiVersionMismatch}
  <div class="version-banner" role="alert">
    <Icon icon="mdi:alert-outline" width="20" />
    <span class="text">
      This page is HOPS <strong>v{uiVersion}</strong> but the server is
      <strong>v{$uiVersionMismatch}</strong>. Reload the page. If this stays, a cache
      is keeping an old copy (the browser's, or a proxy in front of HOPS): clear it
      for this site, then reload.
    </span>
  </div>
{/if}

<style>
  .version-banner {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.55rem 1rem;
    background: linear-gradient(180deg, #7f1d1d 0%, #991b1b 100%);
    color: #fee2e2;
    font-size: 0.9rem;
    border-bottom: 1px solid #b91c1c;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
  }

  .text {
    line-height: 1.4;
  }

  code {
    background: rgba(0, 0, 0, 0.25);
    padding: 0 0.3rem;
    border-radius: 0.25rem;
  }

  @media (max-width: 600px) {
    .version-banner {
      font-size: 0.85rem;
      padding: 0.45rem 0.75rem;
    }
  }
</style>
