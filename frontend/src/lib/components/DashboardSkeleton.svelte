<script lang="ts">
  /**
   * Skeleton loading state for dashboard content
   * Shows placeholder tiles while dashboard data is loading
   */
  import Skeleton from './Skeleton.svelte';

  interface Props {
    /** Number of groups to show */
    groups?: number;
    /** Number of tiles per group */
    tilesPerGroup?: number;
  }

  let { groups = 2, tilesPerGroup = 6 }: Props = $props();
</script>

<div class="dashboard-skeleton">
  <div class="skeleton-header">
    <Skeleton width="200px" height="2rem" radius="0.5rem" />
  </div>

  <div class="skeleton-content">
    {#each Array(groups) as _, groupIndex}
      <div class="skeleton-group">
        <div class="skeleton-group-header">
          <Skeleton width="150px" height="1.5rem" />
          <Skeleton width="24px" height="24px" radius="50%" />
        </div>
        <div class="skeleton-tiles">
          {#each Array(tilesPerGroup) as _, tileIndex}
            <div class="skeleton-tile">
              <Skeleton width="48px" height="48px" radius="0.5rem" />
              <Skeleton width="80%" height="1rem" />
              <Skeleton width="60%" height="0.75rem" />
            </div>
          {/each}
        </div>
      </div>
    {/each}
  </div>
</div>

<style>
  .dashboard-skeleton {
    padding: 2rem;
    min-height: 400px;
    background: rgba(15, 23, 42, 0.7);
  }

  .skeleton-header {
    margin-bottom: 2rem;
    padding: 1rem 2rem;
    background: rgba(15, 23, 42, 0.8);
    border-radius: 0.5rem;
  }

  .skeleton-content {
    display: flex;
    flex-direction: column;
    gap: 2rem;
  }

  .skeleton-group {
    background: var(--bg-secondary);
    border-radius: 0.5rem;
    padding: 1rem;
  }

  .skeleton-group-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
    padding: 0.5rem;
  }

  .skeleton-tiles {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 1rem;
  }

  .skeleton-tile {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    padding: 1.5rem;
    background: var(--bg-tertiary);
    border-radius: 0.5rem;
    min-height: 150px;
  }
</style>
