<script lang="ts">
  import { onMount, tick } from 'svelte';
  import Icon, { listIcons } from '@iconify/svelte';
  import Button from '$lib/components/shared/Button.svelte';
  import Modal from '$lib/components/shared/Modal.svelte';
  import { toast } from '$lib/stores/toast';
  import { confirm } from '$lib/stores/confirmModal';
  import {
    uploadIcon,
    updateIcon,
    deleteIcon,
    getIconUsage,
    createIconCategory,
    updateIconCategory,
    deleteIconCategory,
    IconInUseError,
    CategoryNotEmptyError,
    type Icon as IconRow,
    type IconCategory
  } from '$lib/utils/api';
  import { iconLibrary, loadIconLibrary } from '$lib/icons/iconLibrary';
  import {
    categoryCounts,
    filterIcons,
    isUploadedIcon,
    nameFromFile,
    nameProblem,
    newCategoryId,
    uploadSummary,
    uploadTypeProblem,
    usageSummary,
    usePlace,
    userCategories,
    ICON_UPLOAD_TYPES,
    type IconUsage,
    type IconUse,
    type UploadOutcome
  } from '$lib/icons/iconManage';
  import { GLOBAL_SETTING_GROUPS } from '$lib/settings/globalGroups';

  // Settings › Icons: the user's uploaded icons (the picker's "My Uploads", read from the same
  // shared library) and their own categories. Each icon says where it is used, computed by the
  // server from the stored dashboards; deleting one that is in use lists those places first.
  // Every failure is shown on the page; names are text only.

  const DEFAULT_CATEGORY = 'uploads'; // the built-in Uploads category; the icon editor uses it too
  const UPLOADS_GROUP = GLOBAL_SETTING_GROUPS.find((g) => g.id === 'uploads')!;

  let usage = $state<IconUsage | null>(null);
  let usageError = $state<string | null>(null);

  let query = $state('');
  let filterCategory = $state('');
  let uploadCategory = $state(DEFAULT_CATEGORY);
  let uploading = $state(false);
  let uploadProgress = $state('');
  let uploadResults = $state<UploadOutcome[]>([]);
  let fileInput = $state<HTMLInputElement | null>(null);

  // Edit (rename / recategorise) dialog.
  let editing = $state<IconRow | null>(null);
  let editName = $state('');
  let editCategory = $state('');
  let editError = $state('');
  let editSaving = $state(false);

  // Delete-in-use dialog.
  let inUse = $state<{ icon: IconRow; uses: IconUse[]; note?: string } | null>(null);
  let inUseError = $state('');
  let deletingId = $state<string | null>(null);

  // Categories.
  let newCategoryName = $state('');
  let categoryError = $state('');
  let addingCategory = $state(false);
  let renamingId = $state<string | null>(null);
  let renameText = $state('');
  let renameError = $state('');
  let catDelete = $state<{ category: IconCategory; count: number } | null>(null);
  let catDeleteTarget = $state('');
  let catDeleteError = $state('');
  let catBusy = $state(false);

  let lib = $derived($iconLibrary);
  let loadFailed = $derived(lib.state === 'failed');
  let loaded = $derived(lib.loadedAt !== null);
  let categories = $derived([...lib.categories].sort((a, b) => a.order - b.order));
  let uploads = $derived(lib.icons.filter(isUploadedIcon));
  let shown = $derived(filterIcons(lib.icons, query, filterCategory));
  let counts = $derived(categoryCounts(lib.icons));
  let uploadCounts = $derived(categoryCounts(uploads));
  let mine = $derived(userCategories(lib.categories));
  let builtIns = $derived(categories.filter((c) => c.isPreset));
  let bundledCount = $derived(listIcons('').length);
  let dashboardIconCount = $derived(lib.icons.filter((i) => i.isPreset && i.imageUrl?.startsWith('/api/icons/dashboard/')).length);

  const categoryName = (id: string) => lib.categories.find((c) => c.id === id)?.name ?? id;
  // Unknown (null) when the usage couldn't be read or doesn't cover this icon yet (never "Not used").
  const usesOf = (id: string): IconUse[] | null => (usage && Object.hasOwn(usage.icons, id) ? usage.icons[id] : null);
  // The last usage refresh failed: what is shown is from an earlier check and may be out of date.
  let usageStale = $derived(!!usageError && !!usage);
  // Where a deleted category's icons go by default: Uploads, else the first other category.
  const moveTarget = (fromId: string) =>
    (fromId !== DEFAULT_CATEGORY && categories.some((x) => x.id === DEFAULT_CATEGORY)
      ? DEFAULT_CATEGORY
      : categories.find((x) => x.id !== fromId)?.id) ?? '';
  const errText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

  async function loadUsage() {
    try {
      usage = await getIconUsage();
      usageError = null;
    } catch (e) {
      usageError = errText(e, 'the request failed');
    }
  }

  async function reload() {
    await Promise.all([loadIconLibrary(), loadUsage()]);
  }

  onMount(() => {
    void reload();
  });

  // ── Upload (one or several) ──────────────────────────────────────────
  async function handleFiles(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (files.length === 0) return;
    uploading = true;
    uploadResults = [];
    const results: UploadOutcome[] = [];
    try {
      for (const [i, file] of files.entries()) {
        uploadProgress = files.length > 1 ? `Uploading ${i + 1} of ${files.length}…` : 'Uploading…';
        const bad = uploadTypeProblem(file);
        if (bad) {
          results.push({ file: file.name, ok: false, message: bad });
          continue;
        }
        try {
          const r = await uploadIcon(file, { categoryId: uploadCategory, name: nameFromFile(file.name) });
          results.push({ file: file.name, ok: true, message: `Added as "${r.name}"` });
        } catch (err) {
          results.push({ file: file.name, ok: false, message: errText(err, 'Upload failed') });
        }
      }
    } finally {
      uploadResults = results;
      uploading = false;
      uploadProgress = '';
    }
    if (results.some((r) => r.ok)) await reload();
  }

  // ── Edit: rename and change category ─────────────────────────────────
  function openEdit(icon: IconRow) {
    editing = icon;
    editName = icon.name;
    editCategory = icon.categoryId;
    editError = '';
  }

  async function saveEdit() {
    if (!editing) return;
    const problem = nameProblem(editName, 'icon');
    if (problem) {
      editError = problem;
      return;
    }
    const changes: { name?: string; categoryId?: string } = {};
    if (editName.trim() !== editing.name) changes.name = editName.trim();
    if (editCategory !== editing.categoryId) changes.categoryId = editCategory;
    if (Object.keys(changes).length === 0) {
      editing = null;
      return;
    }
    editSaving = true;
    try {
      await updateIcon(editing.id, changes);
      toast.success('Icon saved');
      editing = null;
      await loadIconLibrary();
    } catch (e) {
      editError = `Couldn't save the icon: ${errText(e, 'the request failed')}`;
    } finally {
      editSaving = false;
    }
  }

  // ── Delete ───────────────────────────────────────────────────────────
  async function startDelete(icon: IconRow) {
    const uses = usesOf(icon.id);
    if (uses && uses.length > 0) {
      inUse = { icon, uses };
      inUseError = '';
      return;
    }
    const ok = await confirm({
      title: 'Delete icon',
      message: uses
        ? `Delete "${icon.name}"? It isn't used on any dashboard. Its image file is removed from HOPS.`
        : `Delete "${icon.name}"? Where it is used couldn't be checked here, so HOPS checks before deleting and stops if it is in use.`,
      confirmText: 'Delete',
      confirmStyle: 'danger'
    });
    if (!ok) return;
    await doDelete(icon, false);
  }

  async function doDelete(icon: IconRow, force: boolean) {
    deletingId = icon.id;
    try {
      await deleteIcon(icon.id, { force });
      inUse = null;
      toast.success(`Deleted "${icon.name}"`);
      await reload();
    } catch (e) {
      if (e instanceof IconInUseError) {
        // In use after all (it changed since the page loaded): show the places before anything goes.
        inUse = { icon, uses: e.usage, note: 'It has been put on a dashboard since this page loaded.' };
        inUseError = '';
      } else if (inUse) {
        inUseError = `Couldn't delete the icon: ${errText(e, 'the request failed')}`;
      } else {
        toast.error(`Couldn't delete "${icon.name}": ${errText(e, 'the request failed')}`);
      }
    } finally {
      deletingId = null;
    }
  }

  // ── Categories ───────────────────────────────────────────────────────
  async function addCategory(e: Event) {
    e.preventDefault();
    const problem = nameProblem(newCategoryName, 'category');
    if (problem) {
      categoryError = problem;
      return;
    }
    const name = newCategoryName.trim();
    if (lib.categories.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      categoryError = `There is already a category called "${name}".`;
      return;
    }
    addingCategory = true;
    try {
      const order = lib.categories.reduce((m, c) => Math.max(m, c.order), 0) + 1;
      await createIconCategory({ id: newCategoryId(name), name, icon: 'mdi:folder-outline', order });
      newCategoryName = '';
      categoryError = '';
      toast.success(`Added category "${name}"`);
      await loadIconLibrary();
    } catch (err) {
      categoryError = `Couldn't add the category: ${errText(err, 'the request failed')}`;
    } finally {
      addingCategory = false;
    }
  }

  async function startRename(c: IconCategory) {
    renamingId = c.id;
    renameText = c.name;
    renameError = '';
    await tick();
    document.getElementById(`rename-${c.id}`)?.focus();
  }

  async function saveRename(c: IconCategory) {
    const problem = nameProblem(renameText, 'category');
    if (problem) {
      renameError = problem;
      return;
    }
    if (renameText.trim() === c.name) {
      renamingId = null;
      return;
    }
    catBusy = true;
    try {
      await updateIconCategory(c.id, { name: renameText.trim() });
      renamingId = null;
      toast.success('Category renamed');
      await loadIconLibrary();
    } catch (err) {
      renameError = `Couldn't rename the category: ${errText(err, 'the request failed')}`;
    } finally {
      catBusy = false;
    }
  }

  async function startCategoryDelete(c: IconCategory) {
    const count = counts.get(c.id) ?? 0;
    if (count > 0) {
      catDelete = { category: c, count };
      catDeleteTarget = moveTarget(c.id);
      catDeleteError = '';
      return;
    }
    const ok = await confirm({
      title: 'Delete category',
      message: `Delete the category "${c.name}"? It has no icons.`,
      confirmText: 'Delete',
      confirmStyle: 'danger'
    });
    if (!ok) return;
    await doCategoryDelete(c, '');
  }

  async function doCategoryDelete(c: IconCategory, moveTo: string) {
    catBusy = true;
    try {
      await deleteIconCategory(c.id, moveTo ? { moveTo } : {});
      if (filterCategory === c.id) filterCategory = '';
      if (uploadCategory === c.id) uploadCategory = DEFAULT_CATEGORY;
      catDelete = null;
      toast.success(moveTo ? `Deleted "${c.name}"; its icons moved to "${categoryName(moveTo)}"` : `Deleted "${c.name}"`);
      await loadIconLibrary();
    } catch (err) {
      if (err instanceof CategoryNotEmptyError) {
        // It gained icons since the page loaded: ask where they go.
        catDelete = { category: c, count: err.iconCount };
        catDeleteTarget = moveTarget(c.id);
        catDeleteError = '';
      } else if (catDelete) {
        catDeleteError = `Couldn't delete the category: ${errText(err, 'the request failed')}`;
      } else {
        toast.error(`Couldn't delete "${c.name}": ${errText(err, 'the request failed')}`);
      }
    } finally {
      catBusy = false;
    }
  }
