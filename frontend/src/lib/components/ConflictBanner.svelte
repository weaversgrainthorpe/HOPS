<script lang="ts">
  import { saveConflict, loadConfig } from '$lib/stores/config';
  import { sessionConflict, keepEditingAfterConflict, reloadAfterConflict } from '$lib/stores/editSession';
  import Icon from '@iconify/svelte';

  let reloading = $state(false);

  // Reload re-reads the server's config. loadConfig() clears saveConflict
  // only when the reload succeeds, so a failed reload keeps the banner up.
  async function reload() {
    reloading = true;
    try {
      await loadConfig();
    } finally {
      reloading = false;
    }
  }

  // An edit session's save was refused: the draft is still held. Reload ends
  // the session (the draft is lost) and reloads; Keep editing hides this
  // message and leaves the draft and session exactly as they are.
  async function reloadSession() {
    reloading = true;
    try {
      await reloadAfterConflict();
    } finally {
      reloading = false;
    }
  }
</script>

<!-- A save was rejected because the dashboard changed elsewhere. Deliberately
     NOT dismissible: the only way out is Reload, so an unsaved change can
     never be mistaken for a saved one. -->
{#if $sessionConflict}
  <div class="conflict-banner" role="alert">
    <Icon icon="mdi:alert-outline" width="20" />
    <span class="text">
      This dashboard was changed somewhere else, so your changes were <strong>not</strong> saved.
    </span>
    <button type="button" class="reload" onclick={reloadSession} disabled={reloading}>
      {reloading ? 'Reloading…' : 'Reload (lose my draft)'}
    </button>
    <button type="button" class="keep" onclick={keepEditingAfterConflict} disabled={reloading}>
      Keep editing
    </button>
  </div>
{:else if $saveConflict}
  <div class="conflict-banner" role="alert">
    <Icon icon="mdi:alert-outline" width="20" />
    <span class="text">
      This dashboard was changed somewhere else, so your last change was <strong>not</strong> saved.
    </span>
    <button type="button" class="reload" onclick={reload} disabled={reloading}>
      {reloading ? 'Reloading…' : 'Reload'}
    </button>
  </div>
{/if}

<style>
  .conflict-banner {
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
    flex: 1;
  }

  .reload {
    padding: 0.25rem 0.8rem;
    border-radius: 0.25rem;
    border: 1px solid #fecaca;
    background: #fee2e2;
    color: #7f1d1d;
    font-weight: 600;
    cursor: pointer;
  }

  .keep {
    padding: 0.25rem 0.8rem;
    border-radius: 0.25rem;
    border: 1px solid #fecaca;
    background: transparent;
    color: #fee2e2;
    font-weight: 600;
    cursor: pointer;
  }

  .reload:disabled,
  .keep:disabled {
    opacity: 0.6;
    cursor: wait;
  }

  @media (max-width: 600px) {
    .conflict-banner {
      flex-wrap: wrap;
      font-size: 0.85rem;
      padding: 0.45rem 0.75rem;
    }
  }
</style>
