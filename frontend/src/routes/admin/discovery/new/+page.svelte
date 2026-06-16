<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import Icon from '@iconify/svelte';
  import Button from '$lib/components/shared/Button.svelte';
  import { isAuthenticated, waitForAuthChecked } from '$lib/stores/auth';
  import { toast } from '$lib/stores/toast';
  import { createScan, suggestDiscoveryCIDR } from '$lib/utils/api';

  // Targets are chips — each chip is a CIDR ("10.0.0.0/24"), a range
  // ("10.0.0.1-50" shorthand or "10.0.0.1-10.0.0.50" full), or a single
  // IPv4. The form sends them to the server as a comma-separated string.
  let targets = $state<string[]>([]);
  let draft = $state('');
  let label = $state('');
  let intensity = $state<'passive' | 'light' | 'full'>('light');
  let internalDomain = $state('');
  let submitting = $state(false);
  let formError = $state('');

  onMount(async () => {
    await waitForAuthChecked();
    if (!$isAuthenticated) {
      goto('/');
      return;
    }
    // Pre-fill from URL params if present (the "Edit & re-scan" flow
    // navigates here with the previous scan's config baked in). When
    // any field is supplied via params, skip the suggest-CIDR call —
    // the admin already has a target list in mind.
    const params = page.url.searchParams;
    const targetsParam = params.get('targets');
    const intensityParam = params.get('intensity');
    const domainParam = params.get('internalDomain');
    const labelParam = params.get('label');
    if (targetsParam) {
      targets = targetsParam
        .split(',')
        .map((s) => {
          const parsed = parseTarget(s.trim());
          if (!parsed.body) return '';
          return parsed.exclude ? `!${parsed.body}` : parsed.body;
        })
        .filter((s) => s.length > 0);
    }
    if (intensityParam === 'passive' || intensityParam === 'light' || intensityParam === 'full') {
      intensity = intensityParam;
    }
    if (domainParam) internalDomain = domainParam;
    if (labelParam) label = labelParam;

    // Only fall back to suggesting a CIDR if the user landed here
    // without any pre-fill and we have nothing seeded.
    if (targets.length === 0) {
      try {
        const { cidr: suggested } = await suggestDiscoveryCIDR();
        if (suggested) targets = [suggested];
        // Empty `suggested` is a normal outcome (no obvious LAN
        // subnet found from /proc/net/route) — leave the chip-list
        // empty, the form's placeholder text tells the admin what
        // to type.
      } catch (e) {
        // Don't block the form if the suggest API errored — the user
        // can still type a CIDR — but surface a non-blocking toast
        // so they understand WHY the field isn't pre-populated.
        // SESSION_EXPIRED is handled globally; skip the toast for it.
        if (!(e instanceof Error && e.message === 'SESSION_EXPIRED')) {
          toast.warning('Couldn’t auto-suggest a CIDR for your LAN — type one manually.');
        }
      }
    }
  });

  // Strip a leading `!` or `NOT ` exclusion marker — used by both the
  // chip parser and the validator. Returns `{exclude, body}` so the
  // caller can validate the IP form without the marker in the way and
  // re-apply the prefix to the chip text.
  function parseTarget(v: string): { exclude: boolean; body: string } {
    let s = v.trim();
    if (s.startsWith('!')) return { exclude: true, body: s.slice(1).trim() };
    if (/^not\s/i.test(s)) return { exclude: true, body: s.replace(/^not\s+/i, '').trim() };
    return { exclude: false, body: s };
  }

  // Permissive client-side check covering the three accepted forms.
  // The server runs strict validation on submit; this is just to gate
  // the "Add" button so the user gets a fast error before round-trip.
  function targetError(v: string): string {
    const { body } = parseTarget(v);
    const s = body;
    if (!s) return 'Enter a CIDR, range, or single IP';
    if (s.includes('/')) {
      const m = /^(\d{1,3}\.){3}\d{1,3}\/(\d{1,2})$/.exec(s);
      if (!m) return 'Expected IPv4 CIDR like 192.168.1.0/24';
      const prefix = Number(m[2]);
      if (prefix < 16 || prefix > 32) return 'CIDR prefix must be /16-/32';
      return '';
    }
    if (s.includes('-')) {
      const [start, endRaw] = s.split('-').map((p) => p.trim());
      if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(start)) return 'Range start must be an IPv4 like 10.0.0.1';
      if (!endRaw) return 'Range missing end';
      // End can be a full IP or a single octet (shorthand).
      if (/^\d{1,3}$/.test(endRaw)) {
        const n = Number(endRaw);
        if (n < 0 || n > 255) return 'Range end octet must be 0-255';
        return '';
      }
      if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(endRaw)) return 'Range end must be an IPv4 or single octet';
      return '';
    }
    if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(s)) return 'Not a valid CIDR, range, or IPv4 address';
    return '';
  }

  let draftError = $derived(draft.trim() ? targetError(draft) : '');

  // Optional internal-domain field — client-side mirror of the server's
  // validateInternalDomain regex. Empty is valid (just disables forward
  // enum); non-empty must match strict DNS label syntax.
  const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;
  let domainError = $derived.by(() => {
    const d = internalDomain.trim().toLowerCase();
    if (!d) return '';
    if (d.length > 253) return 'Domain is too long (max 253 chars)';
    if (!DOMAIN_RE.test(d)) return 'Invalid DNS name (try something like "internal" or "home.arpa")';
    const tld = d.includes('.') ? d.slice(d.lastIndexOf('.') + 1) : d;
    if (tld === 'localhost' || tld === 'arpa') return `TLD "${tld}" is reserved`;
    if (d === 'in-addr.arpa' || d === 'ip6.arpa') return `"${d}" is reserved`;
    return '';
  });

  function addDraft() {
    const v = draft.trim();
    if (!v || draftError) return;
    // Normalise: re-emit with a canonical `!` prefix if user typed
    // `NOT 10.x.x.x` so the chip text is consistent.
    const parsed = parseTarget(v);
    const canonical = parsed.exclude ? `!${parsed.body}` : parsed.body;
    if (targets.includes(canonical)) {
      formError = `"${canonical}" is already in the list`;
      return;
    }
    targets = [...targets, canonical];
    draft = '';
    formError = '';
  }

  const includeCount = $derived(targets.filter((t) => !parseTarget(t).exclude).length);

  // ---- effective-host-count math ----------------------------------------
  // Expand each chip to a set of 32-bit IPv4 integers and compute
  // (union of includes) − (union of excludes). Mirrors the backend's
  // expandTargets so the user sees the same count the scan will use.

  function ipToInt(ip: string): number {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) return NaN;
    // Force unsigned 32-bit so |0 doesn't turn bit 31 negative.
    return (((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0);
  }

  function expandChip(chipText: string, out: Set<number>): boolean {
    const { body } = parseTarget(chipText);
    const s = body.trim();
    if (!s) return false;
    if (s.includes('/')) {
      const m = /^((?:\d{1,3}\.){3}\d{1,3})\/(\d{1,2})$/.exec(s);
      if (!m) return false;
      const base = ipToInt(m[1]);
      const prefix = Number(m[2]);
      if (isNaN(base) || prefix < 0 || prefix > 32) return false;
      const hostBits = 32 - prefix;
      if (hostBits > 16) return false; // backend caps at /16; bail out
      const mask = hostBits === 32 ? 0 : (0xffffffff << hostBits) >>> 0;
      const start = (base & mask) >>> 0;
      const count = 2 ** hostBits;
      const includeAll = prefix >= 31;
      const first = includeAll ? 0 : 1;
      const last = includeAll ? count : count - 1;
      for (let i = first; i < last; i++) out.add((start + i) >>> 0);
      return true;
    }
    if (s.includes('-')) {
      const [a, b] = s.split('-').map((p) => p.trim());
      const start = ipToInt(a);
      if (isNaN(start)) return false;
      let end: number;
      if (/^\d{1,3}$/.test(b)) {
        const last = Number(b);
        if (last < 0 || last > 255) return false;
        end = ipToInt(a.replace(/\.\d+$/, `.${last}`));
      } else {
        end = ipToInt(b);
      }
      if (isNaN(end) || end < start) return false;
      for (let i = start; i <= end; i++) out.add(i >>> 0);
      return true;
    }
    const single = ipToInt(s);
    if (isNaN(single)) return false;
    out.add(single);
    return true;
  }

  const effectiveCount = $derived.by(() => {
    const includes = new Set<number>();
    const excludes = new Set<number>();
    for (const t of targets) {
      const { exclude } = parseTarget(t);
      expandChip(t, exclude ? excludes : includes);
    }
    let count = 0;
    for (const ip of includes) if (!excludes.has(ip)) count++;
    return count;
  });

  function removeTarget(t: string) {
    targets = targets.filter((x) => x !== t);
  }

  function handleDraftKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      addDraft();
    } else if (e.key === ',') {
      // Convenience: typing a comma also commits the chip.
      e.preventDefault();
      addDraft();
    }
  }

  async function submit(e: Event) {
    e.preventDefault();
    if (submitting) return;
    formError = '';

    // If there's a pending draft, commit it first so users who hit
    // Submit without pressing Enter don't lose their typing.
    if (draft.trim() && !draftError) {
      addDraft();
    }
    if (targets.length === 0) {
      formError = 'Add at least one target (CIDR, range, or IP)';
      return;
    }
    if (includeCount === 0) {
      formError = 'Add at least one include target (without a ! / NOT prefix)';
      return;
    }
    if (effectiveCount === 0) {
      formError = 'Your exclusions cover every include — 0 hosts to scan. Remove or narrow a NOT chip.';
      return;
    }
    if (domainError) {
      formError = domainError;
      return;
    }

    submitting = true;
    try {
      const scan = await createScan({
        cidr: targets.join(', '),
        intensity,
        label: label.trim(),
        internalDomain: internalDomain.trim().toLowerCase(),
      });
      toast.success('Scan started');
      goto(`/admin/discovery/${scan.id}`);
    } catch (e) {
      formError = e instanceof Error ? e.message : 'Failed to start scan';
      submitting = false;
    }
  }
