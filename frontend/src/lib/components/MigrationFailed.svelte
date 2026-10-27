<script lang="ts">
  import { migrationFailure } from '$lib/stores/config';
  import Icon from '@iconify/svelte';

  interface Props {
    /** Signed in on Settings: link straight to the Backups page. */
    signedIn?: boolean;
    /** Shown on Settings itself (signed out): say to sign in here, not link to this same page. */
    onSettingsPage?: boolean;
  }
  let { signedIn = false, onSettingsPage = false }: Props = $props();
</script>

<!-- Full-page notice shown instead of the app while the stored config could
     not be migrated to v3. The server refuses config requests in this state;
     the automatic pre-v3-migration / startup backups are the remedy (Settings → Backups). -->
<main class="migration-failed" role="alert">
  <Icon icon="mdi:database-alert-outline" width="48" />
  <h1>HOPS couldn't migrate your configuration</h1>
  <p>
    Your stored configuration could not be upgraded, so HOPS has stopped rather than
    risk losing data. Nothing has been changed.
  </p>
  {#if $migrationFailure}
    <pre class="detail">{$migrationFailure}</pre>
  {/if}
  <p>
    Settings → Backups holds the automatic pre-v3-migration and startup backups.
    {#if signedIn}
      <a class="open-backups" href="/settings/backups">Open Backups</a>
    {:else if onSettingsPage}
      Sign in, then open Backups on this page.
    {:else}
      Sign in and restore it from <a href="/settings">Settings → Backups</a>.
    {/if}
  </p>
</main>

<style>
  .migration-failed {
    max-width: 40rem;
    margin: 4rem auto;
    padding: 2rem;
    text-align: center;
    color: #fee2e2;
    background: #7f1d1d;
    border: 1px solid #b91c1c;
    border-radius: 0.5rem;
  }

  h1 {
    font-size: 1.4rem;
    margin: 0.75rem 0;
  }

  .detail {
    text-align: left;
    white-space: pre-wrap;
    word-break: break-word;
    background: rgba(0, 0, 0, 0.3);
    padding: 0.75rem;
    border-radius: 0.25rem;
    font-size: 0.85rem;
  }

  .open-backups {
    display: inline-block;
    text-decoration: none;
    margin-left: 0.5rem;
    padding: 0.3rem 0.9rem;
    border-radius: 0.25rem;
    border: 1px solid #fecaca;
    background: #fee2e2;
    color: #7f1d1d;
    font-weight: 600;
    cursor: pointer;
  }

  a {
    color: #fff;
    font-weight: 600;
    text-decoration: underline;
  }
</style>
