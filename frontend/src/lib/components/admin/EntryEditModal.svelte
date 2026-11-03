<script lang="ts">
  import type { Entry } from '$lib/types';
  import { untrack } from 'svelte';
  import Icon from '@iconify/svelte';
  import ColoredIcon from '../ColoredIcon.svelte';
  import ColorPicker from './ColorPicker.svelte';
  import OpacitySlider from './OpacitySlider.svelte';
  import IconEditModal from './IconEditModal.svelte';
  import Modal from '../shared/Modal.svelte';
  import ActionButton from '../shared/ActionButton.svelte';
  import { editMode } from '$lib/stores/editMode';
  import StatusCheckSetting from '../editor/StatusCheckSetting.svelte';
  import { tileSetting, type TileSetting, type StatusContext } from '$lib/editor/statusChecks';
  import { tileSizeOf, type TileSize } from '$lib/editor/editorActions';
  import { isSshUrl, parseSshUrl, buildSshUrl, validateSsh, SSH_DEFAULT_PORT } from '$lib/utils/ssh';
  import { awayUrlProblem, linkUrlProblem } from '$lib/utils/tileUrl';
  import TextColourSetting from '../editor/TextColourSetting.svelte';
  import { textColourOn, type TextColorMode } from '$lib/utils/colorContrast';

  interface Props {
    entry: Entry;
    /** `extra.size` is set only when a Size was picked in the dialog (it sets the tile's span). */
    onSave: (entry: Entry, extra: { size?: TileSize }) => void;
    onCancel: () => void;
    onDelete?: () => void;
    /** Duplicates the tile (an existing one only), as on the folder dialog. */
    onDuplicate?: () => void;
    /**
     * Opens the Move/Copy dialog (any tab or folder, any dashboard). A tile
     * goes in and comes out with its kind, id and placement untouched (the
     * editor never patches those).
     */
    onMoveCopy?: () => void;
    /** The levels above the tile, so the status-check row can say when a gate above stops it. */
    statusContext?: StatusContext;
    /** Trial-runs a picked size; returns why it can't be done (shown inline), or null. */
    checkSize?: (size: TileSize) => string | null;
  }

  let { entry, onSave, onCancel, onDelete, onDuplicate, onMoveCopy, statusContext, checkSize }: Props = $props();

  // Size (Small, Medium or Large only): picking one stages it (checked at once, refusals shown
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
  // Text colour: Auto (missing), Light or Dark, the same control and warning as the folder dialog.
  const modeOf = (e: Entry): TextColorMode => (e.textColor === 'light' || e.textColor === 'dark' ? e.textColor : 'auto');
  // svelte-ignore state_referenced_locally
  let textColor = $state<TextColorMode>(modeOf(entry));
  const textOn = $derived(textColourOn(editedEntry.color, textColor));
  // Status check: On / Off (a tile with no setting is Off). Saved with the dialog.
  // svelte-ignore state_referenced_locally
  const initialStatus = tileSetting(entry);
  let statusSetting = $state<TileSetting>(initialStatus);

  // Update editedEntry when entry prop changes. Normalise `type` to
  // 'link' when the incoming entry has no value, so the Tile type
  // dropdown's bind:value matches a real <option> (configs from
  // pre-v1.7.0 don't carry a `type` field).
  $effect(() => {
    editedEntry = { ...entry, type: entry.type ?? 'link' };
    textColor = modeOf(entry);
    kind = kindOf(entry);
    const f = parseSshUrl(entry.url ?? '');
    sshHost = f?.host ?? '';
    sshPort = f?.port ?? SSH_DEFAULT_PORT;
    sshUser = f?.user ?? '';
    const af = parseSshUrl(entry.awayUrl ?? '');
    sshAwayHost = af?.host ?? '';
    sshAwayPort = af?.port ?? SSH_DEFAULT_PORT;
    awayUrlText = entry.awayUrl ?? '';
    // The form as opened: Duplicate copies the SAVED tile, so it waits while this differs.
    baseline = untrack(formSnapshot);
  });

  /** Everything the dialog can change, as one string (compared with the form as opened). */
  function formSnapshot(): string {
    return JSON.stringify([editedEntry, textColor, statusSetting, sizeValue, kind, sshHost, sshPort, sshUser, sshAwayHost, sshAwayPort, awayUrlText]);
  }
  let baseline = $state<string | null>(null);
  /** Unsaved changes in the dialog (Duplicate would copy the saved tile without them). */
  const dirty = $derived(baseline !== null && formSnapshot() !== baseline);

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
  // Home/Away: an SSH tile's away address is its own host and port (same user), built into an
  // ssh:// awayUrl exactly like the home one. Blank away host: no away address.
  // svelte-ignore state_referenced_locally
  const initialAwaySsh = parseSshUrl(entry.awayUrl ?? '');
  let sshAwayHost = $state(initialAwaySsh?.host ?? '');
  let sshAwayPort = $state(initialAwaySsh?.port ?? SSH_DEFAULT_PORT);
  const sshAwayErrors = $derived(
    sshAwayHost.trim() ? validateSsh({ host: sshAwayHost, port: sshAwayPort, user: sshUser }) : {}
  );
  // A link tile's away address: optional, checked like any tile address.
  // A saved address HOPS doesn't open (rdp:, vnc: … kept from v2) says so as soon as the dialog
  // opens: the tile can't be saved with it, and Cancel leaves it as it is.
  // svelte-ignore state_referenced_locally
  let awayShowError = $state(!!entry.awayUrl && awayUrlProblem(entry.awayUrl, entry.awayUrl) !== null);
  // svelte-ignore state_referenced_locally
  let awayUrlText = $state(entry.awayUrl ?? '');
  const awayError = $derived(awayUrlProblem(awayUrlText, entry.awayUrl));
  // A link tile's URL: checked here as a save would, so a typo is caught in the dialog.
  // svelte-ignore state_referenced_locally
  let urlShowError = $state(entry.type !== 'note' && !!entry.url && linkUrlProblem(entry.url, entry.url) !== null);
  const urlError = $derived(linkUrlProblem(editedEntry.url, entry.url));
  const isSsh = $derived(kind === 'ssh');
  // ssh:// can't be framed: the iframe and popup modes are unavailable for it.
  const sshLike = $derived(isSsh || (kind === 'link' && isSshUrl(editedEntry.url)));

  function pickKind() {
    editedEntry.type = kind === 'note' ? 'note' : 'link';
    if (kind === 'ssh') {
      const f = parseSshUrl(editedEntry.url ?? '');
      if (f) { sshHost = f.host; sshPort = f.port; sshUser = f.user; }
      if (!editedEntry.icon && !editedEntry.iconUrl) editedEntry.icon = 'mdi:console';
      const af = parseSshUrl(awayUrlText);
      if (af) { sshAwayHost = af.host; sshAwayPort = af.port; }
    } else if (kind === 'link' && sshHost.trim() && Object.keys(sshErrors).length === 0
      && (!editedEntry.url || isSshUrl(editedEntry.url))) {
      // SSH -> Link keeps what was typed, as the URL.
      editedEntry.url = buildSshUrl({ host: sshHost, port: sshPort, user: sshUser });
      if (sshAwayHost.trim() && Object.keys(sshAwayErrors).length === 0 && (!awayUrlText.trim() || isSshUrl(awayUrlText))) {
        awayUrlText = buildSshUrl({ host: sshAwayHost, port: sshAwayPort, user: sshUser });
      }
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
      if (Object.keys(sshErrors).length > 0 || Object.keys(sshAwayErrors).length > 0) return;
      editedEntry.type = 'link';
      editedEntry.url = buildSshUrl({ host: sshHost, port: sshPort, user: sshUser });
      if (sshAwayHost.trim()) editedEntry.awayUrl = buildSshUrl({ host: sshAwayHost, port: sshAwayPort, user: sshUser });
      else editedEntry.awayUrl = undefined; // undefined = removed on save
    } else if (!isNote) {
      urlShowError = true;
      awayShowError = true;
      if (urlError || awayError) return;
      // Optional: a blank away address is absent, never an empty string.
      if (awayUrlText.trim()) editedEntry.awayUrl = awayUrlText.trim();
      else editedEntry.awayUrl = undefined; // undefined = removed on save
    }
    // Auto is the default: stored as no key (missing = Auto).
    editedEntry.textColor = textColor === 'auto' ? undefined : textColor;
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
      editedEntry.awayUrl = undefined;
      editedEntry.icon = '';
      editedEntry.iconUrl = '';
      editedEntry.openMode = 'newtab';
      editedEntry.statusCheck = undefined;
      editedEntry.showStatus = false;
    } else if (statusSetting !== initialStatus && statusSetting !== 'invalid') {
      // Only a changed choice is written; unchanged (including an absent setting and an invalid stored
      // value) keeps the stored statusCheck exactly.
      const prev = editedEntry.statusCheck && typeof editedEntry.statusCheck === 'object' ? editedEntry.statusCheck : undefined;
      editedEntry.statusCheck = {
        ...(prev ?? { interval: 60 }),
        type: 'http',
        enabled: statusSetting === 'on'
      } as Entry['statusCheck'];
    }
    onSave(editedEntry, sizePicked ? { size: sizeValue as TileSize } : {});
  }

  // The editor's delete asks (once, with the same words as right-click › Delete); this dialog
  // never asks a second time.
  function handleDelete() {
    onDelete?.();
  }

  // Icon picking, uploading, and clearing all live in IconEditModal now.
