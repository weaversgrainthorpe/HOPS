<script lang="ts">
  // Settings › Dashboards › Tab order: a list for big reorders of one dashboard's tabs (moving one
  // tab a long way, or rearranging many). Nothing changes on the dashboard until Save, which is one
  // revision-checked save of that dashboard with only the tab order changed (the same operation the
  // editor uses). It is refused visibly while that dashboard is being edited, and when the
  // dashboard changed elsewhere the user's arrangement is kept and re-applied to the latest version.
  import { tick } from 'svelte';
  import { get } from 'svelte/store';
  import Icon from '@iconify/svelte';
  import { config, configError, applySavedLayout, showSaveWarning, loadConfig, findLayoutDashboard } from '$lib/stores/config';
  import { session, parkedDraft } from '$lib/stores/editSession';
  import { saveDashboardV3, ConflictError } from '$lib/utils/api';
  import { reorderTabs } from '$lib/editor/treeOps';
  import { moveBlock, sortByName, mergeAfterConflict } from '$lib/editor/tabOrder';
  import { toast } from '$lib/stores/toast';

  let { dashboardId }: { dashboardId: string } = $props();

  const dash = $derived(findLayoutDashboard(dashboardId, $config));
  const nameOf = $derived(new Map((dash?.tabs ?? []).map((t) => [t.id, t.name])));

  /** The working order (tab ids). `saved` is the order stored on the server; Discard returns to it. */
  let order = $state<string[]>([]);
  let saved = $state<string[]>([]);
  let history = $state<string[][]>([]);
  let ticked = $state(new Set<string>());
  let filter = $state('');
  let position = $state(1);
  let busy = $state(false);
  let problem = $state('');
  let ready = $state(false);

  // Take the dashboard's order once it is known; later config changes (a save, a reload) are
  // handled by the save itself, so a background refresh never throws the user's arrangement away.
  $effect(() => {
    if (!ready && dash) {
      const ids = dash.tabs.map((t) => t.id);
      order = ids;
      saved = ids;
      ready = true;
    }
  });

  const dirty = $derived(order.length !== saved.length || order.some((id, i) => id !== saved[i]));
  const shown = $derived.by(() => {
    const f = filter.trim().toLowerCase();
    return order
      .map((id, i) => ({ id, pos: i + 1, name: nameOf.get(id) ?? id }))
      .filter((r) => !f || r.name.toLowerCase().includes(f));
  });

  function commit(next: string[]) {
    history = [...history, order];
    order = next;
  }
  function moveIds(ids: Set<string>, to: number) {
    commit(moveBlock(order, ids, to));
  }
  /** Moves one row by a button, then puts keyboard focus back on the same control. */
  async function moveRow(id: string, to: number, control: string) {
    moveIds(new Set([id]), to);
    await tick();
    document.querySelector<HTMLElement>(`[data-tab-row="${CSS.escape(id)}"] [data-ctl="${control}"]:not(:disabled)`)?.focus();
  }
  function toggle(id: string, on: boolean) {
    const next = new Set(ticked);
    if (on) next.add(id);
    else next.delete(id);
    ticked = next;
  }
  function moveTicked(to: number) {
    if (!ticked.size) return;
    moveIds(new Set(ticked), to);
  }
  function moveToPosition() {
    const n = Math.floor(Number(position));
    moveTicked((Number.isFinite(n) && n >= 1 ? n : 1) - 1);
  }
  function sortAz() {
    commit(sortByName(order.map((id) => ({ id, name: nameOf.get(id) ?? id }))));
  }
  function undo() {
    if (!history.length) return;
    order = history[history.length - 1];
    history = history.slice(0, -1);
  }
  function discard() {
    order = saved;
    history = [];
    problem = '';
  }

  // Drag and drop. Dragging a ticked row moves every ticked row.
  let dragId = $state<string | null>(null);
  let overId = $state<string | null>(null);
  let listEl: HTMLElement | undefined = $state();
  function dragOver(e: DragEvent, id: string) {
    if (!dragId) return;
    e.preventDefault();
    overId = id;
    if (listEl) {
      const r = listEl.getBoundingClientRect();
      if (e.clientY < r.top + 40) listEl.scrollTop -= 20;
      else if (e.clientY > r.bottom - 40) listEl.scrollTop += 20;
    }
  }
  function drop(e: DragEvent, id: string) {
    if (!dragId) return;
    e.preventDefault();
    const ids = ticked.has(dragId) ? new Set(ticked) : new Set([dragId]);
    dragId = overId = null;
    if (ids.has(id)) return;
    const rest = order.filter((x) => !ids.has(x));
    const at = rest.indexOf(id);
    // Dropped on a row further down than the dragged one: land after it (otherwise before it).
    const movingDown = order.findIndex((x) => ids.has(x)) < order.indexOf(id);
    moveIds(ids, at + (movingDown ? 1 : 0));
  }

  async function save() {
    if (busy || !dash || !dirty) return;
    problem = '';
    // Refuse before anything is sent if this dashboard is open for editing.
    const editing = new Set([get(session)?.dashboardId, get(parkedDraft)?.dashboardId].filter(Boolean));
    if (editing.has(dash.id)) {
      problem = `Not saved: "${dash.name}" is being edited (an edit session or unsaved draft is open). Save or discard that first, then save the tab order.`;
      return;
    }
    busy = true;
    const d = dash;
    const attempt = order;
    try {
      const resp = await saveDashboardV3(d.id, reorderTabs(d, attempt), d.revision);
      applySavedLayout(resp);
      if (resp.warning) showSaveWarning(resp.warning);
      saved = attempt;
      history = [];
      ticked = new Set();
      toast.success('Tab order saved');
    } catch (e) {
      if (e instanceof ConflictError) await afterConflict(d);
      else problem = `Not saved: ${e instanceof Error ? e.message : 'the request failed'}. Your order is kept.`;
    } finally {
      busy = false;
    }
  }

  /** Reload the dashboard and re-apply the user's arrangement to it; nothing is sent until Save is clicked again. */
  async function afterConflict(old: NonNullable<typeof dash>) {
    const userTabs = order.map((id) => ({ id, name: old.tabs.find((t) => t.id === id)?.name ?? id }));
    await loadConfig();
    const fresh = findLayoutDashboard(dashboardId, get(config));
    if (get(configError) || !fresh || fresh.revision === old.revision) {
      problem = fresh && !get(configError)
        ? 'Not saved: this dashboard was changed somewhere else, but its latest version could not be read. Your order is kept. Try Save again.'
        : `Not saved: this dashboard was changed somewhere else, and its latest version could not be read${get(configError) ? ` (${get(configError)})` : ''}. Your order is kept. Reload the page before trying again.`;
      return;
    }
    const m = mergeAfterConflict(userTabs, fresh.tabs);
    saved = fresh.tabs.map((t) => t.id);
    order = m.order;
    history = [];
    ticked = new Set([...ticked].filter((id) => m.order.includes(id)));
    problem =
      'Not saved: this dashboard was changed somewhere else. Your order is kept and applied to the latest version' +
      (m.added.length ? ` — new tabs added at the end: ${m.added.join(', ')}` : '') +
      (m.removed.length ? ` — tabs no longer there: ${m.removed.join(', ')}` : '') +
      '. Check it and Save again.';
  }
