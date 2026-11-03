<script lang="ts">
  import ActionButton from '$lib/components/shared/ActionButton.svelte';
  import {
    dashboards, loadConfig, createDashboard, renameDashboard, deleteDashboard, reorderDashboards, dashboardHref
  } from '$lib/stores/config';
  import { confirm } from '$lib/stores/confirmModal';
  import { toast } from '$lib/stores/toast';
  import { goto } from '$app/navigation';
  import { exportConfig } from '$lib/utils/api';
  import { missingAssetsWarning } from '$lib/utils/exportResult';
  import type { LayoutDashboard } from '$lib/types/layout';
  import { tick } from 'svelte';
  import Icon from '@iconify/svelte';
  import ImportModal from './ImportModal.svelte';
  import { suggestDashboardPath } from '$lib/utils/dashboardPath';
  import QRCodeModal from './QRCodeModal.svelte';
  import ReorderButtons, { type ReorderMove } from '$lib/components/shared/ReorderButtons.svelte';

  // Every write goes through its own endpoint (create, rename at the stored
  // revision, delete with the revision, reorder); a refusal is shown by the
  // store and the form stays as it was, so nothing unsaved ever looks saved.
  let editingId = $state<string | null>(null);
  let editName = $state('');
  let editPath = $state('');
  let showImport = $state(false);
  let exportingId = $state<string | null>(null);
  let exportingAll = $state(false);
  let qrDashboard = $state<LayoutDashboard | null>(null);
  let creatingNew = $state(false);
  let newName = $state('');
  let newPath = $state('');
  // The path follows the name until the user types in the path field themselves.
  let pathEdited = $state(false);
  let busy = $state(false);

  async function handleNew() {
    creatingNew = true;
    newName = '';
    newPath = '';
    pathEdited = false;
    // Programmatic focus after the next render — friendlier than `autofocus`
    // which steals focus mid-page-read for screen-reader users (WCAG 2.4.3).
    await tick();
    document.getElementById('new-name')?.focus();
  }

  function cancelNew() {
    creatingNew = false;
    newName = '';
    newPath = '';
  }

  async function saveNew() {
    if (!newName.trim() || busy) return;
    busy = true;
    try {
      await createDashboard(newName.trim(), newPath.trim() || suggestedPath());
    } catch {
      return; // not created; the store already showed why. Keep the form as-is.
    } finally {
      busy = false;
    }
    cancelNew();
  }

  function suggestedPath() {
    return suggestDashboardPath(newName, $dashboards.map((d) => d.path));
  }

  function onNewNameInput() {
    if (!pathEdited) newPath = newName.trim() ? suggestedPath() : '';
  }

  async function handleDelete(dashboard: LayoutDashboard) {
    const confirmed = await confirm({
      title: 'Delete Dashboard',
      message: `Are you sure you want to delete "${dashboard.name}"? This action cannot be undone.`,
      confirmText: 'Delete',
      confirmStyle: 'danger'
    });
    if (!confirmed) return;
    try {
      await deleteDashboard(dashboard.id);
    } catch {
      // not deleted; the store already raised a toast/banner.
    }
  }

  function startEdit(dashboard: LayoutDashboard) {
    editingId = dashboard.id;
    editName = dashboard.name;
    editPath = dashboard.path;
  }

  function cancelEdit() {
    editingId = null;
    editName = '';
    editPath = '';
  }

  async function saveEdit(dashboard: LayoutDashboard) {
    if (busy) return;
    busy = true;
    try {
      await renameDashboard(dashboard.id, { name: editName, path: editPath });
    } catch {
      return; // not saved; keep the edit row open.
    } finally {
      busy = false;
    }
    editingId = null;
  }

  /** Move a dashboard one place (up or down) or all the way (to the top or bottom) in the display order. */
  async function move(index: number, how: ReorderMove, id: string) {
    const list = $dashboards;
    const to = how === 'up' ? index - 1 : how === 'down' ? index + 1 : how === 'top' ? 0 : list.length - 1;
    if (busy || to < 0 || to >= list.length || to === index) return;
    const ids = list.map((d) => d.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(to, 0, moved);
    busy = true;
    try {
      await reorderDashboards(ids);
    } catch {
      // not saved; the store already showed why, and the list keeps the stored order.
    } finally {
      busy = false;
    }
    // The buttons were off while saving, so put keyboard focus back on one of the same row: the
    // one that was used, or (from the top or bottom, where it is now off) the way back.
    await tick();
    const ctl = how === 'top' ? 'down' : how === 'bottom' ? 'up' : how;
    document.querySelector<HTMLElement>(`[data-dashboard-id="${CSS.escape(id)}"] [data-ctl="${ctl}"]:not(:disabled)`)?.focus();
  }

  async function openDashboard(dashboard: LayoutDashboard) {
    // Land on the dashboard in view mode. Admins toggle edit mode from the
    // navbar when they actually want to make changes — auto-enabling it on
    // arrival meant a stray click could change tiles before the admin had
    // even looked at the dashboard.
    await goto(dashboardHref(dashboard.path));
  }

  /** Every dashboard in one file (dashboards only: not a backup), which Import reads back. */
  async function handleExportAll() {
    exportingAll = true;
    try {
      const { blob, missing, importWarning } = await exportConfig('json', 'all-dashboards');
      download(blob, `hops-all-dashboards-${new Date().toISOString().split('T')[0]}.json`);
      const warning = missingAssetsWarning(missing);
      if (warning) toast.warning(warning, 0);
      if (importWarning) toast.warning(importWarning, 0);
      if (!warning && !importWarning) toast.success('All dashboards exported');
    } catch (err) {
      toast.error(err instanceof Error && err.message ? `Export failed: ${err.message}` : 'Export failed');
    } finally {
      exportingAll = false;
    }
  }

  function download(blob: Blob, filename: string) {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  }

  async function handleExport(dashboard: LayoutDashboard) {
    exportingId = dashboard.id;
    try {
      // Export only this specific dashboard
      const { blob, missing, importWarning } = await exportConfig('json', dashboard.id);
      const safeName = dashboard.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
      download(blob, `hops-${safeName}-${new Date().toISOString().split('T')[0]}.json`);
      // Pictures left out are said, and stay on screen until dismissed.
      const warning = missingAssetsWarning(missing);
      if (warning) toast.warning(warning, 0);
      if (importWarning) toast.warning(importWarning, 0);
      if (!warning && !importWarning) toast.success(`Exported "${dashboard.name}"`);
    } catch (err) {
      toast.error(err instanceof Error && err.message ? `Export failed: ${err.message}` : 'Export failed');
    } finally {
      exportingId = null;
    }
  }
</script>

<div class="dashboard-list">
  <div class="list-header">
    <h2>Dashboards</h2>
    <div class="header-actions">
      <button onclick={() => showImport = true} class="btn-secondary">
        <Icon icon="mdi:tray-arrow-down" width="20" />
        Import
      </button>
      <button onclick={handleExportAll} class="btn-secondary" disabled={exportingAll || $dashboards.length === 0}>
        <Icon icon={exportingAll ? 'mdi:loading' : 'mdi:tray-arrow-up'} width="20" class={exportingAll ? 'spin' : ''} />
        Export all
      </button>
      <button onclick={handleNew} class="btn-primary">
        <Icon icon="mdi:plus" width="20" />
        New Dashboard
      </button>
    </div>
  </div>

  <p class="export-note" data-testid="export-all-note">
    <strong>Export all</strong> saves every dashboard in one file, which Import reads back. It is not a backup:
    a backup is the whole app (settings, icons and so on), in <a href="/settings/backups">Backups</a>.
  </p>

  {#if creatingNew}
    <div class="dashboard-item card new-dashboard-form">
      <div class="dashboard-edit-form">
        <div class="edit-fields">
          <div class="field">
            <label for="new-name">Name</label>
            <input
              id="new-name"
              type="text"
              bind:value={newName}
              oninput={onNewNameInput}
              placeholder="e.g., Home"
            />
          </div>
          <div class="field">
            <label for="new-path">URL Path <span class="optional">(from the name; change if needed)</span></label>
            <input
              id="new-path"
              type="text"
              bind:value={newPath}
              oninput={() => (pathEdited = true)}
              placeholder="/my-dashboard"
            />
          </div>
        </div>
        <div class="edit-actions">
          <ActionButton action="cancel" small onclick={cancelNew} />
          <ActionButton action="save" small onclick={saveNew} disabled={!newName.trim() || busy} />
        </div>
      </div>
    </div>
  {/if}

  {#if $dashboards.length > 0}
    <div class="dashboards">
      {#each $dashboards as dashboard, index (dashboard.id)}
        <div class="dashboard-item card" data-dashboard-id={dashboard.id}>
          {#if editingId === dashboard.id}
            <div class="dashboard-edit-form">
              <div class="edit-fields">
                <div class="field">
                  <label for="name-{dashboard.id}">Name</label>
                  <input
                    id="name-{dashboard.id}"
                    type="text"
                    bind:value={editName}
                    placeholder="Dashboard name"
                  />
                </div>
                <div class="field">
                  <label for="path-{dashboard.id}">URL Path</label>
                  <input
                    id="path-{dashboard.id}"
                    type="text"
                    bind:value={editPath}
                    placeholder="/my-dashboard"
                  />
                </div>
              </div>
              <div class="edit-actions">
                <ActionButton action="cancel" small onclick={cancelEdit} />
                <ActionButton action="save" small onclick={() => saveEdit(dashboard)} disabled={busy} />
              </div>
            </div>
          {:else}
            <button class="dashboard-info" onclick={() => openDashboard(dashboard)} title="Open dashboard">
              <h3>{dashboard.name}</h3>
              <p class="path">{dashboard.path}</p>
              <p class="meta">{dashboard.tabs.length} {dashboard.tabs.length === 1 ? 'tab' : 'tabs'}</p>
            </button>

            <div class="dashboard-actions">
              <ReorderButtons name={dashboard.name} first={index === 0} last={index === $dashboards.length - 1} {busy} onMove={(m) => move(index, m, dashboard.id)} />
              <button onclick={() => startEdit(dashboard)} class="btn-secondary" aria-label="Rename {dashboard.name}" title="Rename">
                <Icon icon="mdi:pencil" width="20" />
              </button>
              <a href="/settings/dashboards/tab-order/{encodeURIComponent(dashboard.id)}" class="btn-secondary" aria-label="Tab order for {dashboard.name}" title="Tab order">
                <Icon icon="mdi:sort" width="20" />
              </a>
              <button onclick={() => handleExport(dashboard)} class="btn-secondary" aria-label="Export {dashboard.name}" title="Export" disabled={exportingId === dashboard.id}>
                {#if exportingId === dashboard.id}
                  <Icon icon="mdi:loading" width="20" class="spin" />
                {:else}
                  <Icon icon="mdi:tray-arrow-up" width="20" />
                {/if}
              </button>
              <button
                onclick={() => (qrDashboard = dashboard)}
                class="btn-secondary"
                title="Show QR code (scan with phone)"
                aria-label="Show QR code for {dashboard.name}"
              >
                <Icon icon="mdi:qrcode" width="20" />
              </button>
              <a href={dashboardHref(dashboard.path)} target="_blank" class="btn-secondary" aria-label="Open {dashboard.name} in a new tab" title="Open in new tab">
                <Icon icon="mdi:open-in-new" width="20" />
              </a>
              <button onclick={() => handleDelete(dashboard)} class="btn-danger" aria-label="Delete {dashboard.name}" title="Delete">
                <Icon icon="mdi:trash-can" width="20" />
              </button>
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {:else}
    <div class="empty-state">
      <Icon icon="mdi:view-dashboard-outline" width="64" />
      <p>No dashboards yet</p>
      <button onclick={handleNew} class="btn-primary">Create Your First Dashboard</button>
    </div>
  {/if}
</div>

{#if showImport}
  <ImportModal onClose={() => showImport = false} onImportSuccess={loadConfig} />
{/if}

{#if qrDashboard}
  <QRCodeModal dashboard={qrDashboard} onClose={() => (qrDashboard = null)} />
{/if}

<style>
  .dashboard-list {
    width: 100%;
  }

  .list-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 0.75rem;
    margin-bottom: 1.5rem;
  }

  h2 {
    margin: 0;
    font-size: 1.5rem;
  }

  .export-note {
    margin: -0.75rem 0 1.5rem;
    font-size: 0.875rem;
    color: var(--text-secondary);
  }

  .export-note a {
    color: var(--accent-text);
  }

  .header-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
  }

  .dashboards {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .dashboard-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    padding: 1.5rem;
    gap: 1rem;
    min-width: 0;
  }

  .dashboard-info {
    flex: 1 1 14rem;
    min-width: 0;
    overflow-wrap: anywhere;
    text-align: left;
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 0.5rem;
    margin: -0.5rem;
    border-radius: 0.5rem;
    transition: background 0.2s;
  }

  .dashboard-info:hover {
    background: var(--bg-tertiary);
  }

  .dashboard-info h3 {
    margin: 0 0 0.25rem 0;
    font-size: 1.125rem;
    color: var(--text-primary);
  }

  .path {
    margin: 0.25rem 0;
    color: var(--accent-text);
    font-size: 0.875rem;
    font-family: monospace;
  }

  .meta {
    margin: 0.5rem 0 0 0;
    color: var(--text-secondary);
    font-size: 0.875rem;
  }

  /* Wraps onto a second line when the row is narrow, so nothing runs past the edge. */
  .dashboard-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 0.5rem;
    max-width: 100%;
  }

  .dashboard-actions :global(.btn-secondary),
  .dashboard-actions .btn-danger {
    min-width: 44px;
    min-height: 44px;
    padding: 0;
  }

  .dashboard-edit-form {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .edit-fields {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
  }

  .field {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .field label {
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--text-secondary);
  }

  .field label .optional {
    font-weight: 400;
    opacity: 0.7;
  }

  .field input {
    width: 100%;
    padding: 0.5rem;
    border: 1px solid var(--border);
    border-radius: 0.375rem;
    background: var(--bg-secondary);
    color: var(--text-primary);
  }

  .edit-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
  }

  /* Base .btn-primary, .btn-secondary, .btn-danger and .btn-sm styles are in app.css */
  /* The row's Delete is the one Delete look (red fill, bin): no local override. */

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 4rem 2rem;
    text-align: center;
    color: var(--text-secondary);
  }

  .empty-state p {
    margin: 1rem 0 1.5rem 0;
  }

  @media (max-width: 640px) {
    .dashboard-item {
      flex-direction: column;
      align-items: flex-start;
    }

    .dashboard-actions {
      width: 100%;
      justify-content: flex-start;
      flex-wrap: wrap;
    }

    .edit-fields {
      flex-direction: column;
    }
  }

  :global(.spin) {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
</style>
