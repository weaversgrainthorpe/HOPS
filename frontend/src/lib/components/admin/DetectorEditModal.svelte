<script lang="ts">
  import Icon from '@iconify/svelte';
  import Modal from '../shared/Modal.svelte';
  import IconPickerModal from './IconPickerModal.svelte';
  import {
    CATEGORY_LIST,
    type DiscoveryDetector,
    type DiscoveryDetectorInput,
    type DiscoveryCategory,
  } from '$lib/utils/api';

  interface Props {
    detector: DiscoveryDetector | null;
    onSave: (input: DiscoveryDetectorInput) => void | Promise<void>;
    onCancel: () => void;
  }

  let { detector, onSave, onCancel }: Props = $props();

  // svelte-ignore state_referenced_locally
  let name = $state(detector?.name ?? '');
  // svelte-ignore state_referenced_locally
  let description = $state(detector?.description ?? '');
  // svelte-ignore state_referenced_locally
  let icon = $state(detector?.icon ?? '');
  // svelte-ignore state_referenced_locally
  let category = $state<DiscoveryCategory>(detector?.category ?? 'other');
  // svelte-ignore state_referenced_locally
  let portsText = $state((detector?.ports ?? []).join(', '));
  // svelte-ignore state_referenced_locally
  let pathsText = $state((detector?.paths ?? []).join('\n'));
  // svelte-ignore state_referenced_locally
  let urlPath = $state(detector?.urlPath ?? '');
  // svelte-ignore state_referenced_locally
  let bodyText = $state((detector?.bodyContains ?? []).join('\n'));
  // svelte-ignore state_referenced_locally
  let titleText = $state((detector?.titleContains ?? []).join('\n'));
  // svelte-ignore state_referenced_locally
  let headersText = $state((detector?.headerKeys ?? []).join('\n'));
  // svelte-ignore state_referenced_locally
  let faviconHashesText = $state((detector?.faviconHashes ?? []).join('\n'));
  // svelte-ignore state_referenced_locally
  let confidence = $state<'high' | 'medium'>(detector?.confidence ?? 'medium');
  // svelte-ignore state_referenced_locally
  let enabled = $state(detector?.enabled ?? true);

  let saving = $state(false);
  let saveError = $state('');
  let showIconPicker = $state(false);

  // The modal handles four distinct flows. They all share the same form
  // but the title and save-button text differ so the admin knows what's
  // about to happen.
  //
  //   - No detector at all → "New detector"            (POST creates user/*)
  //   - detector.id == "" (seeded from a result)  → "New detector"  (POST)
  //   - detector.source == 'user'                 → "Edit detector" (PATCH)
  //   - detector.source == 'bundled' + overridden → "Edit override" (PATCH)
  //   - detector.source == 'bundled' + !overridden→ "Customize"     (PATCH upserts)
  const mode = $derived.by(() => {
    if (!detector?.id) return 'new' as const;
    if (detector.source === 'user') return 'edit-user' as const;
    if (detector.overridden) return 'edit-override' as const;
    return 'customize' as const;
  });
  const modalTitle = $derived(
    mode === 'new' ? 'New detector'
    : mode === 'edit-user' ? `Edit detector — ${detector?.name}`
    : mode === 'edit-override' ? `Edit override — ${detector?.name}`
    : `Customize — ${detector?.name}`
  );
  const saveLabel = $derived(
    mode === 'new' ? 'Create detector'
    : mode === 'customize' ? 'Save customization'
    : 'Save changes'
  );

  function splitLines(s: string): string[] {
    return s
      .split('\n')
      .map((x) => x.trim())
      .filter((x) => x.length > 0);
  }

  function parsePorts(s: string): number[] {
    const out: number[] = [];
    for (const piece of s.split(/[,\s]+/)) {
      const p = piece.trim();
      if (!p) continue;
      const n = Number(p);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > 65535) {
        throw new Error(`Invalid port "${p}" — must be an integer 1-65535`);
      }
      out.push(n);
    }
    return out;
  }

  // parseFaviconHashes parses one-per-line int32 hashes. Accepts both
  // negative and positive — Shodan publishes signed 32-bit, but some
  // tools (e.g. fofa) emit unsigned. Coerce unsigned-looking values
  // > 2^31-1 into the signed equivalent so admin can paste from either.
  function parseFaviconHashes(s: string): number[] {
    const out: number[] = [];
    for (const line of s.split('\n')) {
      const p = line.trim();
      if (!p) continue;
      const n = Number(p);
      if (!Number.isFinite(n) || !Number.isInteger(n)) {
        throw new Error(`Invalid favicon hash "${p}" — must be an integer`);
      }
      // Coerce to signed int32 range.
      let v = n;
      if (v > 2147483647) v -= 4294967296;
      if (v < -2147483648 || v > 2147483647) {
        throw new Error(`Favicon hash "${p}" out of 32-bit range`);
      }
      out.push(v);
    }
    if (out.length > 100) {
      throw new Error('Too many favicon hashes (max 100)');
    }
    return out;
  }

  function validate(): string {
    if (!name.trim()) return 'Name is required';
    if (name.length > 200) return 'Name must be 200 characters or fewer';
    try {
      const ports = parsePorts(portsText);
      if (ports.length === 0) return 'At least one port is required';
    } catch (e) {
      return e instanceof Error ? e.message : 'Ports invalid';
    }
    for (const path of splitLines(pathsText)) {
      if (!path.startsWith('/')) return `Path "${path}" must start with /`;
      if (path.includes('..')) return `Path "${path}" must not contain ..`;
    }
    if (urlPath && !urlPath.startsWith('/')) return 'Landing path must start with /';
    const body = splitLines(bodyText);
    const title = splitLines(titleText);
    const headers = splitLines(headersText);
    for (const b of body) if (b.length < 4) return `Body signature "${b}" is too short (min 4 chars)`;
    for (const t of title) if (t.length < 3) return `Title signature "${t}" is too short (min 3 chars)`;
    let favicons: number[];
    try {
      favicons = parseFaviconHashes(faviconHashesText);
    } catch (e) {
      return e instanceof Error ? e.message : 'Favicon hashes invalid';
    }
    if (body.length + title.length + headers.length + favicons.length === 0) {
      return 'At least one body / title / header / favicon-hash signature is required';
    }
    return '';
  }

  async function handleSave() {
    const err = validate();
    if (err) {
      saveError = err;
      return;
    }
    saveError = '';
    saving = true;
    try {
      const input: DiscoveryDetectorInput = {
        name: name.trim(),
        description: description.trim(),
        icon,
        category,
        ports: parsePorts(portsText),
        paths: splitLines(pathsText),
        urlPath,
        bodyContains: splitLines(bodyText),
        titleContains: splitLines(titleText),
        headerKeys: splitLines(headersText).map((h) => h.toLowerCase()),
        faviconHashes: parseFaviconHashes(faviconHashesText),
        confidence,
        enabled,
      };
      await onSave(input);
    } catch (e) {
      saveError = e instanceof Error ? e.message : 'Save failed';
    } finally {
      saving = false;
    }
  }

  function handleBeforeClose(): boolean {
    if (showIconPicker) {
      showIconPicker = false;
      return false;
    }
    return true;
  }