</script>

<Modal
  id="entry-edit"
  title={entry.id ? 'Edit tile' : 'New tile'}
  onClose={onCancel}
  onBeforeClose={handleBeforeClose}
>
  <!-- The folder dialog's parts in its order (item 19): the item itself, then Colour, Display, Status
       check and Move or copy, each a section with its own heading. -->
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
          placeholder={isNote ? 'Note heading' : 'e.g. Router'}
        />
      </div>

      <div class="form-group full-width">
        <label for="description">{isNote ? 'Body text' : 'Description'}</label>
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
            placeholder="Optional"
          />
        {/if}
      </div>

      {#if isSsh}
        <div class="form-group">
          <label for="ssh-host">Host *</label>
          <input id="ssh-host" type="text" bind:value={sshHost} placeholder="e.g. nas.lan, 192.168.1.10 or [fd00::1]"
            autocomplete="off" spellcheck="false" onblur={() => sshShowErrors = true}
            aria-invalid={sshShowErrors && sshErrors.host ? 'true' : undefined}
            aria-describedby={sshShowErrors && sshErrors.host ? 'ssh-host-error' : undefined} />
          {#if sshShowErrors && sshErrors.host}
            <p id="ssh-host-error" class="field-error" role="alert">{sshErrors.host}</p>
          {/if}
        </div>
        <div class="form-group">
          <label for="ssh-port">Port</label>
          <input id="ssh-port" type="text" inputmode="numeric" bind:value={sshPort} placeholder="22 if left blank"
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
        <div class="form-group">
          <label for="ssh-away-host">Away host (optional)</label>
          <input id="ssh-away-host" type="text" bind:value={sshAwayHost} placeholder="e.g. nas.your-tailnet.ts.net"
            autocomplete="off" spellcheck="false" onblur={() => sshShowErrors = true}
            aria-invalid={sshShowErrors && sshAwayErrors.host ? 'true' : undefined}
            aria-describedby={sshShowErrors && sshAwayErrors.host ? 'ssh-away-host-error' : 'away-hint'} />
          {#if sshShowErrors && sshAwayErrors.host}
            <p id="ssh-away-host-error" class="field-error" role="alert">{sshAwayErrors.host}</p>
          {/if}
        </div>
        <div class="form-group">
          <label for="ssh-away-port">Away port</label>
          <input id="ssh-away-port" type="text" inputmode="numeric" bind:value={sshAwayPort} placeholder="22 if left blank"
            onblur={() => sshShowErrors = true}
            aria-invalid={sshShowErrors && sshAwayErrors.port ? 'true' : undefined}
            aria-describedby={sshShowErrors && sshAwayErrors.port ? 'ssh-away-port-error' : undefined} />
          {#if sshShowErrors && sshAwayErrors.port}
            <p id="ssh-away-port-error" class="field-error" role="alert">{sshAwayErrors.port}</p>
          {/if}
        </div>
        <div class="form-group full-width away-hint-row">
          <small id="away-hint">Used when this browser is set to Away, e.g. your Tailscale or public address. Same user as above.</small>
        </div>
      {:else if !isNote}
        <div class="form-group full-width">
          <label for="url">Address *</label>
          <input
            id="url"
            type="url"
            bind:value={editedEntry.url}
            required
            placeholder="e.g. http://192.168.1.1"
            onblur={() => urlShowError = true}
            aria-invalid={urlShowError && urlError ? 'true' : undefined}
            aria-describedby={urlShowError && urlError ? 'url-error url-hint' : 'url-hint'}
          />
          {#if urlShowError && urlError}
            <p id="url-error" class="field-error" role="alert">{urlError}</p>
          {/if}
          <small id="url-hint">Opened at home, and away too unless the tile has an away address.</small>
        </div>
        <div class="form-group full-width">
          <label for="away-url">Away address (optional)</label>
          <input
            id="away-url"
            type="url"
            bind:value={awayUrlText}
            placeholder="e.g. https://nas.your-tailnet.ts.net"
            onblur={() => awayShowError = true}
            aria-invalid={awayShowError && awayError ? 'true' : undefined}
            aria-describedby={awayShowError && awayError ? 'away-url-error away-hint' : 'away-hint'}
          />
          {#if awayShowError && awayError}
            <p id="away-url-error" class="field-error" role="alert">{awayError}</p>
          {/if}
          <small id="away-hint">Used when this browser is set to Away, e.g. your Tailscale or public address.</small>
        </div>
      {/if}

      {#if !isNote}
      <!-- Icon: small preview + one button to open the icon sub-modal,
           which handles picking / uploading / Iconify name / icon background. -->
      <div class="form-group full-width">
        <span class="label">Icon</span>
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

    </div>

    <section class="dialog-section" aria-labelledby="entry-colour-heading">
      <h3 id="entry-colour-heading" class="part-title">Colour</h3>
      <div class="stack">
        <ColorPicker
          label="Colour"
          hideLabel
          selectedColor={editedEntry.color}
          onSelect={(color) => editedEntry.color = color}
        />
        <!-- The tile's opacity fades its background only; the text and the icon have their own (the
             status badge is never faded). -->
        <OpacitySlider
          id="entry-bg-opacity"
          label="Background opacity"
          opacity={editedEntry.opacity}
          onSelect={(opacity) => editedEntry.opacity = opacity}
        />
        <TextColourSetting name="entry-text-color" bind:value={textColor} contrast={textOn.contrastWarning ? textOn.contrast : null}
          noColourNote={textOn.themed ? 'Text colour applies when the tile has a colour.' : null} />
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
    </section>

    <section class="dialog-section" aria-labelledby="entry-display-heading">
      <h3 id="entry-display-heading" class="part-title">Display</h3>
      <div class="form-grid">
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
            <label for="openMode">Open mode</label>
            {#if sshLike}
              <select id="openMode" disabled aria-describedby="openMode-ssh">
                <option>In place</option>
              </select>
              <small id="openMode-ssh">SSH opens your computer's SSH app, so the iFrame and Popup modes aren't available.</small>
            {:else}
              <select id="openMode" bind:value={editedEntry.openMode}>
                <option value="newtab">New tab</option>
                <option value="sametab">Same tab</option>
                <option value="iframe">iFrame modal</option>
                <option value="popup">Popup modal</option>
              </select>
            {/if}
          </div>
        {/if}
      </div>
    </section>

    {#if !isNote}
      <section class="dialog-section status-section">
        <StatusCheckSetting level="tile" bind:value={statusSetting} context={statusContext} />
      </section>
    {/if}

    {#if onMoveCopy && entry.id}
      <section class="dialog-section" aria-labelledby="entry-move-heading">
        <h3 id="entry-move-heading" class="part-title">Move or copy</h3>
        <button type="button" class="btn-secondary move-btn" onclick={onMoveCopy}>
          <Icon icon="mdi:folder-move" width="18" /> Move or copy to…
        </button>
      </section>
    {/if}
  </form>

  {#snippet footer()}
    <div class="modal-actions">
      <div class="actions-left">
        {#if onDelete}
          <ActionButton action="delete" onclick={handleDelete} />
        {/if}
        {#if entry.id && onDuplicate}
          <ActionButton action="duplicate" onclick={onDuplicate} disabled={dirty}
            aria-describedby={dirty ? 'entry-dup-hint' : undefined} />
        {/if}
      </div>
      {#if entry.id && onDuplicate && dirty}
        <p class="dup-hint" id="entry-dup-hint" role="status">Save your changes before duplicating.</p>
      {/if}
      <div class="action-right">
        <ActionButton action="cancel" onclick={onCancel} />
        <ActionButton action={entry.id ? 'save' : 'create'} type="submit" form="entry-edit-form" />
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

  label,
  .label {
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
    color: var(--accent-text);
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
    color: var(--accent-text);
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

  .actions-left,
  .action-right {
    display: flex;
    gap: 0.75rem;
  }

  /* Duplicate copies the saved tile, so with unsaved changes it waits and says why (a line of its own,
     under the buttons). */
  .modal-actions {
    flex-wrap: wrap;
  }
  .dup-hint {
    order: 1;
    flex-basis: 100%;
    margin: 0;
    font-size: 0.875rem;
    color: var(--text-secondary);
  }

  .action-right {
    margin-left: auto;
  }

  /* Each part of the dialog is its own section, with a heading and room around it (as on the folder
     dialog). */
  .dialog-section {
    margin: 1.5rem 0 0;
    padding-top: 1.25rem;
    border-top: 1px solid var(--border);
  }

  .part-title,
  .status-section :global(.status-checks legend) {
    margin: 0 0 0.85rem;
    font-size: 1rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .stack {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .move-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
  }

  /* .btn-primary, .btn-secondary, .btn-danger styles are defined globally in app.css */

  @media (max-width: 640px) {
    .form-grid {
      grid-template-columns: 1fr;
    }

    .modal-actions {
      flex-direction: column;
    }

    .actions-left,
    .action-right {
      width: 100%;
      margin-left: 0;
    }

    .actions-left :global(.btn-danger) {
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

  /* Placeholders readable (>= 4.5:1 on every preset); the browser default grey is 3.2–4.2:1. */
  input::placeholder,
  textarea::placeholder {
    color: var(--text-secondary);
    opacity: 1;
    font-style: italic;
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
