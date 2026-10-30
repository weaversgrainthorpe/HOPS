<script lang="ts">
  import { migrationFailure, migrationFailureKind } from '$lib/stores/config';
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
     restoring the pre-v3-migration backup in v3 would only be migrated again, so the remedy is
     HOPS 2.2.1 (with that backup) and a report. A stored config that can't be read at all is
     not known to be HOPS 2 data, so no pre-v3 copy exists: a recent backup is the remedy. -->
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
  {#if $migrationFailureKind === 'backup'}
    <p>
      HOPS could not save a copy of your HOPS 2 data first, so it converted nothing. Your data is
      untouched, and HOPS 2.2.1 opens it as before. Fix the cause in the message above (often disk
      space, or HOPS not being allowed to write to its backups folder), then start HOPS 3 again.
    </p>
  {:else if $migrationFailureKind === 'corrupt'}
    <p>
      The stored configuration can't be read. Restore a recent backup (Settings › Backups); HOPS
      takes one before every change, in its backups folder. HOPS has not converted or replaced
      anything.
    </p>
  {:else if $migrationFailureKind === 'layout'}
    <p>
      This data is from a pre-release build of HOPS 3, which has no update path. The message above
      says what to do.
    </p>
  {:else}
    <p>
      To keep using HOPS meanwhile, go back to HOPS 2.2.1. Before upgrading, HOPS saved a
      complete copy of your HOPS 2 data in its backups folder (the file whose name ends in
      <code>pre-v3-migration.db</code>), and HOPS 2.2.1 can restore it.
    </p>
  {/if}
  <p>
    Please report the problem, with the message above, at
    <a href="https://github.com/weaversgrainthorpe/HOPS/issues" rel="noopener noreferrer" target="_blank">github.com/weaversgrainthorpe/HOPS/issues</a>.
    {#if signedIn}
      Your backups are also listed in <a class="open-backups" href="/settings/backups">Settings › Backups</a>.
    {:else if onSettingsPage}
      Signed in, your backups are listed under Backups on this page.
    {:else}
      Signed in, your backups are listed in <a href="/settings">Settings › Backups</a>.
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
