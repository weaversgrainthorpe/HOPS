<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte';
  import Icon, { iconLoaded, listIcons, loadIcons } from '@iconify/svelte';
  import Button from '$lib/components/shared/Button.svelte';
  import { toast } from '$lib/stores/toast';
  import { iconLibrary } from '$lib/icons/iconLibrary';
  import { loadIconNames } from '$lib/icons/iconNames';
  import { usageSummary, type IconUsage } from '$lib/icons/iconManage';
  import {
    buildPackagedPool,
    packagedUses,
    paginate,
    searchPackaged,
    PACKAGED_PAGE_SIZE,
    SOURCE_LABEL,
    SOURCE_ORDER,
    type PackagedIcon,
    type PackagedInfo,
    type PackagedSource
  } from '$lib/icons/packagedIcons';
  import { SuggestionPreviewLoader } from '$lib/utils/suggestionPreview';
  import { copyText } from '$lib/utils/clipboard';

  // Settings › Icons › Packaged icons: read-only. One search across everything that ships with
  // HOPS (Dashboard Icons, the preset library, Material Design and Simple Icons), a source filter,
  // and one page of results at a time. Offline icons draw at once; an online-only name is fetched
  // only after a pause, in one batch (the icon editor's SuggestionPreviewLoader), and a failure
  // shows the "Preview unavailable" glyph. No edit or delete: only "Copy name".

  interface Props {
    /** GET /api/icons/packaged, or null when not loaded. */
    info: PackagedInfo | null;
    infoError: string | null;
    onRetryInfo: () => void;
    usage: IconUsage | null;
    /** The last usage refresh failed: what is shown may be out of date. */
    usageStale: boolean;
  }

  let { info, infoError, onRetryInfo, usage, usageStale }: Props = $props();

  const bundled = listIcons('');
  let allNames = $state<string[] | null>(null);
  let namesState = $state<'loading' | 'ok' | 'failed'>('loading');
  let namesError = $state('');

  function loadNames() {
    namesState = 'loading';
    loadIconNames().then(
      (n) => {
        allNames = n.suggest;
        namesState = 'ok';
      },
      (err) => {
        namesError = err instanceof Error && err.message ? err.message : String(err);
        namesState = 'failed';
      }
    );
  }
  onMount(loadNames);

  let query = $state('');
  let source = $state<PackagedSource | ''>('');
  let category = $state('');
  let page = $state(1);

  let lib = $derived($iconLibrary);
  let pool = $derived(
    buildPackagedPool({ dashboardNames: info?.dashboardNames ?? null, libraryIcons: lib.icons, bundled, allNames })
  );
  let results = $derived(searchPackaged(pool, query, source, category));
  let shown = $derived(paginate(results, page, PACKAGED_PAGE_SIZE));
  let builtIns = $derived([...lib.categories].filter((c) => c.isPreset).sort((a, b) => a.order - b.order));
  let packagedPerCategory = $derived.by(() => {
    const m = new Map<string, number>();
    for (const i of pool) if (i.categoryId) m.set(i.categoryId, (m.get(i.categoryId) ?? 0) + 1);
    return m;
  });
  const categoryName = (id: string) => lib.categories.find((c) => c.id === id)?.name ?? id;

  // A new search or filter starts at the first page.
  $effect(() => {
    void query;
    void source;
    void category;
    untrack(() => (page = 1));
  });

  // ── Pictures for online-only names ───────────────────────────────────
  let previewTick = $state(0);
  const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;
  const pictures = new SuggestionPreviewLoader({
    load: (names, done) =>
      loadIcons(names, (loaded, missing, pending) => {
        const full = (l: { prefix: string; name: string }[]) => l.map((i) => `${i.prefix}:${i.name}`);
        done(full(loaded), full(missing), full(pending));
      }),
    isLoaded: (name) => iconLoaded(name),
    isOnline,
    onChange: () => {
      previewTick++;
    }
  });
  onDestroy(() => pictures.dispose());

  // The page on show changed: once it has been stable for the pause, fetch its online-only
  // pictures in one batch. Typing restarts the pause, so nothing is fetched per keystroke.
  $effect(() => {
    const names = shown.items.filter((i) => i.icon && !i.offline).map((i) => i.icon as string);
    untrack(() => pictures.schedule(names));
  });

  function pictureState(name: string) {
    void previewTick;
    return pictures.state(name);
  }

  // Dashboard Icons images that failed to load (shown as unavailable, never a blank box).
  let brokenImages = $state<Record<string, true>>({});

  async function copyName(item: PackagedIcon) {
    try {
      await copyText(item.name);
      toast.success(`Copied "${item.name}"`);
    } catch (e) {
      toast.error(`Couldn't copy "${item.name}": ${e instanceof Error && e.message ? e.message : 'the browser refused'}`);
    }
  }

  function showCategory(id: string) {
    category = id;
    source = '';
    document.getElementById('packaged-results')?.scrollIntoView?.({ block: 'start' });
  }

  const fmt = (n: number) => n.toLocaleString('en-GB');
