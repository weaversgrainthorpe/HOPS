<script lang="ts">
  import type { Entry } from '$lib/types';
  import Icon from '@iconify/svelte';
  import ColoredIcon from '../ColoredIcon.svelte';
  import ColorPicker from './ColorPicker.svelte';
  import OpacitySlider from './OpacitySlider.svelte';
  import IconEditModal from './IconEditModal.svelte';
  import Modal from '../shared/Modal.svelte';
  import { confirm } from '$lib/stores/confirmModal';
  import { editMode } from '$lib/stores/editMode';
  import StatusCheckSetting from '../editor/StatusCheckSetting.svelte';
  import { tileSetting, type LevelSetting, type StatusContext } from '$lib/editor/statusChecks';
  import { tileSizeOf, type TileSize } from '$lib/editor/editorActions';
  import { isSshUrl, parseSshUrl, buildSshUrl, validateSsh, SSH_DEFAULT_PORT } from '$lib/utils/ssh';

  interface Props {
    entry: Entry;
    /** `extra.size` is set only when a Size was picked in the dialog (it sets the tile's span). */
    onSave: (entry: Entry, extra: { size?: TileSize }) => void;
    onCancel: () => void;
    onDelete?: () => void;
    /**
     * Opens the Move/Copy dialog (any tab or folder, any dashboard). A tile
     * goes in and comes out with its kind, id and placement untouched (the
     * editor never patches those).
     */
    onMoveCopy?: () => void;
    /** The levels above the tile, for the status-check row's "inherited from" text. */
    statusContext?: StatusContext;
    /** Trial-runs a picked size; returns why it can't be done (shown inline), or null. */
    checkSize?: (size: TileSize) => string | null;
  }

  let { entry, onSave, onCancel, onDelete, onMoveCopy, statusContext, checkSize }: Props = $props();

  // Size (M5: Small, Medium or Large only): picking one stages it (checked at once, refusals shown
  // inline); Save passes it as `{ size }` so the editor sets the span on a tab. Not picking passes
  // nothing. Inside a folder the tile shows the folder's contents size; this is its own size.
  // svelte-ignore state_referenced_locally
  const initialSize: TileSize = tileSizeOf(entry);
  let sizeValue = $state<TileSize>(initialSize);
  let sizePicked = $state(false);
  let sizeError = $state<string | null>(null);

  function pickSize() {
    sizePicked = true;
    sizeError = checkSize ? checkSize(sizeValue) : null;
  }

  // Form state initialized from props (intentionally captures initial values)
  // svelte-ignore state_referenced_locally
  let editedEntry = $state<Entry>({ ...entry });
  let showIconEditor = $state(false);
  // Status checks: Inherit / On / Off (unset = Off, the tile default). Saved with the dialog.
  // svelte-ignore state_referenced_locally
  const initialStatus = tileSetting(entry);
  let statusSetting = $state<LevelSetting>(initialStatus);

  // Update editedEntry when entry prop changes. Normalise `type` to
  // 'link' when the incoming entry has no value, so the Tile type
  // dropdown's bind:value matches a real <option> (configs from
  // pre-v1.7.0 don't carry a `type` field).
  $effect(() => {
    editedEntry = { ...entry, type: entry.type ?? 'link' };
    kind = kindOf(entry);
    const f = parseSshUrl(entry.url ?? '');
    sshHost = f?.host ?? '';
    sshPort = f?.port ?? SSH_DEFAULT_PORT;
    sshUser = f?.user ?? '';
  });

  // The Tile type dropdown: Link, SSH (a link tile whose ssh:// URL is built from
  // Host/Port/User) or Note. A link tile whose URL starts with ssh:// opens as SSH.
  type Kind = 'link' | 'ssh' | 'note';
  function kindOf(e: Entry): Kind {
    if (e.type === 'note') return 'note';
    return isSshUrl(e.url) ? 'ssh' : 'link';
  }
  // svelte-ignore state_referenced_locally
  let kind = $state<Kind>(kindOf(entry));
  // svelte-ignore state_referenced_locally
  const initialSsh = parseSshUrl(entry.url ?? '');
  let sshHost = $state(initialSsh?.host ?? '');
  let sshPort = $state(initialSsh?.port ?? SSH_DEFAULT_PORT);
  let sshUser = $state(initialSsh?.user ?? '');
  // Errors show once a field is left or Save is tried (never silently refused).
  let sshShowErrors = $state(false);
  const sshErrors = $derived(validateSsh({ host: sshHost, port: sshPort, user: sshUser }));
  const isSsh = $derived(kind === 'ssh');
  // ssh:// can't be framed: the iframe and popup modes are unavailable for it.
  const sshLike = $derived(isSsh || (kind === 'link' && isSshUrl(editedEntry.url)));

  function pickKind() {
    editedEntry.type = kind === 'note' ? 'note' : 'link';
    if (kind === 'ssh') {
      const f = parseSshUrl(editedEntry.url ?? '');
      if (f) { sshHost = f.host; sshPort = f.port; sshUser = f.user; }
      if (!editedEntry.icon && !editedEntry.iconUrl) editedEntry.icon = 'mdi:console';
    } else if (kind === 'link' && sshHost.trim() && Object.keys(sshErrors).length === 0
      && (!editedEntry.url || isSshUrl(editedEntry.url))) {
      // SSH -> Link keeps what was typed, as the URL.
      editedEntry.url = buildSshUrl({ host: sshHost, port: sshPort, user: sshUser });
    }
  }

  // Close modal when edit mode is turned off
  $effect(() => {
    if (!$editMode) {
      onCancel();
    }
  });

  function handleBeforeClose(): boolean {
    if (showIconEditor) {
      showIconEditor = false;
      return false;
    }
    return true;
  }

  // Derived: are we editing a note tile? Notes have no URL / open-mode /
  // status check / icon, so the form hides those fields when this is true.
  let isNote = $derived(kind === 'note');

  function handleSave() {
    if (isSsh) {
      sshShowErrors = true;
      if (Object.keys(sshErrors).length > 0) return;
      editedEntry.type = 'link';
      editedEntry.url = buildSshUrl({ host: sshHost, port: sshPort, user: sshUser });
    }
    if (sshLike && (editedEntry.openMode === 'iframe' || editedEntry.openMode === 'popup')) {
      editedEntry.openMode = 'sametab';
    }
    if (sizePicked) {
      // Re-checked at Save (the draft may have changed); a refusal stays in the dialog, inline.
      sizeError = checkSize ? checkSize(sizeValue as TileSize) : null;
      if (sizeError) return;
      editedEntry.size = sizeValue as TileSize;
    }
    // For note tiles, clear out the link-only fields so the saved record
    // is clean (no stale URL / open mode / status check / icon left
    // behind from a previous link form).
    if (isNote) {
      editedEntry.url = '';
      editedEntry.icon = '';
      editedEntry.iconUrl = '';
      editedEntry.openMode = 'newtab';
      editedEntry.statusCheck = undefined;
      editedEntry.showStatus = false;
    } else if (statusSetting !== initialStatus && statusSetting !== 'unset' && statusSetting !== 'invalid') {
      // Only a changed choice is written; unchanged (including unset and an invalid stored
      // value) keeps the stored statusCheck exactly.
      const prev = editedEntry.statusCheck && typeof editedEntry.statusCheck === 'object' ? editedEntry.statusCheck : undefined;
      editedEntry.statusCheck = {
        ...(prev ?? { interval: 60 }),
        type: 'http',
        enabled: statusSetting === 'inherit' ? null : statusSetting === 'on'
      } as Entry['statusCheck'];
    }
    onSave(editedEntry, sizePicked ? { size: sizeValue as TileSize } : {});
  }

  async function handleDelete() {
    if (!onDelete) return;

    const tileName = editedEntry.name?.trim() || 'this tile';
    const confirmed = await confirm({
      title: `Delete "${tileName}"?`,
      message: 'This tile will be removed from the dashboard. You can undo this only by re-creating it.',
      confirmText: 'Delete',
      confirmStyle: 'danger'
    });
    if (confirmed) {
      onDelete();
    }
  }

  // Icon picking, uploading, and clearing all live in IconEditModal now.
