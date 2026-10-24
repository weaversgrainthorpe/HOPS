<script module lang="ts">
  import { writable } from 'svelte/store';

  // Restart-required tracking. We remember every key the user has saved
  // a value for during this session that requires a restart, so the
  // aggregate banner at the top of the page persists across multiple
  // saves (and across visits to the other settings pages) instead of
  // relying on per-key toasts that disappear after a few seconds.
  // Cleared on page reload (server restart clears it too).
  const pendingRestartKeys = writable<string[]>([]);
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from '@iconify/svelte';
  import Button from '$lib/components/shared/Button.svelte';
  import { toast } from '$lib/stores/toast';
  import { listSettings, type SettingDef } from '$lib/utils/api';
  import { saveGlobalSetting } from '$lib/stores/config';
  import { bytesToMBText, formatMB, parseMBInput } from '$lib/utils/uploadLimits';

  // Settings → Global settings (M5 §9). The settings shell shows this page only once signed in
  // with no pending password change (the server refuses the rest until then), so it loads the
  // settings as soon as it opens.

  // Settings are grouped by the dotted prefix of their key — server.*, log.*,
  // auth.*, status.*, upload.*, http.*. The labels here drive the section
  // headings rendered below. proxy.* keys roll up into Authentication (the
  // proxy.trusted_cidrs setting is auth-adjacent and doesn't earn its own
  // single-row group).
  const groupLabels: Record<string, string> = {
    server: 'Server',
    log: 'Logging',
    auth: 'Authentication',
    editmode: 'Edit mode',
    status: 'Status checks',
    upload: 'Uploads',
    http: 'HTTP server timeouts',
    folders: 'Folders',
    display: 'Display',
    layout: 'Layout',
  };

  let settings = $state<SettingDef[]>([]);
  let drafts = $state<Record<string, string>>({});
  let savingKey = $state<string | null>(null);
  let perKeyError = $state<Record<string, string>>({});
  let loadError = $state('');
  let loading = $state(true);

  // Group settings by the prefix before the first '.'.
  // proxy.* rolls up into auth — a single trusted_cidrs setting doesn't
  // earn its own group, and reverse-proxy context is naturally an
  // authentication concern (it's about deciding which X-Forwarded-For
  // hops to trust during login).
  let grouped = $derived(
    Object.entries(
      settings.reduce<Record<string, SettingDef[]>>((acc, s) => {
        const prefix = s.key.split('.')[0];
        const group = prefix === 'proxy' ? 'auth' : prefix;
        (acc[group] ??= []).push(s);
        return acc;
      }, {})
    )
  );

  onMount(() => {
    void loadSettings();
  });

  async function loadSettings() {
    loading = true;
    loadError = '';
    try {
      const { settings: list } = await listSettings();
      settings = list;
      drafts = Object.fromEntries(list.map((s) => [s.key, shown(s, s.value)]));
    } catch (e) {
      loadError = e instanceof Error ? e.message : 'Failed to load settings';
    } finally {
      loading = false;
    }
  }

  // --- byte-size settings (M5 §10): stored in bytes, shown and typed in MB ---

  // Plain labels: each upload setting is an upper limit on one kind of file.
  const plainLabels: Record<string, string> = {
    'upload.max_bytes_import': 'Largest file you can import',
    'upload.max_bytes_background': 'Largest background image',
    'upload.max_bytes_icon': 'Largest icon file',
  };

  // What the input shows for a stored value: MB for byte sizes, the value itself otherwise.
  function shown(s: SettingDef, value: string): string {
    return s.type === 'bytes' ? bytesToMBText(value) : value;
  }

  // The notice for a value clamped on load (the stored value was outside the new bounds).
  function adjustmentNotice(s: SettingDef): string {
    if (!s.adjustedFrom) return '';
    const from = Number(s.adjustedFrom);
    const to = Number(s.value);
    return from > to
      ? `Lowered from ${formatMB(from)} to the new maximum ${formatMB(to)}.`
      : `Raised from ${formatMB(from)} to the new minimum ${formatMB(to)}.`;
  }

  let adjustedSettings = $derived(settings.filter((s) => s.adjustedFrom));

  function isDirty(s: SettingDef): boolean {
    // A clamped value is saved to acknowledge it, so its Save stays available.
    return String(drafts[s.key]) !== shown(s, s.value) || !!s.adjustedFrom;
  }

  async function save(s: SettingDef) {
    perKeyError[s.key] = '';
    let value = drafts[s.key];
    if (s.type === 'bytes') {
      // Refused here, not sent: below 1 MB, empty or not a number (the server checks too).
      const parsed = parseMBInput(value, { min: s.min, max: s.max });
      if (!parsed.ok) {
        perKeyError[s.key] = parsed.error;
        return;
      }
      value = String(parsed.bytes);
    }
    savingKey = s.key;
    try {
      // Also re-reads what depends on the global values (status-check levels, notices, badges).
      await saveGlobalSetting(s.key, value);
      // Update the in-memory record so the dirty indicator clears.
      settings = settings.map((x) => (x.key === s.key ? { ...x, value, adjustedFrom: undefined } : x));
      drafts[s.key] = shown(s, value);
      if (s.restartRequired && !$pendingRestartKeys.includes(s.key)) {
        $pendingRestartKeys = [...$pendingRestartKeys, s.key];
      }
      toast.success(`Saved ${formatKey(s.key)}.`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Save failed';
      perKeyError[s.key] = msg;
      toast.error(msg);
    } finally {
      savingKey = null;
    }
  }

  function reset(s: SettingDef) {
    drafts[s.key] = shown(s, s.value);
    perKeyError[s.key] = '';
  }

  function resetToDefault(s: SettingDef) {
    drafts[s.key] = shown(s, s.default);
    perKeyError[s.key] = '';
  }

  // Pretty-print a dotted key for messages: "auth.session_lifetime_hours" → "auth · session lifetime hours".
  function formatKey(key: string): string {
    return key.replace(/\./g, ' · ').replace(/_/g, ' ');
  }

  // Friendly per-setting label for the form row.
  function labelFor(key: string): string {
    if (plainLabels[key]) return plainLabels[key];
    const tail = key.split('.').slice(1).join('.');
    return tail.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }

  // --- cidr_list list-builder ---

  // Parse a JSON string array safely. Returns [] for empty/invalid input
  // so the UI can always render a list rather than crash on bad state.
  function parseCidrList(raw: string): string[] {
    if (!raw) return [];
    try {
      const v = JSON.parse(raw);
      return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
    } catch {
      return [];
    }
  }

  // Permissive client-side CIDR check — IPv4 dotted-quad/prefix or
  // IPv6-ish hex/colons/prefix. The server runs strict net.ParseCIDR on
  // save, so this is just a quick UX gate to catch obvious typos.
  function looksLikeCidr(s: string): boolean {
    const v = s.trim();
    if (!v) return false;
    if (/^(\d{1,3}\.){3}\d{1,3}\/(3[0-2]|[12]?\d)$/.test(v)) return true;
    if (/^[0-9a-fA-F:]+\/(12[0-8]|1[01]\d|\d{1,2})$/.test(v)) return true;
    return false;
  }

  // Per-key state for the "add a CIDR" input field. Keyed by setting key so
  // multiple cidr_list settings (currently just one) don't collide.
  let cidrDrafts = $state<Record<string, string>>({});
  let cidrInputErrors = $state<Record<string, string>>({});

  function addCidr(s: SettingDef) {
    const candidate = (cidrDrafts[s.key] ?? '').trim();
    if (!candidate) return;
    if (!looksLikeCidr(candidate)) {
      cidrInputErrors[s.key] = 'Not a valid CIDR (e.g. 10.0.0.0/8 or 192.168.1.5/32).';
      return;
    }
    const current = parseCidrList(drafts[s.key]);
    if (current.includes(candidate)) {
      cidrInputErrors[s.key] = 'Already in the list.';
      return;
    }
    drafts[s.key] = JSON.stringify([...current, candidate]);
    cidrDrafts[s.key] = '';
    cidrInputErrors[s.key] = '';
  }

  function removeCidr(s: SettingDef, value: string) {
    const current = parseCidrList(drafts[s.key]);
    drafts[s.key] = JSON.stringify(current.filter((v) => v !== value));
  }

  function handleCidrKeydown(e: KeyboardEvent, s: SettingDef) {
    if (e.key === 'Enter') {
      e.preventDefault();
      addCidr(s);
    }
  }
</script>

<h2 class="section-title">Global settings</h2>
<p class="lede">
  Most settings apply immediately; a few are marked
  <span class="badge badge--warning badge--pill">Restart required</span> — they only
  take effect after the server restarts.
</p>
{#if $pendingRestartKeys.length > 0}
  <div class="restart-banner" role="status">
    <Icon icon="mdi:restart" width="20" />
    <div class="restart-banner-text">
      <strong>{$pendingRestartKeys.length} setting{$pendingRestartKeys.length === 1 ? '' : 's'} need{$pendingRestartKeys.length === 1 ? 's' : ''} a HOPS restart to take effect.</strong>
      <div class="restart-banner-keys">
        {#each $pendingRestartKeys as key (key)}
          <code>{key}</code>
        {/each}
      </div>
    </div>
  </div>
{/if}

{#if adjustedSettings.length > 0}
  <div class="adjusted-banner" role="status">
    <Icon icon="mdi:information-outline" width="20" />
    <div>
      <strong>Some stored limits were outside the allowed range and have been changed. Save each one to confirm.</strong>
      <ul>
        {#each adjustedSettings as s (s.key)}
          <li>{labelFor(s.key)}: {adjustmentNotice(s)}</li>
        {/each}
      </ul>
    </div>
  </div>
{/if}

{#if loading}
  <p class="muted">Loading…</p>
{:else if loadError}
  <p class="error">Failed to load settings: {loadError}</p>
{:else}
  {#each grouped as [groupKey, items] (groupKey)}
    <div class="group">
      <h3>{groupLabels[groupKey] ?? groupKey}</h3>
      <div class="rows">
        {#each items as s (s.key)}
          <div class="row" class:dirty={isDirty(s)}>
            <div class="row-label">
              <label class="label-text" for={`setting-${s.key}`}>
                {labelFor(s.key)}
                {#if s.restartRequired}
                  <span class="badge badge--warning badge--pill" title="Takes effect on next restart">
                    <Icon icon="mdi:restart" width="12" /> Restart
                  </span>
                {/if}
              </label>
              <div class="desc">{s.description}</div>
              <div class="meta">
                {#if s.type === 'bytes'}
                  <span class="meta-defaults">Default <code>{formatMB(Number(s.default))}</code>{#if s.max} · can be set up to {formatMB(s.max)}{/if}</span>
                {:else}
                  <span class="meta-defaults">Default <code>{s.default}</code>{#if s.min !== undefined && s.min !== 0} · min {s.min}{/if}{#if s.max !== undefined && s.max !== 0} · max {s.max}{/if}</span>
                {/if}
                <code class="meta-key" title="Internal setting key — used in scripts and the API">{s.key}</code>
              </div>
            </div>
            <div class="row-input">
              {#if (s.type === 'log_level' || s.type === 'enum') && s.enum}
                <select id={`setting-${s.key}`} bind:value={drafts[s.key]}>
                  {#each s.enum as opt (opt)}
                    <option value={opt}>{opt}</option>
                  {/each}
                </select>
              {:else if s.type === 'bool'}
                <label class="bool-toggle">
                  <input
                    id={`setting-${s.key}`}
                    type="checkbox"
                    checked={drafts[s.key] === 'true'}
                    onchange={(e) => (drafts[s.key] = (e.currentTarget as HTMLInputElement).checked ? 'true' : 'false')}
                  />
                  {drafts[s.key] === 'true' ? 'On' : 'Off'}
                </label>
              {:else if s.type === 'cidr_list'}
                <div class="cidr-builder">
                  {#each parseCidrList(drafts[s.key]) as cidr (cidr)}
                    <span class="cidr-chip">
                      <code>{cidr}</code>
                      <button
                        type="button"
                        class="cidr-remove"
                        title="Remove {cidr}"
                        aria-label="Remove {cidr}"
                        onclick={() => removeCidr(s, cidr)}
                      >
                        <Icon icon="mdi:close" width="14" />
                      </button>
                    </span>
                  {/each}
                  {#if parseCidrList(drafts[s.key]).length === 0}
                    <span class="cidr-empty">No CIDRs configured — HOPS will not honour forwarded headers.</span>
                  {/if}
                  <div class="cidr-add">
                    <input
                      id={`setting-${s.key}`}
                      type="text"
                      bind:value={cidrDrafts[s.key]}
                      placeholder="10.0.0.0/8 or 192.168.1.5/32"
                      onkeydown={(e) => handleCidrKeydown(e, s)}
                    />
                    <Button variant="secondary" icon="mdi:plus" onclick={() => addCidr(s)}>
                      Add
                    </Button>
                  </div>
                  {#if cidrInputErrors[s.key]}
                    <div class="error inline">{cidrInputErrors[s.key]}</div>
                  {/if}
                </div>
              {:else if s.type === 'bytes'}
                <div class="mb-input">
                  <input
                    id={`setting-${s.key}`}
                    type="text"
                    inputmode="decimal"
                    bind:value={drafts[s.key]}
                    aria-describedby={`setting-${s.key}-unit`}
                  />
                  <span class="mb-unit" id={`setting-${s.key}-unit`}>MB</span>
                </div>
                {#if s.adjustedFrom}
                  <div class="adjusted inline" role="status">{adjustmentNotice(s)} Save to confirm.</div>
                {/if}
              {:else}
                <input
                  id={`setting-${s.key}`}
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
                {#if String(drafts[s.key]) !== shown(s, s.default)}
                  <Button variant="ghost" onclick={() => resetToDefault(s)}>
                    Reset to default
                  </Button>
                {/if}
              </div>
            </div>
          </div>
        {/each}
      </div>
    </div>
  {/each}
{/if}

<style>
  .group {
    margin-bottom: 2.5rem;
  }

  .group h3 {
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

  /* Ruling 4: two columns — the description (at most 75ch of its 0.92rem text, i.e. 69ch of the
     row's font) with its control right beside it; the card still spans the column, so at 1920 the
     spare room is at the row's end, never between a description and its control. */
  .row {
    display: grid;
    grid-template-columns: fit-content(69ch) minmax(280px, 380px);
    justify-content: start;
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
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }
  .meta code {
    background: var(--bg-tertiary);
    padding: 0 0.3em;
    border-radius: 3px;
  }
  /* Raw setting key is an implementation detail — keep it accessible
     (for scripting / API users) but visually demote it so the panel
     reads less like sysadmin tooling at a glance. */
  .meta-key {
    opacity: 0.35;
    transition: opacity 0.15s;
  }
  .row:hover .meta-key,
  .row:focus-within .meta-key {
    opacity: 0.8;
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

  .row-input .bool-toggle {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-weight: 600;
    cursor: pointer;
  }

  .row-input .bool-toggle input {
    width: 1.1rem;
    height: 1.1rem;
    padding: 0;
    margin: 0;
  }

  /* --- cidr_list list-builder --- */
  .cidr-builder {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .cidr-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 0.375rem;
    padding: 0.25rem 0.4rem 0.25rem 0.6rem;
    font-size: 0.9rem;
    align-self: flex-start;
    max-width: 100%;
  }

  .cidr-chip code {
    background: transparent;
    padding: 0;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    color: var(--text-primary);
  }

  .cidr-remove {
    background: transparent;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    padding: 0.15rem;
    border-radius: 0.25rem;
    display: inline-flex;
    align-items: center;
    transition: all 0.15s;
  }

  .cidr-remove:hover {
    background: rgba(239, 68, 68, 0.15);
    color: var(--color-error, #ef4444);
  }

  .cidr-empty {
    color: var(--text-secondary);
    font-style: italic;
    font-size: 0.88rem;
  }

  .cidr-add {
    display: flex;
    gap: 0.5rem;
    align-items: stretch;
  }

  .cidr-add input {
    flex: 1;
  }

  .row-actions {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  /* Aggregate "you need to restart" banner. Appears at the top of the
     page once a restart-required setting has been saved, and stays
     visible across further edits — the page-level signal is more
     useful than per-key toasts that vanish after a few seconds. */
  .adjusted-banner {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    padding: 0.85rem 1.1rem;
    margin: 0 0 1.5rem;
    background: rgba(59, 130, 246, 0.1);
    border: 1px solid var(--accent);
    border-radius: var(--radius-lg);
    color: var(--text-primary);
  }
  .adjusted-banner :global(svg) {
    color: var(--accent);
    flex-shrink: 0;
    margin-top: 0.1rem;
  }
  .adjusted-banner ul {
    margin: 0.35rem 0 0;
    padding-left: 1.1rem;
  }
  .adjusted.inline {
    margin-top: 0.4rem;
    font-size: 0.85rem;
    color: var(--text-primary);
  }
  .mb-input {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .mb-input input {
    flex: 1;
    min-width: 0;
  }
  .mb-unit {
    color: var(--text-secondary);
    font-weight: 600;
  }

  .restart-banner {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    padding: 0.85rem 1.1rem;
    margin: 0 0 1.5rem;
    background: rgba(245, 158, 11, 0.1);
    border: 1px solid var(--color-warning);
    border-radius: var(--radius-lg);
    color: var(--text-primary);
  }
  .restart-banner :global(svg) {
    color: var(--color-warning);
    flex-shrink: 0;
    margin-top: 0.1rem;
  }
  .restart-banner-text {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .restart-banner-keys {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }
  .restart-banner-keys code {
    background: rgba(245, 158, 11, 0.15);
    padding: 0.05rem 0.45rem;
    border-radius: var(--radius-md);
    font-size: 0.8rem;
  }

  /* Restart-pill is now .badge.badge--warning.badge--pill — see app.css */

  .error {
    color: var(--color-error, #ef4444);
  }
  .error.inline {
    font-size: 0.85rem;
  }

  .muted {
    color: var(--text-secondary);
  }

  /* Narrow (a phone, or a tablet beside the settings sidebar): one column, the control under its text. */
  @media (max-width: 900px) {
    .row {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