</script>

<section class="block" aria-labelledby="packaged-heading">
  <h3 id="packaged-heading" class="sub-title">Packaged icons</h3>
  <p class="muted small intro">
    Icons that come with HOPS. They can't be changed or deleted here; search them, see which set each is from and whether it
    works with no internet, and copy a name to use in the icon editor.
  </p>

  {#if infoError}
    <div class="alert-error" role="alert">
      Couldn't load the Dashboard Icons list from the server: {infoError}.{' '}
      {#if lib.loadedAt}Only the Dashboard Icons in the icon library are listed.{/if}
      <Button variant="secondary" size="small" icon="mdi:refresh" onclick={onRetryInfo}>Retry</Button>
    </div>
  {/if}
  {#if namesState === 'failed'}
    <div class="alert-error" role="alert">
      Couldn't load the full Material Design and Simple Icons name lists: {namesError}. Only their offline icons are listed.
      <Button variant="secondary" size="small" icon="mdi:refresh" onclick={loadNames}>Retry</Button>
    </div>
  {/if}

  <div class="toolbar">
    <label class="field grow">
      <span>Search packaged icons</span>
      <input type="search" bind:value={query} placeholder="Name, e.g. plex or mdi:server…" autocomplete="off" />
    </label>
    <div class="field">
      <label for="packaged-source">Source</label>
      <select id="packaged-source" bind:value={source}>
        <option value="">All sources</option>
        {#each SOURCE_ORDER as s (s)}
          <option value={s}>{SOURCE_LABEL[s]}</option>
        {/each}
      </select>
    </div>
    <div class="field">
      <label for="packaged-category">Built-in category</label>
      <select id="packaged-category" bind:value={category}>
        <option value="">Any category</option>
        {#each builtIns as c (c.id)}
          <option value={c.id}>{c.name}</option>
        {/each}
      </select>
    </div>
  </div>

  <div id="packaged-results">
    {#if results.length === 0}
      <p class="muted" role="status">
        No packaged icons match{query.trim() ? ` "${query.trim()}"` : ''}{source ? ` in ${SOURCE_LABEL[source]}` : ''}{category ? ` in ${categoryName(category)}` : ''}.
        {#if namesState === 'loading'}The full name lists are still loading.{/if}
      </p>
    {:else}
      <p class="muted count" role="status">
        Showing {fmt(shown.start)}–{fmt(shown.end)} of {fmt(shown.total)}{namesState === 'loading' ? ' (the full name lists are still loading)' : ''}
      </p>
      <ul class="icon-grid" aria-label="Packaged icons">
        {#each shown.items as item (item.key)}
          {@const uses = packagedUses(usage, item)}
          <li class="icon-card" data-key={item.key} data-source={item.source}>
            <div class="thumb">
              {#if item.imageUrl}
                {#if brokenImages[item.imageUrl]}
                  <span class="unavailable" data-preview="unavailable" role="img" aria-label="Preview unavailable" title="Preview unavailable">
                    <Icon icon="mdi:image-off-outline" width="28" />
                  </span>
                {:else}
                  {@const url = item.imageUrl}
                  <img src={url} alt="" loading="lazy" decoding="async" data-preview="ready" onerror={() => (brokenImages = { ...brokenImages, [url]: true })} />
                {/if}
              {:else if item.icon}
                {@const pic = pictureState(item.icon)}
                {#if pic === 'ready'}
                  <span data-preview="ready" aria-hidden="true"><Icon icon={item.icon} width="32" /></span>
                {:else if pic === 'loading'}
                  <span data-preview="loading" role="img" aria-label="Loading preview" title="Loading preview"><span class="loading-mark"></span></span>
                {:else}
                  {@const why = pic === 'offline' ? 'Preview unavailable (offline)' : 'Preview unavailable'}
                  <span class="unavailable" data-preview={pic} role="img" aria-label={why} title={why}>
                    <Icon icon="mdi:image-off-outline" width="28" />
                  </span>
                {/if}
              {/if}
            </div>
            <div class="meta">
              <p class="name">{item.label}</p>
              {#if item.name !== item.label}<p class="code">{item.name}</p>{/if}
              <p class="set">
                <span class="badge">{SOURCE_LABEL[item.source]}</span>
                <span class="badge" class:online={!item.offline}>{item.offline ? 'Offline' : 'Online only'}</span>
                {#if item.categoryId}<span class="cat">{categoryName(item.categoryId)}</span>{/if}
              </p>
              <p class="used" class:in-use={uses && uses.length > 0} class:unknown={!uses} class:stale={uses && usageStale}>
                {uses ? usageSummary(uses) : 'Where used: unknown'}{uses && usageStale ? ' (may be out of date)' : ''}
              </p>
            </div>
            <div class="actions">
              <Button variant="secondary" size="small" icon="mdi:content-copy" onclick={() => void copyName(item)} ariaLabel={`Copy name ${item.name}`} />
            </div>
          </li>
        {/each}
      </ul>
      {#if shown.pages > 1}
        <nav class="pager" aria-label="Packaged icons pages">
          <Button variant="secondary" size="small" icon="mdi:chevron-left" disabled={shown.page <= 1} onclick={() => (page = shown.page - 1)}>Previous</Button>
          <span class="muted">Page {fmt(shown.page)} of {fmt(shown.pages)}</span>
          <Button variant="secondary" size="small" icon="mdi:chevron-right" disabled={shown.page >= shown.pages} onclick={() => (page = shown.page + 1)}>Next</Button>
        </nav>
      {/if}
    {/if}
  </div>

  <h4 class="minor-title">Built-in categories</h4>
  {#if builtIns.length === 0}
    <p class="muted">{lib.loadedAt ? 'There are no built-in categories.' : 'Loading…'}</p>
  {:else}
    <p class="muted small">They come with HOPS and can't be renamed or deleted; your own icons can go in them.</p>
    <ul class="cat-list" aria-label="Built-in categories">
      {#each builtIns as c (c.id)}
        {@const n = packagedPerCategory.get(c.id) ?? 0}
        <li class="cat-row">
          <span class="cat-name">{c.name}</span>
          <span class="cat-count">{fmt(n)} packaged icon{n === 1 ? '' : 's'}</span>
          <Button variant="ghost" size="small" onclick={() => showCategory(c.id)} disabled={n === 0} ariaLabel={`Show ${c.name}`}>Show</Button>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .block {
    margin-bottom: 1.75rem;
  }

  .sub-title {
    font-size: 1.05rem;
    margin: 0 0 0.5rem;
    color: var(--text-primary);
  }

  .minor-title {
    font-size: 0.95rem;
    margin: 1.25rem 0 0.4rem;
    color: var(--text-primary);
  }

  .intro {
    margin: 0 0 0.75rem;
  }

  .muted {
    color: var(--text-secondary);
  }

  .small {
    font-size: 0.85rem;
  }

  .alert-error {
    margin-bottom: 0.75rem;
  }

  .alert-error :global(button) {
    margin-left: 0.5rem;
  }

  .toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 0.75rem 1rem;
    margin-bottom: 1rem;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.85rem;
    color: var(--text-secondary);
  }

  .field.grow {
    flex: 1 1 14rem;
  }

  .field input,
  .field select {
    padding: 0.45rem 0.6rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--bg-secondary);
    color: var(--text-primary);
    font: inherit;
    font-size: 0.9rem;
    min-width: 0;
  }

  .count {
    margin: 0 0 0.5rem;
    font-size: 0.85rem;
  }

  .icon-grid {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
    gap: 0.75rem;
  }

  .icon-card {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 0.75rem;
    padding: 0.65rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--bg-secondary);
    min-width: 0;
  }

  .thumb {
    width: 48px;
    height: 48px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 0.4rem;
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }

  .thumb img {
    max-width: 40px;
    max-height: 40px;
    object-fit: contain;
  }

  .thumb span {
    display: inline-flex;
  }

  .unavailable {
    color: var(--text-secondary);
  }

  .loading-mark {
    width: 28px;
    height: 28px;
    border-radius: 4px;
    background: var(--text-secondary);
    opacity: 0.25;
    animation: packaged-pulse 1.2s ease-in-out infinite;
  }

  @keyframes packaged-pulse {
    50% {
      opacity: 0.1;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .loading-mark {
      animation: none;
    }
  }

  .meta {
    min-width: 0;
  }

  .meta p {
    margin: 0;
    overflow-wrap: anywhere;
  }

  .name {
    font-weight: 600;
    color: var(--text-primary);
  }

  .code {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.75rem;
    color: var(--text-secondary);
  }

  .set {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 0.4rem;
    align-items: center;
    margin: 0.15rem 0 !important;
  }

  .badge {
    font-size: 0.7rem;
    padding: 0.05rem 0.4rem;
    border: 1px solid var(--border);
    border-radius: 999px;
    color: var(--text-secondary);
  }

  .badge.online {
    font-style: italic;
  }

  .cat,
  .used {
    font-size: 0.8rem;
    color: var(--text-secondary);
  }

  .used.in-use {
    color: var(--text-primary);
  }

  .used.unknown,
  .used.stale {
    font-style: italic;
  }

  .actions {
    display: flex;
    gap: 0.35rem;
  }

  .pager {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    margin-top: 0.75rem;
  }

  .cat-list {
    list-style: none;
    margin: 0;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
  }

  .cat-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 1rem;
    padding: 0.4rem 0.75rem;
    border-bottom: 1px solid var(--border);
  }

  .cat-row:last-child {
    border-bottom: none;
  }

  .cat-name {
    flex: 1 1 10rem;
    color: var(--text-primary);
    overflow-wrap: anywhere;
  }

  .cat-count {
    color: var(--text-secondary);
    font-size: 0.85rem;
  }

  @media (max-width: 640px) {
    .icon-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
