<script lang="ts">
  import { parkedDraft, discardParked } from '$lib/stores/editSession';
  import { isAuthenticated } from '$lib/stores/auth';
  import { layoutDoc, findLayoutDashboard } from '$lib/stores/config';
  import Icon from '@iconify/svelte';

  const name = $derived(
    $parkedDraft ? (findLayoutDashboard($parkedDraft.dashboardId, $layoutDoc)?.name ?? $parkedDraft.saved.name) : ''
  );
</script>

<!-- Unsaved edit-session changes kept after the user was signed out. Persistent
     until they are restored (Edit on that dashboard) or discarded on purpose. -->
{#if $parkedDraft}
  <div class="parked-banner" role="alert">
    <Icon icon="mdi:content-save-alert-outline" width="20" />
    <span class="text">
      {#if $isAuthenticated}
        Your unsaved changes to <strong>{name}</strong> were kept — open that dashboard and click Edit to save them.
      {:else}
        You were signed out — sign in to save your changes to <strong>{name}</strong>.
      {/if}
    </span>
    <button type="button" class="discard" onclick={() => void discardParked()}>Discard them</button>
  </div>
{/if}

<style>
  .parked-banner {
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
    flex: 1;
  }

  .discard {
    padding: 0.25rem 0.8rem;
    border-radius: 0.25rem;
    border: 1px solid #fde68a;
    background: transparent;
    color: #fef3c7;
    font-weight: 600;
    cursor: pointer;
  }

  @media (max-width: 600px) {
    .parked-banner {
      flex-wrap: wrap;
      font-size: 0.85rem;
      padding: 0.45rem 0.75rem;
    }
  }
</style>
