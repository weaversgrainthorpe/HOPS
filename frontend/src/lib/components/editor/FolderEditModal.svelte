<script lang="ts" module>
  import type { FolderNode } from '$lib/types/layout';
  import type { Background } from '$lib/types';
  /**
   * The folder's own fields a dialog may change (never id, kind, placement or content).
   * `background` is present only when one was picked: a Background, or null = removed.
   */
  export type FolderFields = Pick<
    FolderNode,
    | 'name' | 'icon' | 'iconUrl' | 'iconBgColor' | 'color' | 'opacity' | 'textColor' | 'display' | 'showTitle' | 'shape'
    | 'size' | 'contentSize'
  > & {
    background?: Background | null;
    /** Status checks (M4 §4b): true/false = set here, null = inherit (key removed), absent = unchanged. */
    statusChecksEnabled?: boolean | null;
  };
</script>

<script lang="ts">
  import Icon from '@iconify/svelte';
  import ColoredIcon from '../ColoredIcon.svelte';
  import ColorPicker from '../admin/ColorPicker.svelte';
  import OpacitySlider from '../admin/OpacitySlider.svelte';
  import IconEditModal from '../admin/IconEditModal.svelte';
  import BackgroundConfigModal from '../admin/BackgroundConfigModal.svelte';
  import { backgroundSummary } from '../background/backgroundSummary';
  import Modal from '../shared/Modal.svelte';
  import StatusCheckSetting from './StatusCheckSetting.svelte';
  import { containerSetting, type LevelSetting, type StatusContext } from '$lib/editor/statusChecks';
  import { FOLDER_SHAPES, isFolderShape, sizeOf } from '$lib/layout/geometry';
  import type { FolderShape, ItemSize } from '$lib/types/layout';

  interface Props {
    folder: FolderNode;
    /** True for a folder that does not exist yet (Create instead of Save, no Delete/Duplicate). */
    isNew?: boolean;
    onSave: (fields: FolderFields) => void;
    onCancel: () => void;
    onDelete?: () => void;
    onDuplicate?: () => void;
    onMoveCopy?: () => void;
    /** The levels above the folder, for the status-check row's "inherited from" text. */
    statusContext?: StatusContext;
    /** Why this contents size can't be used here (no room for its smallest open box), or null. */
    checkContentSize?: (size: ItemSize) => string | null;
  }
  let {
    folder, isNew = false, onSave, onCancel, onDelete, onDuplicate, onMoveCopy, statusContext, checkContentSize
  }: Props = $props();
  let showBackgroundConfig = $state(false);
  // A picked background is staged here and saved with the dialog (one undo step);
  // Cancel discards it (Ruling 11(5)).
  let stagedBackground = $state<{ value: Background | undefined } | null>(null);
  // "Same as <name>": the folder it sits in, else the tab (an unnamed one reads as a plain phrase).
  const parentName = $derived.by(() => {
    const above = statusContext?.folders[statusContext.folders.length - 1];
    if (above) return above.name?.trim() || 'the folder it sits in';
    return statusContext?.tab?.name?.trim() || 'the tab it sits in';
  });
  const shownBackground = $derived(stagedBackground ? stagedBackground.value : folder.background);

  // Form state starts from the folder (intentionally captures the initial values).
  // svelte-ignore state_referenced_locally
  let name = $state(folder.name ?? '');
  // svelte-ignore state_referenced_locally
  let icon = $state(folder.icon ?? '');
  // svelte-ignore state_referenced_locally
  let iconUrl = $state(folder.iconUrl ?? '');
  // svelte-ignore state_referenced_locally
  let iconBgColor = $state<string | undefined>(folder.iconBgColor);
  // svelte-ignore state_referenced_locally
  let color = $state<string | undefined>(folder.color);
  // svelte-ignore state_referenced_locally
  let opacity = $state<number | undefined>(folder.opacity);
  // svelte-ignore state_referenced_locally
  let textColor = $state<'auto' | 'light' | 'dark'>(folder.textColor ?? 'auto');
  // svelte-ignore state_referenced_locally
  let display = $state<'expanded' | 'collapsed'>(folder.display === 'collapsed' ? 'collapsed' : 'expanded');
  // svelte-ignore state_referenced_locally
  let showTitle = $state(folder.showTitle !== false);
  // M5: the size of every item inside (tiles and sub-folders) and of its minimised tile on a tab.
  // Staged here; saved with the dialog as one undo step.
  // svelte-ignore state_referenced_locally
  let contentSize = $state<ItemSize>(sizeOf(folder.contentSize));
  // svelte-ignore state_referenced_locally
  let size = $state<ItemSize>(sizeOf(folder.size));
  const SIZES: [ItemSize, string][] = [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']];
  // svelte-ignore state_referenced_locally
  // An unknown stored look (e.g. the retired folder-tab) is kept, shown as unknown and refused on Save
  // with the reason (editFolder, M6 §3a.8) — never silently swapped for another look.
  let shape = $state<string>(folder.shape ?? 'rounded');
  const SHAPE_LABELS: Record<FolderShape, string> = {
    rounded: 'Rounded box', 'simple-tab': 'Simple tab', 'folder-flat': 'Folder (flat)', 'folder-paper': 'Folder with paper',
    'folder-outline': 'Folder (outlined)', 'folder-cartoon': 'Folder (cartoon)', 'folder-open': 'Folder (open flap)'
  };
  // svelte-ignore state_referenced_locally
  const initialStatus = containerSetting(folder.statusChecksEnabled);
  let statusSetting = $state<LevelSetting>(initialStatus);
  let showIconEditor = $state(false);
  let problem = $state('');
  /** A contents size refused here (shown in the dialog; Save is refused while it stands). */
  const contentSizeError = $derived(checkContentSize ? checkContentSize(contentSize) : null);
  let nameEl = $state<HTMLInputElement | null>(null);

  // A merge creates "New folder" and opens this dialog with the name selected for editing (Task 8).
  $effect(() => {
    if (nameEl) {
      nameEl.focus();
      nameEl.select();
    }
  });

  function handleBeforeClose(): boolean {
    if (showBackgroundConfig) {
      showBackgroundConfig = false;
      return false;
    }
    if (showIconEditor) {
      showIconEditor = false;
      return false;
    }
    return true;
  }

  function handleSave() {
    if (!name.trim()) {
      problem = 'A folder needs a name.';
      return;
    }
    problem = '';
    if (contentSizeError) return; // shown under Contents size
    onSave({
      name: name.trim(),
      icon: icon || undefined,
      iconUrl: iconUrl || undefined,
      iconBgColor,
      color,
      opacity,
      textColor,
      display,
      showTitle,
      shape: shape as FolderShape,
      size,
      contentSize,
      ...(stagedBackground ? { background: stagedBackground.value ?? null } : {}),
      // Only a changed choice is written (an untouched invalid value stays as stored).
      ...(statusSetting !== initialStatus && statusSetting !== 'invalid' && statusSetting !== 'unset'
        ? { statusChecksEnabled: statusSetting === 'inherit' ? null : statusSetting === 'on' }
        : {})
    });
  }
</script>

<Modal
  id="folder-edit"
  title={isNew ? 'New Folder' : 'Edit Folder'}
  onClose={onCancel}
  onBeforeClose={handleBeforeClose}
  maxWidth="520px"
>
  <form id="folder-edit-form" onsubmit={(e) => { e.preventDefault(); handleSave(); }}>
    <div class="form-group">
      <label for="folder-name">Folder name *</label>
      <input id="folder-name" type="text" bind:value={name} bind:this={nameEl} placeholder="e.g. Media, Tools" />
      {#if problem}<p class="problem" role="alert">{problem}</p>{/if}
    </div>

    <div class="form-group">
      <span class="label">Icon (optional)</span>
      <button type="button" class="icon-summary" onclick={() => (showIconEditor = true)}>
        <span class="icon-preview-tile" class:has-bg={iconBgColor} style:background-color={iconBgColor}>
          {#if iconUrl}
            <img src={iconUrl} alt="" />
          {:else if icon}
            <ColoredIcon {icon} width="28" />
          {:else}
            <ColoredIcon icon="mdi:folder-outline" width="28" />
          {/if}
        </span>
        <span class="icon-summary-text">
          {#if iconUrl}Custom icon{:else if icon}<code>{icon}</code>{:else}No icon{/if}
        </span>
        <span class="edit-cta"><Icon icon="mdi:pencil" width="16" /> Edit icon</span>
      </button>
    </div>

    <ColorPicker selectedColor={color} onSelect={(c) => (color = c)} />
    <OpacitySlider {opacity} onSelect={(o) => (opacity = o)} />

    <fieldset class="form-group">
      <legend>Text colour</legend>
      <div class="choice-row">
        {#each [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']] as [v, label] (v)}
          <label class="choice">
            <input type="radio" name="folder-text-color" value={v} bind:group={textColor} />
            {label}
          </label>
        {/each}
      </div>
    </fieldset>

    <fieldset class="form-group">
      <legend>Starts</legend>
      <div class="choice-row">
        <label class="choice">
          <input type="radio" name="folder-display" value="expanded" bind:group={display} /> Expanded
        </label>
        <label class="choice">
          <input type="radio" name="folder-display" value="collapsed" bind:group={display} /> Collapsed
        </label>
      </div>
      <small>How the folder looks to anyone who hasn't minimised or expanded it themselves.</small>
    </fieldset>

    <div class="form-row">
      <div class="form-group">
        <label for="folder-content-size">Contents size</label>
        <select id="folder-content-size" bind:value={contentSize}>
          {#each SIZES as [v, label] (v)}<option value={v}>{label}</option>{/each}
        </select>
        <small>Every tile and folder inside is shown at this size.</small>
        {#if contentSizeError}<p class="problem" role="alert">{contentSizeError}</p>{/if}
      </div>
      <div class="form-group">
        <label for="folder-size">Size when minimised</label>
        <select id="folder-size" bind:value={size}>
          {#each SIZES as [v, label] (v)}<option value={v}>{label}</option>{/each}
        </select>
        <small>Its tile on the tab, inside the space it keeps.</small>
      </div>
    </div>

    <div class="form-row">
      <div class="form-group">
        <label for="folder-shape">Look</label>
        <select id="folder-shape" bind:value={shape} aria-describedby="folder-shape-note">
          {#if !isFolderShape(shape)}
            <option value={shape} disabled>Unknown look ({shape}) — pick one</option>
          {/if}
          {#each FOLDER_SHAPES as s (s)}
            <option value={s}>{SHAPE_LABELS[s]}</option>
          {/each}
        </select>
        <small id="folder-shape-note">Saved now; the folder looks are drawn in a coming update (every folder draws as a rounded box for now).</small>
      </div>
    </div>

    <label class="check">
      <input type="checkbox" bind:checked={showTitle} /> Show title bar
    </label>

    <StatusCheckSetting level="folder" bind:value={statusSetting} context={statusContext} />

    <div class="form-group">
      <button type="button" class="btn-secondary background-btn" onclick={() => (showBackgroundConfig = true)}>
        <Icon icon="mdi:image-multiple" width="18" /> Background…
      </button>
      <small class="background-status">
        {backgroundSummary(shownBackground, 'No background of its own')}{stagedBackground ? ` — applies when you ${isNew ? 'create' : 'save'} this folder` : ''}
      </small>
    </div>

    {#if onMoveCopy && !isNew}
      <button type="button" class="btn-secondary move-btn" onclick={onMoveCopy}>
        <Icon icon="mdi:folder-move" width="18" /> Move or copy to…
      </button>
    {/if}
  </form>

  {#snippet footer()}
    <div class="modal-actions">
      <div class="actions-left">
        {#if !isNew && onDelete}
          <button type="button" class="btn-danger" onclick={onDelete}><Icon icon="mdi:trash-can" width="20" /> Delete</button>
        {/if}
        {#if !isNew && onDuplicate}
          <button type="button" class="btn-secondary" onclick={onDuplicate}><Icon icon="mdi:content-copy" width="20" /> Duplicate</button>
        {/if}
      </div>
      <div class="actions-right">
        <button type="button" class="btn-secondary" onclick={onCancel}>Cancel</button>
        <button type="submit" form="folder-edit-form" class="btn-primary">
          <Icon icon="mdi:content-save" width="20" /> {isNew ? 'Create' : 'Save'}
        </button>
      </div>
    </div>
  {/snippet}
</Modal>

{#if showBackgroundConfig}
  <BackgroundConfigModal
    background={shownBackground}
    level="folder"
    {parentName}
    onSave={(bg) => {
      stagedBackground = { value: bg };
      showBackgroundConfig = false;
    }}
    onCancel={() => (showBackgroundConfig = false)}
  />
{/if}

{#if showIconEditor}
  <IconEditModal
    {icon}
    {iconUrl}
    {iconBgColor}
    onIconChange={(v) => (icon = v ?? '')}
    onIconUrlChange={(v) => (iconUrl = v ?? '')}
    onIconBgColorChange={(v) => (iconBgColor = v)}
    onClose={() => (showIconEditor = false)}
  />
{/if}

<style>
  .form-group {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin: 0 0 1.25rem;
    border: none;
    padding: 0;
    min-width: 0;
  }
  .form-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
  }
  label,
  legend,
  .label {
    font-weight: 500;
    font-size: 0.875rem;
    color: var(--text-primary);
  }
  input[type='text'],
  select {
    padding: 0.625rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: 0.375rem;
    background: var(--bg-secondary);
    color: var(--text-primary);
    font-size: 0.95rem;
  }
  input[type='text']:focus,
  select:focus {
    outline: none;
    border-color: var(--accent);
  }
  small {
    color: var(--text-secondary);
  }
  .problem {
    margin: 0;
    color: var(--color-error, #dc2626);
    font-size: 0.875rem;
  }
  .choice-row {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
  }
  .choice,
  .check {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font-weight: 400;
  }
  .check {
    margin-bottom: 1.25rem;
  }
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
  }
  .icon-summary:hover {
    border-color: var(--accent);
  }
  .icon-preview-tile {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.25rem;
    height: 2.25rem;
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
  .edit-cta {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    color: var(--accent);
    font-size: 0.875rem;
  }
  .background-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    align-self: flex-start;
  }
  .background-status {
    font-size: 0.8rem;
  }
  .move-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
  }
  .modal-actions {
    display: flex;
    gap: 0.75rem;
    justify-content: space-between;
    align-items: center;
    width: 100%;
  }
  .actions-left,
  .actions-right {
    display: flex;
    gap: 0.75rem;
  }
  .modal-actions button {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
  }
</style>