</script>

<Modal
  id="entry-edit"
  title={entry.id ? 'Edit Tile' : 'New Tile'}
  onClose={onCancel}
  onBeforeClose={handleBeforeClose}
>
  <form id="entry-edit-form" onsubmit={(e) => { e.preventDefault(); handleSave(); }}>
    <div class="form-grid">
      <div class="form-group full-width">
        <label for="entry-type">Tile type</label>
        <select
          id="entry-type"
          bind:value={kind}
          onchange={pickKind}
        >
          <option value="link">Link — opens a URL when clicked</option>
          <option value="ssh">SSH — opens your computer's SSH app</option>
          <option value="note">Note — text only, no link</option>
        </select>
        {#if isSsh}
          <small id="ssh-hint" class="ssh-hint">
            Opens your computer's SSH app. On Windows you may need to set one up first (e.g. PuTTY or Windows Terminal).
          </small>
        {/if}
      </div>

      <div class="form-group full-width">
        <label for="name">Name *</label>
        <input
          id="name"
          type="text"
          bind:value={editedEntry.name}
          required
          placeholder={isNote ? 'Note heading' : 'Tile name'}
        />
      </div>

      <div class="form-group full-width">
        <label for="description">{isNote ? 'Body text' : 'Subtitle/Description'}</label>
        {#if isNote}
          <textarea
            id="description"
            bind:value={editedEntry.description}
            placeholder="Note text — appears under the heading"
            rows="3"
          ></textarea>
        {:else}
          <input
            id="description"
            type="text"
            bind:value={editedEntry.description}
            placeholder="Optional subtitle"
          />
        {/if}
      </div>

      {#if isSsh}
        <div class="form-group">
          <label for="ssh-host">Host *</label>
          <input id="ssh-host" type="text" bind:value={sshHost} placeholder="nas.lan, 192.168.1.10 or [fd00::1]"
            autocomplete="off" spellcheck="false" onblur={() => sshShowErrors = true}
            aria-invalid={sshShowErrors && sshErrors.host ? 'true' : undefined}
            aria-describedby={sshShowErrors && sshErrors.host ? 'ssh-host-error' : undefined} />
          {#if sshShowErrors && sshErrors.host}
            <p id="ssh-host-error" class="field-error" role="alert">{sshErrors.host}</p>
          {/if}
        </div>
        <div class="form-group">
          <label for="ssh-port">Port</label>
          <input id="ssh-port" type="text" inputmode="numeric" bind:value={sshPort} placeholder="22"
            onblur={() => sshShowErrors = true}
            aria-invalid={sshShowErrors && sshErrors.port ? 'true' : undefined}
            aria-describedby={sshShowErrors && sshErrors.port ? 'ssh-port-error' : undefined} />
          {#if sshShowErrors && sshErrors.port}
            <p id="ssh-port-error" class="field-error" role="alert">{sshErrors.port}</p>
          {/if}
        </div>
        <div class="form-group full-width">
          <label for="ssh-user">User</label>
          <input id="ssh-user" type="text" bind:value={sshUser} placeholder="Optional, e.g. pi"
            autocomplete="off" spellcheck="false" onblur={() => sshShowErrors = true}
            aria-invalid={sshShowErrors && sshErrors.user ? 'true' : undefined}
            aria-describedby={sshShowErrors && sshErrors.user ? 'ssh-user-error' : undefined} />
          {#if sshShowErrors && sshErrors.user}
            <p id="ssh-user-error" class="field-error" role="alert">{sshErrors.user}</p>
          {/if}
          {#if Object.keys(sshErrors).length === 0}
            <small>Opens <code data-testid="ssh-url-preview">{buildSshUrl({ host: sshHost, port: sshPort, user: sshUser })}</code></small>
          {/if}
        </div>
      {:else if !isNote}
        <div class="form-group full-width">
          <label for="url">URL *</label>
          <input
            id="url"
            type="url"
            bind:value={editedEntry.url}
            required
            placeholder="https://example.com"
          />
        </div>
      {/if}

      {#if !isNote}
      <!-- Icon: small preview + one button to open the icon sub-modal,
           which handles picking / uploading / Iconify name / icon background. -->
      <div class="form-group full-width">
        <label>Icon</label>
        <button type="button" class="icon-summary" onclick={() => showIconEditor = true}>
          <span class="icon-preview-tile"
                class:has-bg={editedEntry.iconBgColor}
                style:background-color={editedEntry.iconBgColor}>
            {#if editedEntry.iconUrl}
              <img src={editedEntry.iconUrl} alt="" />
            {:else if editedEntry.icon}
              <ColoredIcon icon={editedEntry.icon} width="32" />
            {:else}
              <ColoredIcon icon="mdi:application-outline" width="32" />
            {/if}
          </span>
          <span class="icon-summary-text">
            {#if editedEntry.iconUrl}
              Custom uploaded icon
            {:else if editedEntry.icon}
              <code>{editedEntry.icon}</code>
            {:else}
              No icon
            {/if}
          </span>
          <span class="edit-cta">
            <Icon icon="mdi:pencil" width="16" />
            Edit icon
          </span>
        </button>
      </div>
      {/if}

      <!-- Tile background colour + opacity — inline, no sub-modal. They
           belong to the tile itself, not to the icon. -->
      <div class="form-group full-width">
        <ColorPicker
          selectedColor={editedEntry.color}
          onSelect={(color) => editedEntry.color = color}
        />
      </div>

      <!-- Walkthrough §2: the tile's opacity fades its background only; the text and
           the icon have their own (the status badge is never faded). -->
      <div class="form-group full-width">
        <OpacitySlider
          id="entry-bg-opacity"
          label="Background opacity"
          opacity={editedEntry.opacity}
          onSelect={(opacity) => editedEntry.opacity = opacity}
        />
        <OpacitySlider
          id="entry-text-opacity"
          label="Text opacity"
          defaultValue={1}
          opacity={editedEntry.textOpacity}
          onSelect={(o) => editedEntry.textOpacity = o}
        />
        {#if !isNote}
          <OpacitySlider
            id="entry-icon-opacity"
            label="Icon opacity"
            defaultValue={1}
            opacity={editedEntry.iconOpacity}
            onSelect={(o) => editedEntry.iconOpacity = o}
          />
        {/if}
      </div>

      <div class="form-group">
        <label for="size">Size</label>
        <select
          id="size"
          bind:value={sizeValue}
          onchange={pickSize}
          aria-invalid={sizeError ? 'true' : undefined}
          aria-describedby={sizeError ? 'size-error' : undefined}
        >
          <option value="small">Small</option>
          <option value="medium">Medium</option>
          <option value="large">Large</option>
        </select>
        {#if sizeError}
          <p id="size-error" class="field-error" role="alert">{sizeError}</p>
        {/if}
      </div>

      {#if !isNote}
        <div class="form-group">
          <label for="openMode">Open Mode</label>
          {#if sshLike}
            <select id="openMode" disabled aria-describedby="openMode-ssh">
              <option>In place</option>
            </select>
            <small id="openMode-ssh">SSH opens your computer's SSH app, so the iFrame and Popup modes aren't available.</small>
          {:else}
            <select id="openMode" bind:value={editedEntry.openMode}>
              <option value="newtab">New Tab</option>
              <option value="sametab">Same Tab</option>
              <option value="iframe">iFrame Modal</option>
              <option value="popup">Popup Modal</option>
            </select>
          {/if}
        </div>

        <div class="form-group full-width">
          <StatusCheckSetting level="tile" bind:value={statusSetting} context={statusContext} />
        </div>
      {/if}

      {#if onMoveCopy && entry.id}
        <div class="form-group full-width move-section">
          <button type="button" class="btn-move-toggle" onclick={onMoveCopy}>
            <Icon icon="mdi:folder-move" width="18" />
            Move or copy to…
          </button>
        </div>
      {/if}
    </div>

  </form>

  {#snippet footer()}
    <div class="modal-actions">
      {#if onDelete}
        <button type="button" class="btn-danger" onclick={handleDelete}>
          <Icon icon="mdi:trash-can" width="20" />
          Delete
        </button>
      {/if}
      <div class="action-right">
        <button type="button" class="btn-secondary" onclick={onCancel}>
          Cancel
        </button>
        <button type="submit" form="entry-edit-form" class="btn-primary">
          <Icon icon="mdi:content-save" width="20" />
          {entry.id ? 'Save' : 'Create'}
        </button>
      </div>
    </div>
  {/snippet}
</Modal>

<style>
  form {
    padding: 1.5rem;
  }

  .form-grid {
    display: grid;
    gap: 1rem;
    grid-template-columns: 1fr 1fr;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  /* Authoritative full-width marker: any form-group with this class spans
     the whole row. Replaces the old positional nth-child trick which
     silently broke whenever a field was added or removed. */
  .form-group.full-width {
    grid-column: 1 / -1;
  }

  label {
    font-weight: 500;
    font-size: 0.875rem;
    color: var(--text-primary);
  }

  input[type="text"],
  input[type="url"],
  select {
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: 0.375rem;
    background: var(--bg-secondary);
    color: var(--text-primary);
    font-size: 0.875rem;
  }

  input[type="text"]:focus,
  input[type="url"]:focus,
  select:focus {
    outline: none;
    border-color: var(--accent);
  }

  /* Compact "Edit icon" summary row — clickable button that opens the
     icon sub-modal. Shows a preview + the current icon name / "Custom
     uploaded" / "No icon". */
  .icon-summary {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    width: 100%;
    padding: 0.6rem 0.85rem;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    background: var(--bg-secondary);
    color: var(--text-primary);
    cursor: pointer;
    text-align: left;
    transition: border-color 0.15s, background 0.15s;
  }

  .icon-summary:hover {
    border-color: var(--accent);
    background: var(--bg-tertiary);
  }

  .icon-preview-tile {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.5rem;
    height: 2.5rem;
    border-radius: 0.4rem;
    color: var(--accent);
    flex-shrink: 0;
  }

  .icon-preview-tile.has-bg {
    padding: 0.25rem;
  }

  .icon-preview-tile img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  .icon-summary-text {
    flex: 1;
    color: var(--text-secondary);
    font-size: 0.875rem;
  }

  .icon-summary-text code {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.85em;
    color: var(--text-primary);
  }

  .edit-cta {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    color: var(--accent-text);
    font-size: 0.875rem;
    font-weight: 500;
  }

  .ssh-hint {
    line-height: 1.4;
  }

  .field-error {
    margin: 0;
    font-size: 0.8rem;
    color: var(--color-error-text);
  }

  small {
    font-size: 0.75rem;
    color: var(--text-secondary);
  }

  small a {
    color: var(--accent);
    text-decoration: none;
  }

  small a:hover {
    text-decoration: underline;
  }

  .modal-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    width: 100%;
  }

  .action-right {
    display: flex;
    gap: 0.75rem;
    margin-left: auto;
  }

  button {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.625rem 1.25rem;
    border: none;
    border-radius: 0.375rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
  }

  /* .btn-primary, .btn-secondary, .btn-danger styles are defined globally in app.css */

  @media (max-width: 640px) {
    .form-grid {
      grid-template-columns: 1fr;
    }

    .modal-actions {
      flex-direction: column;
    }

    .action-right {
      width: 100%;
      margin-left: 0;
    }

    .btn-danger {
      width: 100%;
    }
  }

  /* Icon-controls CSS (input wrapper, browse/upload buttons, custom-icon
     display, clear button, error text) lives in IconEditModal now —
     they were used only by the icon section we just lifted out. */

  :global(.spin) {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  /* Move section styles */
  .move-section {
    margin-top: 0.5rem;
    padding-top: 1rem;
    border-top: 1px solid var(--border);
  }

  .btn-move-toggle {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    padding: 0.75rem 1rem;
    background: var(--bg-tertiary);
    border: 1px dashed var(--border);
    border-radius: 0.375rem;
    /* On --bg-tertiary: the secondary text is 3.9:1 on the forest dark preset; the primary passes. */
    color: var(--text-primary);
    font-size: 0.875rem;
    cursor: pointer;
    transition: all 0.2s;
  }

  .btn-move-toggle:hover {
    background: var(--bg-secondary);
    border-color: var(--accent-solid);
    color: var(--accent);
  }

  /* Placeholders readable (>= 4.5:1 on every preset, M6 §7.3); the browser default grey is 3.2–4.2:1. */
  input::placeholder,
  textarea::placeholder {
    color: var(--text-secondary);
    opacity: 1;
  }
</style>

{#if showIconEditor}
  <IconEditModal
    icon={editedEntry.icon}
    iconUrl={editedEntry.iconUrl}
    iconBgColor={editedEntry.iconBgColor}
    onIconChange={(v) => editedEntry.icon = v ?? ''}
    onIconUrlChange={(v) => editedEntry.iconUrl = v}
    onIconBgColorChange={(v) => editedEntry.iconBgColor = v}
    onClose={() => showIconEditor = false}
  />
{/if}
