<script lang="ts">
  // Settings › Dashboards: tiles that point at the same address (imports, Discovery or copies),
  // with a merge that keeps one and deletes the others. A merge is a normal layout edit: one
  // revision-checked save per dashboard, never silent (a preview and a confirmation first), and
  // refused visibly when a dashboard is being edited or has changed elsewhere.
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import Icon from '@iconify/svelte';
  import { config, applySavedLayout, showSaveWarning, loadConfig, findLayoutDashboard } from '$lib/stores/config';
  import { session, parkedDraft } from '$lib/stores/editSession';
  import { saveDashboardV3, ConflictError } from '$lib/utils/api';
  import { findDuplicates, removeTiles, scopeGroups, DUP_SCOPES, type DupScope, type ScopedGroup as DupGroup, type DupTile } from '$lib/utils/duplicates';
  import { showOnDashboard } from '$lib/utils/showIt';
  import { toast } from '$lib/stores/toast';

  // The heading and "Finding duplicates…" paint first; the search (seconds over ~100,000 tiles)
  // runs after, so the page never sits blank and unresponsive with no sign of work.
  let started = $state(false);
  onMount(() => {
    const raf = requestAnimationFrame(() => setTimeout(() => (started = true), 0));
    return () => cancelAnimationFrame(raf);
  });
  const report = $derived(started ? findDuplicates($config) : null);

  // A page of groups at a time: drawing thousands at once froze the browser (and queued every
  // click made meanwhile, silently).
  const PAGE = 50;
  let limit = $state(PAGE);

  const SCOPE_KEY = 'hops.duplicates.scope';
  function loadScope(): DupScope {
    try {
      const v = localStorage.getItem(SCOPE_KEY);
      if (DUP_SCOPES.some((x) => x.id === v)) return v as DupScope;
    } catch {
      /* storage unavailable: the default is fine, this is only a viewer convenience */
    }
    return 'all';
  }
  let scope = $state<DupScope>(loadScope());
  const scopeInfo = $derived(DUP_SCOPES.find((x) => x.id === scope)!);
  const shown = $derived(report ? scopeGroups(report.groups, scope) : []);
  const visible = $derived(shown.slice(0, limit));
  function setScope(s: DupScope) {
    scope = s;
    limit = PAGE;
    merging = null;
    refusal = '';
    try {
      localStorage.setItem(SCOPE_KEY, s);
    } catch {
      /* not remembered; still works for this visit */
    }
  }
  function scopeKeys(e: KeyboardEvent) {
    const i = DUP_SCOPES.findIndex((x) => x.id === scope);
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const next = DUP_SCOPES[(i + d + DUP_SCOPES.length) % DUP_SCOPES.length].id;
    setScope(next);
    (e.currentTarget as HTMLElement).querySelector<HTMLInputElement>(`input[value="${next}"]`)?.focus();
  }

  /** group address -> id of the tile to keep. */
  let keep = $state<Record<string, string>>({});
  /** The group whose merge preview is open. */
  let merging = $state<string | null>(null);
  let busy = $state(false);
  let refusal = $state('');

  const tileCount = (n: number) => `${n} tile${n === 1 ? '' : 's'}`;
  const tilePath = (t: DupTile) => [...t.path, t.name || '(no name)'].join(' › ');

  /** What differs between the copies, so the user can choose which to keep. */
  function differences(g: DupGroup, t: DupTile): string[] {
    const out: string[] = [];
    if (g.tiles.some((o) => o.name !== t.name)) out.push(`name "${t.name || '(none)'}"`);
    if (g.tiles.some((o) => o.icon !== t.icon || o.iconUrl !== t.iconUrl)) out.push(`icon ${t.iconUrl ? 'custom' : t.icon || '(none)'}`);
    if (g.tiles.some((o) => o.openMode !== t.openMode)) out.push(`opens ${t.openMode || '(default)'}`);
    if (g.tiles.some((o) => o.awayUrl !== t.awayUrl)) out.push(`away address ${t.awayUrl || '(none)'}`);
    if (g.tiles.some((o) => o.url !== t.url)) out.push(`written ${t.url}`);
    return out;
  }

  const keeperOf = (g: DupGroup): string => keep[g.key] ?? g.tiles[0].id;
  const doomed = (g: DupGroup) => g.tiles.filter((t) => t.id !== keeperOf(g));

  function startMerge(g: DupGroup) {
    refusal = '';
    merging = g.key;
  }
  function cancelMerge() {
    merging = null;
    refusal = '';
  }

  async function confirmMerge(g: DupGroup) {
    if (busy) return;
    refusal = '';
    const gone = doomed(g);
    const byDash = new Map<string, DupTile[]>();
    for (const t of gone) byDash.set(t.dashboardId, [...(byDash.get(t.dashboardId) ?? []), t]);

    // Refuse before anything is saved if any affected dashboard is open for editing.
    const editing = new Set([get(session)?.dashboardId, get(parkedDraft)?.dashboardId].filter(Boolean));
    const blocked = [...byDash.values()].filter((l) => editing.has(l[0].dashboardId));
    if (blocked.length) {
      refusal = `Not merged: "${blocked[0][0].dashboardName}" is being edited (an edit session or unsaved draft is open). Save or discard that first, then merge.`;
      return;
    }

    busy = true;
    const done: string[] = [];
    try {
      for (const [dashId, tiles] of byDash) {
        const d = findLayoutDashboard(dashId, get(config));
        if (!d) throw new Error(`Dashboard "${tiles[0].dashboardName}" no longer exists. Reload and try again.`);
        const ids = new Set(tiles.map((t) => t.id));
        const resp = await saveDashboardV3(d.id, removeTiles(d, ids), d.revision);
        applySavedLayout(resp);
        if (resp.warning) showSaveWarning(resp.warning);
        done.push(d.name);
      }
      toast.success(`Merged: kept "${tilePath(g.tiles.find((t) => t.id === keeperOf(g))!)}" and deleted ${tileCount(gone.length)}.`);
      merging = null;
    } catch (e) {
      const partial = done.length ? ` Already saved before this failed: ${done.join(', ')}.` : '';
      if (e instanceof ConflictError) {
        refusal = `Not merged: a dashboard was changed somewhere else, so nothing more was deleted. The list below has been reloaded; check it and try again.${partial}`;
        void loadConfig({ background: true });
      } else {
        refusal = `Merge failed: ${e instanceof Error ? e.message : 'request failed'}.${partial}`;
      }
    } finally {
      busy = false;
    }
  }
