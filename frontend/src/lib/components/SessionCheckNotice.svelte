<script lang="ts">
  import Icon from '@iconify/svelte';
  import { authFailure, initAuth } from '$lib/stores/auth';

  // Shown on a page that needs a session when the check couldn't say whether there is one. The two
  // causes read differently: "can't reach" is only said when that is what happened. Sign in is
  // always here, so no cause leaves a dead end: Settings may be the only remedy for what went wrong.
  let { waiting, onSignIn }: { waiting: string; onSignIn: () => void } = $props();
</script>

<div class="session-notice" role="alert">
  <Icon icon={$authFailure === null ? 'mdi:cloud-off-outline' : 'mdi:alert-circle-outline'} width="24" />
  <div class="words">
    {#if $authFailure === null}
      <strong>Can't reach the server</strong>
      <span>{waiting}</span>
    {:else}
      <strong>Couldn't check your sign-in</strong>
      <span>{$authFailure}</span>
    {/if}
  </div>
  <div class="actions">
    <button type="button" onclick={() => initAuth()}>Retry</button>
    <button type="button" onclick={onSignIn}>Sign in</button>
  </div>
</div>

<style>
  .session-notice {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.75rem;
    padding: 0.75rem 1rem;
    margin-bottom: 1rem;
    border: 1px solid #b45309;
    border-radius: 0.5rem;
    background: var(--bg-secondary);
    color: var(--text-primary);
  }
  .words {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    flex: 1 1 14rem;
    min-width: 0;
  }
  .words span {
    color: var(--text-secondary);
    overflow-wrap: anywhere;
  }
  .actions {
    display: flex;
    gap: 0.5rem;
  }
</style>