</script>

<svelte:head>
  <title>New Discovery Scan — HOPS</title>
</svelte:head>

<div class="page">
  <header class="header">
    <Button variant="ghost" icon="mdi:arrow-left" onclick={() => goto('/admin/discovery')} ariaLabel="Back to Discovery" />
    <h1>New Discovery Scan</h1>
  </header>

  <form onsubmit={submit} class="form">
    <div class="field">
      <label for="target-input">Targets to scan</label>
      <div class="chips" class:empty={targets.length === 0}>
        {#each targets as t (t)}
          {@const isExclude = t.startsWith('!') || /^not\s/i.test(t)}
          {@const body = parseTarget(t).body}
          <span class="chip" class:chip-exclude={isExclude} title={isExclude ? 'Excluded from the scan' : 'Included in the scan'}>
            {#if isExclude}
              <span class="chip-marker" aria-label="exclude">NOT</span>
            {/if}
            <code>{body}</code>
            <button
              type="button"
              class="chip-remove"
              onclick={() => removeTarget(t)}
              title="Remove"
              aria-label="Remove {t}"
            >
              <Icon icon="mdi:close" width="14" />
            </button>
          </span>
        {/each}
        {#if targets.length === 0}
          <span class="chips-empty">No targets yet — add one below.</span>
        {/if}
      </div>
      <div class="add-row">
        <input
          id="target-input"
          type="text"
          bind:value={draft}
          onkeydown={handleDraftKeydown}
          placeholder="CIDR, range, or IP — prefix with ! to exclude"
          autocomplete="off"
          class:invalid={!!draftError}
        />
        <Button
          variant="secondary"
          icon="mdi:plus"
          onclick={addDraft}
          disabled={!draft.trim() || !!draftError}
        >
          Add
        </Button>
      </div>
      <div class="hint">
        Accepts CIDRs (<code>10.0.0.0/24</code>),
        ranges (<code>10.0.0.1-50</code> or <code>10.0.0.1-10.0.1.255</code>),
        and single IPs (<code>10.0.0.5</code>). Press Enter or comma to add.
        Prefix any target with <code>!</code> (or <code>NOT&nbsp;</code>) to
        exclude it — e.g. <code>!10.10.0.8-12</code> skips those addresses.
        Max 65 536 hosts total across all targets.
        {#if draftError}<span class="err">{draftError}</span>{/if}
      </div>
      {#if targets.length > 0}
        {#if includeCount === 0}
          <div class="count-bad">You only have NOT chips — add at least one include.</div>
        {:else if effectiveCount === 0}
          <div class="count-bad">Your exclusions cover every include — 0 hosts would be scanned.</div>
        {:else}
          <div class="count-good">{effectiveCount.toLocaleString()} host{effectiveCount === 1 ? '' : 's'} will be scanned.</div>
        {/if}
      {/if}
    </div>

    <div class="field">
      <label for="label">Label (optional)</label>
      <input
        id="label"
        type="text"
        bind:value={label}
        placeholder="e.g. main LAN, Tailscale subnet, …"
        autocomplete="off"
      />
      <div class="hint">Just a memo to help you tell drafts apart later.</div>
    </div>

    <div class="field">
      <label for="internal-domain">Internal domain (optional)</label>
      <input
        id="internal-domain"
        type="text"
        bind:value={internalDomain}
        placeholder="e.g. internal, lan, home.arpa, weaversgrainthorpe.uk"
        autocomplete="off"
        class:invalid={!!domainError}
      />
      <div class="hint">
        Leave blank unless you run your own DNS at home (Pi-hole, NPM, Traefik).
        When set, HOPS tries common names like <code>sonarr.&lt;domain&gt;</code>
        so reverse-proxy-fronted services get picked up.
        <details>
          <summary>How this works</summary>
          HOPS looks up ~50 well-known homelab subdomains against your
          system resolver. Anything that resolves is added as a draft
          tile. Built-in safety nets: limited redirects per name, and
          the whole step gives up after about a minute so a wildcard
          DNS record can't stall a scan.
        </details>
        {#if domainError}<span class="err">{domainError}</span>{/if}
      </div>
    </div>

    <div class="field">
      <span class="label">Scan intensity</span>
      <div class="intensity-grid">
        <label class="intensity-card" class:active={intensity === 'passive'}>
          <input type="radio" bind:group={intensity} value="passive" />
          <div class="card-title"><Icon icon="mdi:ear-hearing" width="18" /> Passive only</div>
          <div class="card-body">
            mDNS, NetBIOS, and ARP cache only — no outbound probes.
            Finds things that broadcast themselves; misses everything
            else.
          </div>
        </label>
        <label class="intensity-card" class:active={intensity === 'light'}>
          <input type="radio" bind:group={intensity} value="light" />
          <div class="card-title"><Icon icon="mdi:radar" width="18" /> Light active</div>
          <div class="card-body">
            Passive plus TCP-connect + HTTP fingerprint on ~30 well-known
            homelab ports. The default — fast and finds most things.
          </div>
        </label>
        <label class="intensity-card" class:active={intensity === 'full'}>
          <input type="radio" bind:group={intensity} value="full" />
          <div class="card-title"><Icon icon="mdi:radar" width="18" /> Full active</div>
          <div class="card-body">
            Light plus a wider port sweep + banner grabs. Slower and
            noisier; can spook IoT firmware. Use when you suspect there's
            something on a non-standard port.
          </div>
        </label>
      </div>
    </div>

    {#if formError}
      <div class="error">{formError}</div>
    {/if}

    <div class="actions">
      <Button variant="secondary" onclick={() => goto('/admin/discovery')}>Cancel</Button>
      <Button type="submit" variant="primary" icon="mdi:radar" disabled={submitting || targets.length === 0 || effectiveCount === 0 || includeCount === 0}>
        {submitting ? 'Starting…' : `Start scan (${effectiveCount.toLocaleString()} host${effectiveCount === 1 ? '' : 's'})`}
      </Button>
    </div>
  </form>
</div>

<style>
  .page {
    max-width: 720px;
    margin: 0 auto;
    padding: 2rem 1.5rem;
    color: var(--text-primary);
  }
  .header { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1.5rem; }
  .header h1 { margin: 0; font-size: var(--font-h1); }

  .form { display: flex; flex-direction: column; gap: 1.2rem; }
  .field { display: flex; flex-direction: column; gap: 0.4rem; }
  .field label { font-weight: 600; font-size: 0.9rem; }
  .field input {
    background: var(--bg-secondary);
    color: var(--text-primary);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: 0.55rem 0.7rem;
    font-size: 1rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  .field input.invalid { border-color: var(--color-error, #b00); }
  .hint { color: var(--text-secondary); font-size: 0.85rem; }
  .hint code {
    background: var(--bg-tertiary);
    padding: 0.05rem 0.3rem;
    border-radius: var(--radius-sm);
    font-size: 0.83rem;
  }
  .err { color: var(--color-error, #ef4444); margin-left: 0.5rem; }
  .count-good {
    margin-top: 0.4rem;
    color: #22c55e;
    font-size: 0.85rem;
    font-weight: 500;
  }
  .count-bad {
    margin-top: 0.4rem;
    color: #ef4444;
    font-size: 0.85rem;
    font-weight: 500;
  }

  .chips {
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: 0.5rem;
    min-height: 2.4rem;
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    align-items: center;
  }
  .chips.empty { padding: 0.6rem 0.7rem; }
  .chips-empty {
    color: var(--text-secondary);
    font-size: 0.88rem;
    font-style: italic;
  }
  .chip-exclude {
    background: rgba(239,68,68,0.12) !important;
    border-color: rgba(239,68,68,0.35) !important;
  }
  .chip-marker {
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    background: rgba(239,68,68,0.25);
    color: #ef4444;
    padding: 0.05rem 0.4rem;
    border-radius: 0.2rem;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 0.2rem 0.55rem 0.2rem 0.7rem;
    font-size: 0.88rem;
  }
  .chip code {
    background: transparent;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.88rem;
    padding: 0;
  }
  .chip-remove {
    background: transparent;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    border-radius: 50%;
    padding: 0.05rem;
  }
  .chip-remove:hover {
    background: rgba(239,68,68,0.15);
    color: #ef4444;
  }
  .add-row {
    display: flex;
    gap: 0.5rem;
    align-items: stretch;
  }
  .add-row input { flex: 1; }

  .field .label { font-weight: 600; font-size: 0.9rem; }
  .intensity-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
    gap: 0.6rem;
  }
  .intensity-card {
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 0.7rem 0.85rem;
    cursor: pointer;
    transition: border-color 0.12s ease, background 0.12s ease;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .intensity-card input[type="radio"] {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }
  .intensity-card .card-title {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-weight: 600;
    font-size: 0.95rem;
  }
  .intensity-card .card-body {
    color: var(--text-secondary);
    font-size: 0.83rem;
    line-height: 1.35;
  }
  .intensity-card.active {
    border-color: var(--accent, var(--accent));
    background: rgba(79,140,255,0.06);
  }
  .intensity-card:hover { border-color: var(--accent, var(--accent)); }
  .error {
    background: rgba(239,68,68,0.1);
    border: 1px solid rgba(239,68,68,0.3);
    color: #ef4444;
    border-radius: var(--radius-md);
    padding: 0.6rem 0.8rem;
  }
  .actions { display: flex; gap: 0.6rem; justify-content: flex-end; margin-top: 0.5rem; }
</style>