</script>

<header class="section-header">
  <h2 class="section-title">Icons</h2>
</header>
<p class="lede">
  The icons you have uploaded, and your own categories for them. They appear under "My Uploads" in the icon picker. Each icon
  shows where it is used, so deleting one never breaks an image without warning.
</p>

{#if loadFailed}
  <div class="alert-error block" role="alert">
    Couldn't load the icons: {lib.error}
    {#if loaded}<br />The icons below were loaded earlier and may be out of date.{/if}
    <Button variant="secondary" size="small" icon="mdi:refresh" onclick={() => void reload()}>Retry</Button>
  </div>
{/if}
{#if usageError}
  <div class="alert-error block" role="alert">
    Couldn't work out where the icons are used: {usageError}.{#if usage}{' '}What each icon shows is from an earlier check and may be out of date.{/if}{' '}Deleting still checks first.
    <Button variant="secondary" size="small" icon="mdi:refresh" onclick={() => void loadUsage()}>Retry</Button>
  </div>
{/if}

<section class="block" aria-labelledby="uploads-heading">
  <h3 id="uploads-heading" class="sub-title">Uploaded icons</h3>
  <div class="toolbar">
    <label class="field grow">
      <span>Search icons</span>
      <input type="search" bind:value={query} placeholder="Name…" autocomplete="off" />
    </label>
    <label class="field">
      <span>Show category</span>
      <select bind:value={filterCategory}>
        <option value="">All categories</option>
        {#each categories as c (c.id)}
          <option value={c.id}>{c.name} ({uploadCounts.get(c.id) ?? 0})</option>
        {/each}
      </select>
    </label>
    <label class="field">
      <span>Upload into</span>
      <select bind:value={uploadCategory} disabled={!loaded}>
        {#each categories as c (c.id)}
          <option value={c.id}>{c.name}</option>
        {/each}
      </select>
    </label>
    <div class="field">
      <span aria-hidden="true">&nbsp;</span>
      <Button icon="mdi:upload" onclick={() => fileInput?.click()} loading={uploading} disabled={uploading || !loaded}>Upload icons</Button>
    </div>
    <input
      bind:this={fileInput}
      class="file-input"
      type="file"
      multiple
      accept={ICON_UPLOAD_TYPES.join(',')}
      onchange={handleFiles}
      aria-label="Choose icon images to upload"
    />
  </div>

  {#if uploadProgress}
    <p class="muted" role="status">{uploadProgress}</p>
  {/if}
  {#if uploadResults.length > 0}
    {@const failed = uploadResults.filter((r) => !r.ok)}
    <div class="upload-results" class:has-failed={failed.length > 0} role={failed.length ? 'alert' : 'status'}>
      <p class="results-summary">{uploadSummary(uploadResults)}</p>
      <ul>
        {#each uploadResults as r, i (i)}
          <li class:failed={!r.ok}><span class="file">{r.file}</span>: {r.ok ? r.message : `failed: ${r.message}`}</li>
        {/each}
      </ul>
      <Button variant="ghost" size="small" onclick={() => (uploadResults = [])}>Dismiss</Button>
    </div>
  {/if}

  {#if !loaded && !loadFailed}
    <p class="muted">Loading…</p>
  {:else if loaded}
    {#if uploads.length === 0}
      <div class="empty-state">
        <Icon icon="mdi:image-multiple-outline" />
        <p>No uploaded icons yet. Upload PNG, JPG, GIF, WebP or SVG images, one or several at a time.</p>
      </div>
    {:else if shown.length === 0}
      <p class="muted" role="status">No uploaded icons match{query.trim() ? ` "${query.trim()}"` : ''}{filterCategory ? ` in ${categoryName(filterCategory)}` : ''}.</p>
    {:else}
      <p class="muted count" role="status">
        {shown.length === uploads.length ? `${uploads.length} icon${uploads.length === 1 ? '' : 's'}` : `Showing ${shown.length} of ${uploads.length}`}
      </p>
      <ul class="icon-grid" aria-label="Uploaded icons">
        {#each shown as icon (icon.id)}
          {@const uses = usesOf(icon.id)}
          <li class="icon-card" data-icon-id={icon.id}>
            <div class="thumb"><img src={icon.imageUrl} alt="" loading="lazy" decoding="async" /></div>
            <div class="meta">
              <p class="name">{icon.name}</p>
              <p class="cat">{categoryName(icon.categoryId)}</p>
              <p class="used" class:in-use={uses && uses.length > 0} class:unknown={!uses} class:stale={uses && usageStale}>
                {uses ? usageSummary(uses) : 'Where used: unknown'}{uses && usageStale ? ' (may be out of date)' : ''}
              </p>
            </div>
            <div class="actions">
              <Button variant="secondary" size="small" icon="mdi:pencil" onclick={() => openEdit(icon)} ariaLabel={`Edit ${icon.name}`} />
              <Button
                variant="danger"
                size="small"
                icon="mdi:delete-outline"
                onclick={() => void startDelete(icon)}
                loading={deletingId === icon.id}
                disabled={deletingId !== null}
                ariaLabel={`Delete ${icon.name}`}
              />
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</section>

<section class="block" aria-labelledby="categories-heading">
  <h3 id="categories-heading" class="sub-title">Your categories</h3>
  {#if loaded}
    {#if mine.length === 0}
      <p class="muted">You haven't added any categories yet.</p>
    {:else}
      <ul class="cat-list" aria-label="Your categories">
        {#each mine as c (c.id)}
          {@const n = counts.get(c.id) ?? 0}
          <li class="cat-row">
            {#if renamingId === c.id}
              <form class="rename" onsubmit={(e) => { e.preventDefault(); void saveRename(c); }}>
                <label class="sr-only" for={`rename-${c.id}`}>New name for {c.name}</label>
                <input id={`rename-${c.id}`} type="text" bind:value={renameText} maxlength="100" />
                <Button type="submit" size="small" loading={catBusy}>Save</Button>
                <Button variant="ghost" size="small" onclick={() => (renamingId = null)}>Cancel</Button>
              </form>
              {#if renameError}<p class="field-error" role="alert">{renameError}</p>{/if}
            {:else}
              <span class="cat-name">{c.name}</span>
              <span class="cat-count">{n} icon{n === 1 ? '' : 's'}</span>
              <span class="cat-actions">
                <Button variant="secondary" size="small" icon="mdi:pencil" onclick={() => void startRename(c)} ariaLabel={`Rename ${c.name}`} />
                <Button variant="danger" size="small" icon="mdi:delete-outline" onclick={() => void startCategoryDelete(c)} disabled={catBusy} ariaLabel={`Delete category ${c.name}`} />
              </span>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
    <form class="add-cat" onsubmit={addCategory}>
      <label class="field grow">
        <span>New category name</span>
        <input type="text" bind:value={newCategoryName} maxlength="100" autocomplete="off" />
      </label>
      <div class="field">
        <span aria-hidden="true">&nbsp;</span>
        <Button type="submit" icon="mdi:plus" loading={addingCategory}>Add category</Button>
      </div>
    </form>
    {#if categoryError}<p class="field-error" role="alert">{categoryError}</p>{/if}
    {#if builtIns.length > 0}
      <p class="muted small">
        Built-in categories can't be renamed or deleted, but your icons can go in them:
        {builtIns.map((c) => `${c.name} (${counts.get(c.id) ?? 0})`).join(', ')}.
      </p>
    {/if}
  {:else if !loadFailed}
    <p class="muted">Loading…</p>
  {/if}
</section>

<section class="block note" aria-labelledby="offline-heading">
  <h3 id="offline-heading" class="sub-title">Offline and limits</h3>
  <p class="offline-note">
    {bundledCount} interface icons{#if loaded}{` and ${dashboardIconCount} dashboard-icons`}{/if} are bundled with HOPS, so they draw with no internet
    connection. Uploaded icons are stored on this HOPS server. Other Iconify names are fetched from the internet when first used.
  </p>
  {#if bundledCount === 0}
    <p class="field-error" role="alert">The offline icon set is not loaded in this page, so interface icons need the internet. Reload the page; if it stays, the HOPS build is incomplete.</p>
  {/if}
  <p class="offline-note">
    The largest icon file you can upload is set in <a href={`/settings/global#${UPLOADS_GROUP.id}`}>Global settings › {UPLOADS_GROUP.label}</a>.
  </p>
</section>

{#if editing}
  <Modal id="icon-edit-dialog" title="Edit icon" titleIcon="mdi:pencil" onClose={() => (editing = null)} maxWidth="460px">
    <form class="dialog-form" onsubmit={(e) => { e.preventDefault(); void saveEdit(); }}>
      <div class="dialog-thumb"><img src={editing.imageUrl} alt="" /></div>
      <label class="field">
        <span>Name</span>
        <input type="text" bind:value={editName} maxlength="100" autocomplete="off" />
      </label>
      <label class="field">
        <span>Category</span>
        <select bind:value={editCategory}>
          {#each categories as c (c.id)}
            <option value={c.id}>{c.name}</option>
          {/each}
        </select>
      </label>
      {#if editError}<p class="field-error" role="alert">{editError}</p>{/if}
      <div class="dialog-actions">
        <Button variant="secondary" onclick={() => (editing = null)}>Cancel</Button>
        <Button type="submit" loading={editSaving}>Save</Button>
      </div>
    </form>
  </Modal>
{/if}

{#if inUse}
  {@const target = inUse}
  <Modal id="icon-in-use" title="This icon is in use" titleIcon="mdi:alert-outline" onClose={() => (inUse = null)} maxWidth="560px">
    <div class="dialog-form">
      <p>
        "{target.icon.name}" is used in {target.uses.length} place{target.uses.length === 1 ? '' : 's'}.{#if target.note}{' '}{target.note}{/if}{' '}If you delete it, these will show no image:
      </p>
      <ul class="places" aria-label="Where it is used">
        {#each target.uses as u, i (i)}
          <li>{usePlace(u)}</li>
        {/each}
      </ul>
      {#if inUseError}<p class="field-error" role="alert">{inUseError}</p>{/if}
      <div class="dialog-actions">
        <Button variant="secondary" onclick={() => (inUse = null)}>Keep icon</Button>
        <Button variant="danger" loading={deletingId === target.icon.id} onclick={() => void doDelete(target.icon, true)}>Delete anyway</Button>
      </div>
    </div>
  </Modal>
{/if}

{#if catDelete}
  {@const cd = catDelete}
  <Modal id="category-delete" title="Delete category" titleIcon="mdi:folder-remove-outline" onClose={() => (catDelete = null)} maxWidth="480px">
    <form class="dialog-form" onsubmit={(e) => { e.preventDefault(); void doCategoryDelete(cd.category, catDeleteTarget); }}>
      <p>"{cd.category.name}" has {cd.count} icon{cd.count === 1 ? '' : 's'}. Icons are never deleted with their category: choose where they go.</p>
      <label class="field">
        <span>Move its icons to</span>
        <select bind:value={catDeleteTarget}>
          {#each categories.filter((c) => c.id !== cd.category.id) as c (c.id)}
            <option value={c.id}>{c.name}</option>
          {/each}
        </select>
      </label>
      {#if catDeleteError}<p class="field-error" role="alert">{catDeleteError}</p>{/if}
      <div class="dialog-actions">
        <Button variant="secondary" onclick={() => (catDelete = null)}>Cancel</Button>
        <Button type="submit" variant="danger" loading={catBusy} disabled={!catDeleteTarget}>Move icons and delete</Button>
      </div>
    </form>
  </Modal>
{/if}

<style>
  .block {
    margin-bottom: 1.75rem;
  }

  .sub-title {
    font-size: 1.05rem;
    margin: 0 0 0.75rem;
    color: var(--text-primary);
  }

  .alert-error :global(button) {
    margin-left: 0.5rem;
  }

  .toolbar,
  .add-cat {
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
  .field select,
  .rename input {
    padding: 0.45rem 0.6rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--bg-secondary);
    color: var(--text-primary);
    font: inherit;
    font-size: 0.9rem;
    min-width: 0;
  }

  .file-input {
    display: none;
  }

  .muted {
    color: var(--text-secondary);
  }

  .small {
    font-size: 0.85rem;
  }

  .count {
    margin: 0 0 0.5rem;
    font-size: 0.85rem;
  }

  .upload-results {
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: 0.6rem 0.9rem;
    margin-bottom: 1rem;
    background: var(--bg-secondary);
  }

  .upload-results.has-failed {
    border-color: var(--color-error);
  }

  .upload-results ul {
    margin: 0.25rem 0 0.5rem;
    padding-left: 1.2rem;
  }

  .upload-results li.failed,
  .field-error {
    color: var(--color-error-text);
  }

  .results-summary {
    margin: 0;
    font-weight: 600;
    color: var(--text-primary);
  }

  .file {
    overflow-wrap: anywhere;
  }

  .field-error {
    margin: 0.25rem 0 0;
    font-size: 0.875rem;
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

  .thumb,
  .dialog-thumb {
    width: 48px;
    height: 48px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 0.4rem;
    background: var(--bg-tertiary);
  }

  .thumb img,
  .dialog-thumb img {
    max-width: 40px;
    max-height: 40px;
    object-fit: contain;
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

  .actions,
  .cat-actions {
    display: flex;
    gap: 0.35rem;
  }

  .cat-list {
    list-style: none;
    margin: 0 0 1rem;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
  }

  .cat-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 1rem;
    padding: 0.5rem 0.75rem;
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

  .rename {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    flex: 1;
  }

  .rename input {
    flex: 1 1 12rem;
  }

  .offline-note {
    margin: 0 0 0.4rem;
    color: var(--text-secondary);
    font-size: 0.9rem;
  }

  .offline-note a {
    color: var(--text-primary);
    text-decoration: underline;
  }

  .dialog-form {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .dialog-form p {
    margin: 0;
    color: var(--text-primary);
    overflow-wrap: anywhere;
  }

  .places {
    margin: 0;
    padding-left: 1.2rem;
    max-height: 40vh;
    overflow: auto;
    color: var(--text-primary);
    overflow-wrap: anywhere;
  }

  .dialog-actions {
    display: flex;
    justify-content: flex-end;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  @media (max-width: 640px) {
    .icon-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