</script>

<Modal
  id="detector-edit-modal"
  title={modalTitle}
  titleIcon="mdi:radar-scan"
  onClose={onCancel}
  onBeforeClose={handleBeforeClose}
  maxWidth="720px"
>
  <div class="form">
    <div class="row">
      <label for="d-name">Name <span class="req">*</span></label>
      <input id="d-name" type="text" bind:value={name} placeholder="e.g. My Self-Hosted App" />
    </div>

    <div class="row">
      <label for="d-desc">Description</label>
      <input id="d-desc" type="text" bind:value={description} placeholder="Short one-line description shown in the curate UI" />
    </div>

    <div class="row row-split">
      <div>
        <label for="d-cat">Category</label>
        <select id="d-cat" bind:value={category}>
          {#each CATEGORY_LIST as c (c.slug)}
            <option value={c.slug}>{c.label}</option>
          {/each}
        </select>
      </div>
      <div>
        <label for="d-icon">Icon</label>
        <div class="icon-row">
          <button type="button" class="icon-pick" onclick={() => (showIconPicker = true)}>
            {#if !icon}
              <Icon icon="mdi:image" width="22" />
            {:else if icon.startsWith('/') || icon.startsWith('http')}
              <img src={icon} alt="" width="22" height="22" />
            {:else if icon.includes(':')}
              <Icon icon={icon} width="22" />
            {:else}
              <img src="/api/icons/dashboard/{icon}.svg" alt="" width="22" height="22" />
            {/if}
            <span class="icon-label">{icon || 'Choose…'}</span>
          </button>
        </div>
      </div>
    </div>

    <div class="row row-split">
      <div>
        <label for="d-ports">Ports <span class="req">*</span></label>
        <input id="d-ports" type="text" bind:value={portsText} placeholder="80, 443, 8080" />
        <p class="hint">Comma- or space-separated. Each port 1-65535.</p>
      </div>
      <div>
        <label for="d-urlpath">Landing path</label>
        <input id="d-urlpath" type="text" bind:value={urlPath} placeholder="/" />
        <p class="hint">Where the dashboard tile opens. Blank = root.</p>
      </div>
    </div>

    <div class="row">
      <label for="d-paths">Probe paths (one per line)</label>
      <textarea id="d-paths" bind:value={pathsText} rows="3" placeholder="/login&#10;/api/status"></textarea>
      <p class="hint">Extra paths to fetch when the root probe doesn't match. Each must start with /. Optional.</p>
    </div>

    <fieldset class="signatures">
      <legend>Match signatures <span class="req">*</span> <span class="hint inline">— at least one across these three</span></legend>

      <div class="row">
        <label for="d-body">Body contains (one per line)</label>
        <textarea id="d-body" bind:value={bodyText} rows="3" placeholder="MyApp&#10;myapp-version"></textarea>
        <p class="hint">Case-sensitive substring match against the response body. Min 4 chars each.</p>
      </div>

      <div class="row">
        <label for="d-title">Title contains (one per line)</label>
        <textarea id="d-title" bind:value={titleText} rows="2" placeholder="MyApp"></textarea>
        <p class="hint">Case-insensitive substring match against the &lt;title&gt; element. Min 3 chars each.</p>
      </div>

      <div class="row">
        <label for="d-headers">Header keys (one per line)</label>
        <textarea id="d-headers" bind:value={headersText} rows="2" placeholder="x-myapp-version&#10;x-served-by"></textarea>
        <p class="hint">Any of these response headers being present counts as a match.</p>
      </div>

      <div class="row">
        <label for="d-favicons">Favicon hashes (one per line)</label>
        <textarea id="d-favicons" bind:value={faviconHashesText} rows="2" placeholder="1866999254&#10;-1338575550"></textarea>
        <p class="hint">
          Shodan-style signed-int32 MurmurHash3 of the favicon — the most
          stable signature type (survives version bumps). Get one from
          the Diagnostics view's "hash:" column, or shodan.io's
          <code>http.favicon.hash</code> search.
        </p>
      </div>
    </fieldset>

    <div class="row row-split">
      <div>
        <label for="d-conf">Confidence</label>
        <select id="d-conf" bind:value={confidence}>
          <option value="high">High — auto-tick in curate UI</option>
          <option value="medium">Medium — unticked by default</option>
        </select>
      </div>
      <div class="enabled-row">
        <label class="check">
          <input type="checkbox" bind:checked={enabled} />
          <span>Enabled</span>
        </label>
        <p class="hint">Disabled detectors stay in the list but don't match during scans.</p>
      </div>
    </div>

    {#if saveError}
      <div class="error">{saveError}</div>
    {/if}
  </div>

  {#snippet footer()}
    <div class="footer">
      <button type="button" class="btn-cancel" onclick={onCancel} disabled={saving}>Cancel</button>
      <button type="button" class="btn-save" onclick={handleSave} disabled={saving}>
        {saving ? 'Saving…' : saveLabel}
      </button>
    </div>
  {/snippet}
</Modal>

{#if showIconPicker}
  <IconPickerModal
    currentIcon={icon}
    onSelect={(selection) => {
      // The picker returns either an Iconify name (selection.icon set)
      // or an uploaded image URL (selection.imageUrl set, icon empty).
      // We store both shapes in the single string field — the
      // renderer below disambiguates by checking for a leading slash
      // / http or an Iconify colon.
      icon = selection.imageUrl || selection.icon;
      showIconPicker = false;
    }}
    onCancel={() => (showIconPicker = false)}
  />
{/if}

<style>
  .form { display: flex; flex-direction: column; gap: 1rem; }
  .row { display: flex; flex-direction: column; gap: 0.3rem; }
  .row-split { flex-direction: row; gap: 1rem; }
  .row-split > div { flex: 1; display: flex; flex-direction: column; gap: 0.3rem; }
  label { font-weight: 500; font-size: 0.9rem; color: var(--text-primary); }
  input[type="text"], select, textarea {
    width: 100%; box-sizing: border-box;
    background: var(--bg-tertiary); color: var(--text-primary);
    border: 1px solid var(--border); border-radius: 0.4rem;
    padding: 0.45rem 0.6rem; font-size: 0.92rem;
    font-family: inherit;
  }
  textarea { resize: vertical; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.85rem; }
  .hint { color: var(--text-secondary); font-size: 0.78rem; margin: 0.1rem 0 0; }
  .hint.inline { display: inline; font-weight: 400; }
  .req { color: var(--color-error, #ef4444); }
  fieldset.signatures {
    border: 1px solid var(--border); border-radius: 0.5rem;
    padding: 0.8rem 1rem 1rem; display: flex; flex-direction: column; gap: 0.8rem;
  }
  fieldset.signatures legend { font-weight: 600; font-size: 0.9rem; padding: 0 0.5rem; }
  .icon-row { display: flex; gap: 0.5rem; }
  .icon-pick {
    background: var(--bg-tertiary); color: var(--text-primary);
    border: 1px solid var(--border); border-radius: 0.4rem;
    padding: 0.45rem 0.6rem; cursor: pointer;
    display: inline-flex; gap: 0.5rem; align-items: center;
    font-size: 0.9rem; flex: 1; justify-content: flex-start;
  }
  .icon-pick:hover { background: var(--bg-secondary); }
  .icon-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
  .check { display: inline-flex; gap: 0.4rem; align-items: center; cursor: pointer; }
  .enabled-row { display: flex; flex-direction: column; gap: 0.3rem; justify-content: center; }
  .error {
    background: rgba(239,68,68,0.1); color: #ef4444;
    border: 1px solid rgba(239,68,68,0.35);
    border-radius: 0.4rem; padding: 0.5rem 0.8rem;
    font-size: 0.9rem;
  }
  .footer { display: flex; justify-content: flex-end; gap: 0.5rem; padding-top: 0.5rem; }
  .btn-cancel, .btn-save {
    border: 1px solid var(--border); border-radius: 0.4rem;
    padding: 0.5rem 1rem; font-size: 0.92rem; cursor: pointer;
  }
  .btn-cancel { background: transparent; color: var(--text-primary); }
  .btn-cancel:hover { background: var(--bg-tertiary); }
  .btn-save { background: #4f8cff; color: white; border-color: #4f8cff; }
  .btn-save:hover:not(:disabled) { filter: brightness(1.1); }
  .btn-save:disabled, .btn-cancel:disabled { opacity: 0.6; cursor: not-allowed; }
</style>
