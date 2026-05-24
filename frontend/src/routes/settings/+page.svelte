<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import Icon from '@iconify/svelte';
  import Button from '$lib/components/shared/Button.svelte';
  import { toast } from '$lib/stores/toast';
  import { isAuthenticated } from '$lib/stores/auth';
  import { listSettings, updateSetting, type SettingDef } from '$lib/utils/api';

  // Settings are grouped by the dotted prefix of their key — server.*, log.*,
  // proxy.*, auth.*, status.*, upload.*, http.*. The labels here drive the
  // section headings rendered below.
  const groupLabels: Record<string, string> = {
    server: 'Server',
    log: 'Logging',
    proxy: 'Reverse proxy',
    auth: 'Authentication',
    status: 'Status checks',
    upload: 'Uploads',
    http: 'HTTP server timeouts',
  };

  let settings = $state<SettingDef[]>([]);
  let drafts = $state<Record<string, string>>({});
  let savingKey = $state<string | null>(null);
  let perKeyError = $state<Record<string, string>>({});
  let loadError = $state('');
  let loading = $state(true);

  // Group settings by the prefix before the first '.'.
  let grouped = $derived(
    Object.entries(
      settings.reduce<Record<string, SettingDef[]>>((acc, s) => {
        const group = s.key.split('.')[0];
        (acc[group] ??= []).push(s);
        return acc;
      }, {})
    )
  );

  onMount(async () => {
    // The page is admin-only — bounce to the admin login if not signed in.
    if (!$isAuthenticated) {
      goto('/');
      return;
    }
    try {
      const { settings: list } = await listSettings();
      settings = list;
      drafts = Object.fromEntries(list.map((s) => [s.key, s.value]));
    } catch (e) {
      loadError = e instanceof Error ? e.message : 'Failed to load settings';
    } finally {
      loading = false;
    }
  });

  function isDirty(s: SettingDef): boolean {
    return drafts[s.key] !== s.value;
  }

  async function save(s: SettingDef) {
    const value = drafts[s.key];
    perKeyError[s.key] = '';
    savingKey = s.key;
    try {
      await updateSetting(s.key, value);
      // Update the in-memory record so the dirty indicator clears.
      settings = settings.map((x) => (x.key === s.key ? { ...x, value } : x));
      toast.success(
        s.restartRequired
          ? `Saved — restart HOPS for ${formatKey(s.key)} to take effect.`
          : `Saved ${formatKey(s.key)}.`
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Save failed';
      perKeyError[s.key] = msg;
      toast.error(msg);
    } finally {
      savingKey = null;
    }
  }

  function reset(s: SettingDef) {
    drafts[s.key] = s.value;
    perKeyError[s.key] = '';
  }

  function resetToDefault(s: SettingDef) {
    drafts[s.key] = s.default;
  }

  // Pretty-print a dotted key for messages: "auth.session_lifetime_hours" → "auth · session lifetime hours".
  function formatKey(key: string): string {
    return key.replace(/\./g, ' · ').replace(/_/g, ' ');
  }

  // Friendly per-setting label for the form row.
  function labelFor(key: string): string {
    const tail = key.split('.').slice(1).join('.');
    return tail.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }
</script>

<div class="settings-page">
  <header class="page-header">
    <div class="title-row">
      <Button variant="ghost" icon="mdi:arrow-left" onclick={() => goto('/')}>Back to admin</Button>
      <h1>Settings</h1>
    </div>
    <p class="lede">
      Configure HOPS at runtime. Most settings apply immediately; a few are
      marked <span class="restart-pill">Restart required</span> — they only
      take effect after the server restarts.
    </p>
  </header>

  {#if loading}
    <p class="muted">Loading…</p>
  {:else if loadError}
    <p class="error">Failed to load settings: {loadError}</p>
  {:else}
    {#each grouped as [groupKey, items] (groupKey)}
      <section class="group">
        <h2>{groupLabels[groupKey] ?? groupKey}</h2>
        <div class="rows">
          {#each items as s (s.key)}
            <div class="row" class:dirty={isDirty(s)}>
              <div class="row-label">
                <div class="label-text">
                  {labelFor(s.key)}
                  {#if s.restartRequired}
                    <span class="restart-pill" title="Takes effect on next restart">
                      <Icon icon="mdi:restart" width="12" /> Restart
                    </span>
                  {/if}
                </div>
                <div class="desc">{s.description}</div>
                <div class="meta">
                  <code>{s.key}</code>
                  · default <code>{s.default}</code>
                  {#if s.min !== undefined && s.min !== 0}· min {s.min}{/if}
                  {#if s.max !== undefined && s.max !== 0}· max {s.max}{/if}
                </div>
              </div>
              <div class="row-input">
                {#if s.type === 'log_level' && s.enum}
                  <select bind:value={drafts[s.key]}>
                    {#each s.enum as opt (opt)}
                      <option value={opt}>{opt}</option>
                    {/each}
                  </select>
                {:else if s.type === 'cidr_list'}
                  <textarea
                    bind:value={drafts[s.key]}
                    placeholder='e.g. ["10.0.0.0/8","192.168.1.5/32"] — JSON string array, empty array if no proxy'
                    rows="3"
                  ></textarea>
                {:else}
                  <input
                    type="number"
                    bind:value={drafts[s.key]}
                    min={s.min || undefined}
                    max={s.max || undefined}
                  />
                {/if}
                {#if perKeyError[s.key]}
                  <div class="error inline">{perKeyError[s.key]}</div>
                {/if}
                <div class="row-actions">
                  <Button
                    variant="primary"
                    onclick={() => save(s)}
                    disabled={!isDirty(s) || savingKey === s.key}
                  >
                    {savingKey === s.key ? 'Saving…' : 'Save'}
                  </Button>
                  <Button
                    variant="ghost"
                    onclick={() => reset(s)}
                    disabled={!isDirty(s)}
                  >
                    Revert
                  </Button>
                  {#if drafts[s.key] !== s.default}
                    <Button variant="ghost" onclick={() => resetToDefault(s)}>
                      Reset to default
                    </Button>
                  {/if}
                </div>
              </div>
            </div>
          {/each}
        </div>
      </section>
    {/each}
  {/if}
</div>

<style>
  .settings-page {
    max-width: 960px;
    margin: 0 auto;
    padding: 2rem 1.5rem 4rem;
    color: var(--text-primary);
  }

  .page-header {
    margin-bottom: 2rem;
  }

  .title-row {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 0.75rem;
  }

  h1 {
    margin: 0;
    font-size: 1.75rem;
  }

  .lede {
    color: var(--text-secondary);
    max-width: 640px;
    margin: 0;
  }

  .group {
    margin-bottom: 2.5rem;
  }

  .group h2 {
    margin: 0 0 0.75rem;
    font-size: 1.15rem;
    color: var(--accent);
    border-bottom: 1px solid var(--border);
    padding-bottom: 0.4rem;
  }

  .rows {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(280px, 380px);
    gap: 1.5rem;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    padding: 1rem 1.25rem;
    align-items: start;
  }

  .row.dirty {
    border-color: var(--accent);
  }

  .row-label .label-text {
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .desc {
    color: var(--text-secondary);
    font-size: 0.92rem;
    margin: 0.25rem 0 0.5rem;
  }

  .meta {
    color: var(--text-tertiary, var(--text-secondary));
    font-size: 0.78rem;
  }
  .meta code {
    background: var(--bg-tertiary);
    padding: 0 0.3em;
    border-radius: 3px;
  }

  .row-input {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .row-input input,
  .row-input textarea,
  .row-input select {
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 0.375rem;
    color: var(--text-primary);
    padding: 0.5rem 0.65rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.95rem;
    width: 100%;
  }

  .row-input textarea {
    resize: vertical;
  }

  .row-actions {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .restart-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    background: rgba(245, 158, 11, 0.15);
    color: #f59e0b;
    border: 1px solid rgba(245, 158, 11, 0.4);
    padding: 0.1rem 0.5rem;
    border-radius: 999px;
    font-size: 0.72rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .error {
    color: var(--color-error, #ef4444);
  }
  .error.inline {
    font-size: 0.85rem;
  }

  .muted {
    color: var(--text-secondary);
  }

  @media (max-width: 720px) {
    .row {
      grid-template-columns: 1fr;
    }
  }
</style>
