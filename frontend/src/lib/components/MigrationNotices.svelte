<script lang="ts">
  import { config, migrationNoticesDismissed } from '$lib/stores/config';
  import Icon from '@iconify/svelte';

  let notices = $derived($config?.migrationNotices ?? []);
</script>

<!-- The startup migration renamed duplicate ids. Nothing was lost, but links or
     bookmarks to the old ids may need updating, so say exactly what changed. -->
{#if notices.length > 0 && !$migrationNoticesDismissed}
  <div class="migration-notices" role="status">
    <Icon icon="mdi:information-outline" width="20" />
    <div class="text">
      <strong>Some ids were renamed when your configuration was upgraded.</strong>
      Nothing was removed; the following items now have new ids:
      <ul>
        {#each notices as notice (notice)}
          <li>{notice}</li>
        {/each}
      </ul>
    </div>
    <button type="button" class="dismiss" onclick={() => migrationNoticesDismissed.set(true)}>
      Dismiss
    </button>
  </div>
{/if}

<style>
  .migration-notices {
    display: flex;
    align-items: flex-start;
    gap: 0.6rem;
    margin-bottom: 1rem;
    padding: 0.75rem 1rem;
    background: linear-gradient(180deg, #1e3a8a 0%, #1e40af 100%);
    color: #dbeafe;
    font-size: 0.9rem;
    border: 1px solid #3b82f6;
    border-radius: 0.5rem;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
  }

  .text {
    line-height: 1.4;
    flex: 1;
  }

  ul {
    margin: 0.4rem 0 0;
    padding-left: 1.2rem;
    word-break: break-word;
  }

  .dismiss {
    padding: 0.25rem 0.8rem;
    border-radius: 0.25rem;
    border: 1px solid #bfdbfe;
    background: #dbeafe;
    color: #1e3a8a;
    font-weight: 600;
    cursor: pointer;
  }

  @media (max-width: 600px) {
    .migration-notices {
      font-size: 0.85rem;
      padding: 0.6rem 0.75rem;
    }
  }
</style>