</script>

<section class="dupes" aria-labelledby="duplicates-title" data-testid="duplicates">
  <h3 id="duplicates-title">Duplicates</h3>
  {#if !$config}
    <p class="muted">Loading…</p>
  {:else}
    <p class="muted">
      Tiles that point at the same address, on any dashboard, tab or folder. Addresses are compared ignoring capitals,
      a default port and a trailing slash; <code>www.</code> counts as a different address.
    </p>
    <div class="scope" role="radiogroup" aria-label="Show duplicates" tabindex="-1" onkeydown={scopeKeys}>
      <span class="muted">Show</span>
      {#each DUP_SCOPES as o (o.id)}
        <label class="seg" class:on={scope === o.id}>
          <input type="radio" name="dup-scope" value={o.id} checked={scope === o.id} disabled={busy} onchange={() => setScope(o.id)} />
          {o.label}
        </label>
      {/each}
    </div>
    {#if !report}
      <p class="muted" role="status" aria-busy="true" data-state="working">Finding duplicates…</p>
    {:else if shown.length === 0}
      <p class="state ok" role="status" data-state="none">
        {scope === 'all' ? `No duplicate addresses across ${tileCount(report.totalTiles)}` : `No duplicates ${scopeInfo.within}`}
      </p>
    {:else}
      <p class="muted" role="status" data-dup-count>{shown.length} group{shown.length === 1 ? '' : 's'} {scopeInfo.within}</p>
      {#each visible as g (g.key)}
        <div class="group" data-dup-group={g.address}>
          <div class="addr"><code>{g.address}</code> <span class="muted">{g.tiles.length} tiles</span></div>
          <ul class="rows">
            {#each g.tiles as t (t.id)}
              {@const diffs = differences(g, t)}
              <li class="row" data-dup-tile={t.id}>
                <label class="what">
                  <input
                    type="radio"
                    name={`keep-${g.key}`}
                    value={t.id}
                    checked={keeperOf(g) === t.id}
                    disabled={busy}
                    onchange={() => { keep[g.key] = t.id; if (merging === g.key) refusal = ''; }}
                  />
                  <span class="icon">
                    {#if t.iconUrl}<img src={t.iconUrl} alt="" width="20" height="20" />{:else if t.icon}<Icon icon={t.icon} width="20" height="20" />{/if}
                  </span>
                  <span class="text">
                    <span class="name">{t.name || '(no name)'}</span>
                    <span class="path">{t.path.join(' › ')}</span>
                    {#if diffs.length}<span class="diff">{diffs.join(' · ')}</span>{/if}
                    {#if t.awayUrl && !diffs.some((x) => x.startsWith('away'))}<span class="diff">away address {t.awayUrl}</span>{/if}
                  </span>
                </label>
                <button type="button" class="btn-secondary" onclick={() => showOnDashboard({ kind: 'tile', id: t.id, dashboardId: t.dashboardId, dashboardPath: t.dashboardPath, dashboardName: t.dashboardName, tabId: t.tabId, folderIds: t.folderIds })}>Show it</button>
              </li>
            {/each}
          </ul>
          {#if merging === g.key}
            <div class="preview" role="group" aria-label="Merge preview" data-merge-preview>
              <p>
                <strong>Keeps</strong> {tilePath(g.tiles.find((t) => t.id === keeperOf(g))!)}.<br />
                <strong data-merge-deletes>Deletes {tileCount(doomed(g).length)}: {doomed(g).map((t) => `${t.path[0]} › ${t.name || '(no name)'}`).join(', ')}</strong>
              </p>
              <p class="muted">
                Saved as a normal edit of each affected dashboard, so the dashboard's backup taken just before the save
                holds the deleted tiles and you can restore them from there.
              </p>
              <div class="btns">
                <button type="button" class="btn-primary" disabled={busy} onclick={() => confirmMerge(g)}>{busy ? 'Merging…' : `Delete ${tileCount(doomed(g).length)}`}</button>
                <button type="button" class="btn-secondary" disabled={busy} onclick={cancelMerge}>Cancel</button>
              </div>
            </div>
          {:else}
            <div class="btns">
              <button type="button" class="btn-secondary" disabled={busy} onclick={() => startMerge(g)}>Merge, keeping the selected tile…</button>
            </div>
          {/if}
          {#if refusal && merging === g.key}<p class="error" role="alert" data-merge-refusal>{refusal}</p>{/if}
        </div>
      {/each}
      {#if shown.length > visible.length}
        <p class="more" data-dup-more>
          <span class="muted">Showing {visible.length} of {shown.length} groups.</span>
          <button type="button" class="btn-secondary" onclick={() => (limit += PAGE)}>Show {Math.min(PAGE, shown.length - visible.length)} more</button>
        </p>
      {/if}
    {/if}
  {/if}
</section>

<style>
  .dupes { margin-top: 2rem; padding-top: 1.25rem; border-top: 1px solid var(--border); }
  h3 { margin: 0 0 0.5rem; }
  p { margin: 0.4rem 0; line-height: 1.45; }
  .muted { color: var(--text-secondary); font-size: 0.9rem; }
  .error { color: var(--color-error, #ef4444); }
  .state { padding: 0.6rem 0.8rem; border: 1px solid var(--border); border-left: 3px solid var(--accent); border-radius: 0.4rem; }
  .scope { display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem; margin: 0.6rem 0; }
  .seg { position: relative; padding: 0.25rem 0.8rem; border: 1px solid var(--border); border-radius: 0.4rem; cursor: pointer; }
  .seg.on { background: var(--accent-solid); color: var(--on-accent); border-color: var(--accent-solid); }
  .seg input { position: absolute; opacity: 0; inset: 0; margin: 0; cursor: pointer; }
  .seg:has(input:focus-visible) { outline: 2px solid var(--accent); outline-offset: 2px; }
  .group { margin: 0.75rem 0; padding: 0.6rem 0.8rem; border: 1px solid var(--border); border-left: 3px solid var(--accent); border-radius: 0.4rem; }
  .addr code { overflow-wrap: anywhere; }
  .rows { list-style: none; margin: 0.5rem 0; padding: 0; display: flex; flex-direction: column; gap: 0.4rem; }
  .row { display: flex; flex-wrap: wrap; gap: 0.75rem; justify-content: space-between; align-items: flex-start; }
  .what { display: flex; gap: 0.5rem; align-items: flex-start; min-width: 0; flex: 1 1 18rem; cursor: pointer; }
  .text { display: flex; flex-direction: column; min-width: 0; }
  .name { font-weight: 600; }
  .path, .diff { color: var(--text-secondary); font-size: 0.85rem; overflow-wrap: anywhere; }
  .preview { margin-top: 0.5rem; padding: 0.6rem 0.8rem; border: 1px solid var(--color-error, #ef4444); border-radius: 0.4rem; }
  .more { display: flex; flex-wrap: wrap; align-items: center; gap: 0.75rem; }
  .btns { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-top: 0.4rem; }
</style>