</script>

<section class="tab-order">
  {#if !dash && !$config}
    <p class="muted" role="status">Loading…</p>
  {:else if !dash}
    <p>There is no dashboard with that id. It may have been deleted.</p>
    <p><a href="/settings/dashboards">Back to Settings › Dashboards</a></p>
  {:else if dash.tabs.length < 2}
    <h2 class="section-title">Tab order: {dash.name}</h2>
    <p>This dashboard has only one tab, so there is nothing to reorder.</p>
    <p><a href="/settings/dashboards">Back to Settings › Dashboards</a></p>
  {:else}
    <h2 class="section-title">Tab order: {dash.name} <span class="count">({order.length} tabs)</span></h2>
    <p class="muted">Drag a row by its handle, use ↑ ↓, or type a position. Tick several rows to move them together. Nothing changes on the dashboard until you Save.</p>

    <div class="bar">
      <input type="search" class="find" placeholder="Find a tab…" aria-label="Find a tab" bind:value={filter} />
      <span class="muted">{ticked.size} ticked</span>
      <button type="button" class="btn-secondary" disabled={!ticked.size} onclick={() => moveTicked(0)}>Move ticked to top</button>
      <button type="button" class="btn-secondary" disabled={!ticked.size} onclick={() => moveTicked(order.length)}>Move ticked to bottom</button>
      <label class="pos">Move ticked to position
        <input type="number" min="1" max={order.length} bind:value={position} disabled={!ticked.size} />
      </label>
      <button type="button" class="btn-secondary" disabled={!ticked.size} onclick={moveToPosition}>Move</button>
      <button type="button" class="btn-secondary" onclick={sortAz}>Sort A→Z</button>
    </div>

    <ul class="list" bind:this={listEl}>
      {#each shown as r (r.id)}
        <li
          class="row"
          class:sel={ticked.has(r.id)}
          class:over={overId === r.id && dragId !== r.id}
          data-tab-row={r.id}
          draggable="true"
          ondragstart={(e) => { dragId = r.id; if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', r.id); } }}
          ondragover={(e) => dragOver(e, r.id)}
          ondragleave={() => { if (overId === r.id) overId = null; }}
          ondrop={(e) => drop(e, r.id)}
          ondragend={() => { dragId = overId = null; }}
        >
          <button type="button" class="grip" aria-label="Drag {r.name}" title="Drag"><Icon icon="mdi:drag" width="20" /></button>
          <input type="checkbox" aria-label={r.name} checked={ticked.has(r.id)} onchange={(e) => toggle(r.id, e.currentTarget.checked)} />
          <span class="num">{r.pos}</span>
          <span class="name">{r.name}</span>
          <span class="acts">
            <button type="button" class="btn-secondary" data-ctl="up" aria-label="Move {r.name} up" title="Up" disabled={r.pos === 1} onclick={() => moveRow(r.id, r.pos - 2, 'up')}>↑</button>
            <button type="button" class="btn-secondary" data-ctl="down" aria-label="Move {r.name} down" title="Down" disabled={r.pos === order.length} onclick={() => moveRow(r.id, r.pos, 'down')}>↓</button>
            <button type="button" class="btn-secondary" data-ctl="top" aria-label="Move {r.name} to the top" title="To the top" disabled={r.pos === 1} onclick={() => moveRow(r.id, 0, 'down')}>⤒</button>
            <button type="button" class="btn-secondary" data-ctl="bottom" aria-label="Move {r.name} to the bottom" title="To the bottom" disabled={r.pos === order.length} onclick={() => moveRow(r.id, order.length, 'up')}>⤓</button>
          </span>
        </li>
      {/each}
    </ul>

    {#if problem}<p class="error" role="alert" data-tab-order-problem>{problem}</p>{/if}

    <div class="foot">
      <span class="status" role="status">{dirty ? 'Unsaved changes' : 'No changes'}</span>
      <button type="button" class="btn-secondary" disabled={!history.length || busy} onclick={undo}>Undo</button>
      <button type="button" class="btn-secondary" disabled={!dirty || busy} onclick={discard}>Discard changes</button>
      <button type="button" class="btn-primary" disabled={!dirty || busy} onclick={save}>{busy ? 'Saving…' : 'Save order'}</button>
    </div>
  {/if}
</section>

<style>
  p { margin: 0.4rem 0; line-height: 1.45; }
  .muted { color: var(--text-secondary); font-size: 0.9rem; }
  .count { font-weight: normal; color: var(--text-secondary); font-size: 0.9em; }
  .error { color: var(--color-error, #ef4444); }
  .bar { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; margin: 0.75rem 0; }
  .find { min-width: 12rem; }
  .pos { display: inline-flex; align-items: center; gap: 0.4rem; }
  .pos input { width: 4.5rem; }
  .list { list-style: none; margin: 0; padding: 0; max-height: 60vh; overflow: auto; border: 1px solid var(--border); border-radius: 0.5rem; }
  .row { display: flex; align-items: center; gap: 0.6rem; padding: 0.35rem 0.6rem; border-bottom: 1px solid var(--border); }
  .row.sel { background: color-mix(in srgb, var(--accent-solid) 14%, transparent); }
  .row.over { box-shadow: inset 0 3px 0 var(--accent-solid); }
  .grip { cursor: grab; background: none; border: none; color: var(--text-secondary); padding: 0.1rem; display: inline-flex; }
  .num { min-width: 2.2rem; text-align: right; color: var(--text-secondary); font-variant-numeric: tabular-nums; }
  .name { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .acts { display: inline-flex; gap: 0.25rem; }
  .acts button { padding: 0.15rem 0.5rem; }
  .foot { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; justify-content: flex-end; margin-top: 0.75rem; }
  .status { margin-right: auto; color: var(--text-secondary); font-size: 0.9rem; }
</style>
