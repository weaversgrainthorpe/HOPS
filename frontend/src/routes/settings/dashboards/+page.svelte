<script lang="ts">
  import Icon from '@iconify/svelte';
  import { migrationFailure } from '$lib/stores/config';
  import DashboardList from '$lib/components/admin/DashboardList.svelte';
  import AddToHopsBookmark from '$lib/components/admin/AddToHopsBookmark.svelte';

  // Settings → Dashboards: add, rename, reorder, delete, import and export.
</script>

{#if $migrationFailure}
  <h2 class="section-title">Dashboards</h2>
  <!-- Never an empty list as if there were no dashboards: they can't be read right now. -->
  <p class="error">Your dashboards can't be shown until the configuration is restored from a backup (above).</p>
{:else}
  <!-- Phone-only: editing is hidden under 480px (drag-and-drop is awkward on a phone). -->
  <div class="phone-edit-note">
    <Icon icon="mdi:tablet" width="18" />
    <span>Editing dashboards needs a tablet or desktop — drag-and-drop is awkward on a phone. You can still manage everything else here.</span>
  </div>
  <DashboardList />
  <AddToHopsBookmark />
{/if}

<style>
  .error {
    color: var(--color-error, #ef4444);
  }

  /* Phone-only banner explaining the missing edit pencil. The 480px
     breakpoint matches the navbar rule that hides .edit-toggle. */
  .phone-edit-note {
    display: none;
  }
  @media (max-width: 480px) {
    .phone-edit-note {
      display: flex;
      align-items: flex-start;
      gap: 0.6rem;
      padding: 0.7rem 0.9rem;
      margin: 0 0 1.5rem;
      border: 1px solid var(--border);
      border-left: 3px solid var(--accent);
      border-radius: 0.4rem;
      background: rgba(79, 140, 255, 0.07);
      color: var(--text-secondary);
      font-size: 0.85rem;
      line-height: 1.45;
    }
    .phone-edit-note :global(svg) {
      flex-shrink: 0;
      color: var(--accent-text);
      margin-top: 0.1rem;
    }
  }
</style>
