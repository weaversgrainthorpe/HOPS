<script lang="ts">
  import { config, migrationNoticesDismissed, noticesStale, dismissServerNotice } from '$lib/stores/config';
  import { toast } from '$lib/stores/toast';
  import { logError } from '$lib/utils/errors';
  import Icon from '@iconify/svelte';

  // Two kinds of notice (M4 Task 7):
  // - the startup migration's id renames (`migrationNotices`): dismissed for this session only;
  // - the server's one-time notices (`notices`, e.g. the layered status checks change):
  //   Dismiss is stored on the server (POST), so the notice hides only once that succeeded.
  let renames = $derived($config?.migrationNotices ?? []);
  let serverNotices = $derived($config?.notices ?? []);
  let unreadable = $derived($config?.noticesUnreadable ?? 0);
  let dismissing = $state<Record<string, boolean>>({});

  async function dismiss(id: string) {
    if (dismissing[id]) return;
    dismissing[id] = true;
    try {
      await dismissServerNotice(id);
    } catch (e) {
      logError('Dismiss notice', e);
      toast.error(`Couldn't dismiss the notice: ${e instanceof Error && e.message ? e.message : 'the request failed'}`);
    } finally {
      dismissing[id] = false;
    }
  }
</script>

{#each serverNotices as notice (notice.id)}
  <!-- A warning (e.g. a failed backup) is an alert; a sticky one has no Dismiss: it goes when its
       cause is fixed. -->
  <div
    class="migration-notices server-notice"
    class:warning={notice.level === 'warning'}
    role={notice.level === 'warning' ? 'alert' : 'status'}
    data-notice-id={notice.id}
  >
    <Icon icon={notice.level === 'warning' ? 'mdi:alert-outline' : 'mdi:information-outline'} width="20" />
    <!-- Rendered as text: the server's notice text is never markup. -->
    <div class="text">
      {notice.text}
      <!-- Server data: a link is shown only when its href is a string inside /settings/. -->
      {#if typeof notice.link?.href === 'string' && notice.link.href.startsWith('/settings/')}
        <a class="notice-link" href={notice.link.href}>{notice.link.label}</a>
      {/if}
      {#if $noticesStale}
        <em class="stale">This notice may be out of date: it couldn't be refreshed after your last change ({$noticesStale}). Reload the page to update it.</em>
      {/if}
    </div>
    {#if !notice.sticky}
      <button
        type="button"
        class="dismiss"
        disabled={dismissing[notice.id]}
        onclick={() => dismiss(notice.id)}
      >
        Dismiss
      </button>
    {/if}
  </div>
{/each}

{#if unreadable > 0}
  <div class="migration-notices unreadable" role="alert">
    <Icon icon="mdi:alert-outline" width="20" />
    <div class="text">
      {unreadable === 1 ? '1 notice' : `${unreadable} notices`} from the server couldn't be read by this page, so
      {unreadable === 1 ? 'it is' : 'they are'} not shown. Reload the page; if it persists, check the server log.
    </div>
  </div>
{/if}

<!-- The startup migration renamed duplicate ids. Nothing was lost, but links or
     bookmarks to the old ids may need updating, so say exactly what changed. -->
{#if renames.length > 0 && !$migrationNoticesDismissed}
  <div class="migration-notices" role="status">
    <Icon icon="mdi:information-outline" width="20" />
    <div class="text">
      <strong>Some ids were renamed when your configuration was upgraded.</strong>
      Nothing was removed; the following items now have new ids:
      <ul>
        {#each renames as notice (notice)}
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

  /* A problem: dark amber, light text (#fef3c7 on #78350f ≈ 9:1). */
  .migration-notices.warning {
    background: linear-gradient(180deg, #78350f 0%, #92400e 100%);
    color: #fef3c7;
    border-color: #f59e0b;
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

  .notice-link {
    color: inherit;
    font-weight: 600;
    text-decoration: underline;
    white-space: nowrap;
  }

  .stale {
    display: block;
    margin-top: 0.3rem;
    color: #fde68a;
  }

  .dismiss:disabled {
    opacity: 0.6;
    cursor: default;
  }

  @media (max-width: 600px) {
    .migration-notices {
      font-size: 0.85rem;
      padding: 0.6rem 0.75rem;
    }
  }
</style>
