<script lang="ts">
  import Icon, { listIcons } from '@iconify/svelte';
  import Modal from '../shared/Modal.svelte';
  import ColoredIcon from '../ColoredIcon.svelte';
  import ColorPicker from './ColorPicker.svelte';
  import IconPickerModal from './IconPickerModal.svelte';
  import { createIcon, getIcons, uploadIconImage } from '$lib/utils/api';
  import {
    rankIconSuggestions,
    bundledSuggestions,
    dashboardSuggestions,
    type IconSuggestion,
  } from '$lib/utils/iconSuggest';
  import { toast } from '$lib/stores/toast';
  import { logWarn } from '$lib/utils/errors';

  // All icon-related editing lives here, opened from a small "Edit icon"
  // button in the parent (tile / group / tab) modal. Mirrors the original
  // inline icon section but in a focused sub-modal — keeps the parent
  // form concerned only with its own properties.
  //
  // Changes propagate live to the parent via the per-field callbacks.
  // The parent's outer Save/Cancel still controls when the whole tile
  // / group / tab is persisted, so closing this modal with "Done" is a
  // pure UI concern.

  interface Props {
    title?: string;
    icon?: string;
    iconUrl?: string;
    iconBgColor?: string;
    onIconChange: (icon: string | undefined) => void;
    onIconUrlChange: (iconUrl: string | undefined) => void;
    onIconBgColorChange: (c: string | undefined) => void;
    onClose: () => void;
  }

  let {
    title = 'Edit icon',
    icon,
    iconUrl,
    iconBgColor,
    onIconChange,
    onIconUrlChange,
    onIconBgColorChange,
    onClose,
  }: Props = $props();

  // Local copy of the iconify name so typing feels snappy. We push every
  // keystroke up to the parent so the preview elsewhere stays in sync.
  // svelte-ignore state_referenced_locally
  let iconSearch = $state(icon || '');
  let showIconPicker = $state(false);
  let isUploadingIcon = $state(false);
  let uploadError = $state('');
  let iconFileInput: HTMLInputElement;

  // Sync iconSearch when the parent swaps the icon out from under us
  // (e.g. picking from the library closes that modal and updates icon).
  $effect(() => {
    iconSearch = icon || '';
  });

  // ── Type-ahead (M6 §7.7) ────────────────────────────────────────────
  // Suggestions come only from icons HOPS has offline: the bundled Iconify set (registered by
  // $lib/icons/offline-bundle at start-up) and the imported dashboard-icons (served by HOPS
  // from /api/icons). Neither needs the internet. A failure to load the dashboard-icons list,
  // or an empty list, is shown in the suggestions — never silently treated as "no icons".
  const bundled = bundledSuggestions(listIcons(''));
  let dashboard = $state<IconSuggestion[]>([]);
  let dashboardState = $state<'idle' | 'loading' | 'ok' | 'empty' | 'failed'>('idle');
  let dashboardError = $state('');
  let suggestOpen = $state(false);
  let activeIndex = $state(0);

  async function loadDashboardIcons() {
    if (dashboardState !== 'idle') return;
    dashboardState = 'loading';
    try {
      const rows = await getIcons();
      dashboard = dashboardSuggestions(rows);
      dashboardState = dashboard.length > 0 ? 'ok' : 'empty';
    } catch (err) {
      dashboardError = err instanceof Error ? err.message : String(err);
      dashboardState = 'failed';
      logWarn(`Icon suggestions: could not load the dashboard-icons list: ${dashboardError}`);
    }
  }

  const suggestions = $derived(rankIconSuggestions([...bundled, ...dashboard], iconSearch));
  const listShown = $derived(suggestOpen && iconSearch.trim() !== '');
  const hasActive = $derived(listShown && suggestions.length > 0);

  const suggestStatus = $derived.by(() => {
    const parts: string[] = [];
    if (listShown && suggestions.length === 0) parts.push('No matching icons.');
    if (bundled.length === 0) parts.push('The offline icon set is not loaded, so only dashboard-icons are suggested.');
    if (dashboardState === 'failed') parts.push(`Couldn't load the icon list (dashboard-icons): ${dashboardError}`);
    else if (dashboardState === 'empty') parts.push('The imported dashboard-icons list is empty.');
    else if (dashboardState === 'loading' && listShown) parts.push('Loading dashboard-icons…');
    return parts.join(' ');
  });

  const statusVisible = $derived(listShown || dashboardState === 'failed' || dashboardState === 'empty');

  function openSuggestions() {
    suggestOpen = true;
    activeIndex = 0;
    loadDashboardIcons();
  }

  function acceptSuggestion(s: IconSuggestion) {
    if (s.imageUrl) {
      onIconUrlChange(s.imageUrl);
      onIconChange('');
      iconSearch = '';
    } else if (s.icon) {
      iconSearch = s.icon;
      onIconChange(s.icon);
      onIconUrlChange(undefined);
    }
    suggestOpen = false;
  }

  function handleIconKeydown(e: KeyboardEvent) {
    if (e.isComposing) return;
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        e.preventDefault();
        if (!listShown) {
          if (iconSearch.trim() !== '') openSuggestions();
          return;
        }
        const n = suggestions.length;
        if (n === 0) return;
        activeIndex = (activeIndex + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
        return;
      }
      case 'Enter':
      case 'Tab':
        if (hasActive && !e.shiftKey) {
          e.preventDefault();
          acceptSuggestion(suggestions[Math.min(activeIndex, suggestions.length - 1)]);
        }
        return;
      case 'Escape':
        if (listShown) {
          // Close only the list; the dialog's own Escape handling skips a prevented event.
          e.preventDefault();
          suggestOpen = false;
        }
        return;
    }
  }

  function handleIconSelect(selection: { icon: string; imageUrl?: string }) {
    onIconChange(selection.icon);
    onIconUrlChange(selection.imageUrl);
    iconSearch = selection.icon || '';
    showIconPicker = false;
  }

  function clearCustomIcon() {
    onIconUrlChange(undefined);
  }

  async function handleIconUpload(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    const validTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'];
    if (!validTypes.includes(file.type)) {
      uploadError = 'Invalid file type. Use PNG, JPG, GIF, WebP, or SVG.';
      return;
    }
    // The size limit is the admin's upload.max_bytes_icon setting; uploadIconImage refuses an
    // oversize file before sending it, naming the limit and the file's size (M5 §10).

    isUploadingIcon = true;
    uploadError = '';

    try {
      const result = await uploadIconImage(file);
      onIconUrlChange(result.url);
      onIconChange('');
      iconSearch = '';

      const fileName = file.name.replace(/\.[^/.]+$/, '');
      const iconName = fileName.charAt(0).toUpperCase() + fileName.slice(1).replace(/[-_]/g, ' ');

      try {
        await createIcon({
          id: result.id,
          name: iconName,
          icon: '',
          categoryId: 'containers',
          imageUrl: result.url,
        });
        toast.success('Icon saved to "My Uploads"');
      } catch {
        logWarn('Could not save icon to database');
      }
    } catch (err) {
      uploadError = err instanceof Error ? err.message : 'Upload failed';
    } finally {
      isUploadingIcon = false;
      input.value = '';
    }
  }
</script>

<Modal id="icon-edit" {title} titleIcon="mdi:image-edit-outline" {onClose} maxWidth="560px">
  <div class="body">
    {#if iconUrl}
      <!-- Custom uploaded icon — preview reflects the chosen icon
           background so the user sees what the rendered tile/folder/tab
           will look like. -->
      <div class="custom-icon-display">
        <span class="custom-icon-backing"
              class:has-bg={iconBgColor}
              style:background-color={iconBgColor}>
          <img src={iconUrl} alt="Custom icon" class="custom-icon-preview" />
        </span>
        <span class="custom-icon-label">Custom icon uploaded</span>
        <button type="button" class="clear-icon-btn" onclick={clearCustomIcon} title="Remove custom icon">
          <Icon icon="mdi:close" width="18" />
        </button>
      </div>
      <small>Or use an Iconify icon instead:</small>
    {/if}

    <div class="icon-input-wrapper">
      <div class="icon-input">
        <label for="icon-edit-input" class="sr-only">Iconify icon name</label>
        <input
          id="icon-edit-input"
          type="text"
          role="combobox"
          autocomplete="off"
          spellcheck="false"
          aria-autocomplete="list"
          aria-controls="icon-suggest-list"
          aria-expanded={listShown}
          aria-activedescendant={hasActive ? `icon-suggest-${activeIndex}` : undefined}
          aria-describedby="icon-suggest-status"
          bind:value={iconSearch}
          oninput={() => { onIconChange(iconSearch); onIconUrlChange(undefined); openSuggestions(); }}
          onkeydown={handleIconKeydown}
          onblur={() => { suggestOpen = false; }}
          placeholder="mdi:server"
          aria-label="Iconify icon name (e.g. mdi:server)"
          disabled={isUploadingIcon}
        />
        {#if icon && !iconUrl}
          <div class="icon-preview"
               class:has-bg={iconBgColor}
               style:background-color={iconBgColor}>
            <ColoredIcon {icon} width="32" />
          </div>
        {/if}
        {#if hasActive}
          <ul id="icon-suggest-list" role="listbox" aria-label="Icon suggestions" class="suggestions">
            {#each suggestions as s, i (s.label + (s.imageUrl ?? ''))}
              <!-- Mouse users click a suggestion; keyboard users use ↑/↓ and Tab/Enter on the
                   field (the combobox pattern), so the option itself takes no key events. -->
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <li
                id="icon-suggest-{i}"
                role="option"
                aria-selected={i === activeIndex}
                class:active={i === activeIndex}
                onmousedown={(e) => e.preventDefault()}
                onclick={() => acceptSuggestion(s)}
                onmousemove={() => { activeIndex = i; }}
              >
                <span class="suggestion-icon" aria-hidden="true">
                  {#if s.imageUrl}
                    <img src={s.imageUrl} alt="" width="20" height="20" />
                  {:else if s.icon}
                    <Icon icon={s.icon} width="20" />
                  {/if}
                </span>
                <span class="suggestion-label">{s.label}</span>
                {#if s.source}<span class="suggestion-source">{s.source}</span>{/if}
              </li>
            {/each}
          </ul>
        {/if}
      </div>
      <button
        type="button"
        class="browse-btn"
        onclick={() => showIconPicker = true}
        title="Browse icon library"
        disabled={isUploadingIcon}
      >
        <Icon icon="mdi:apps" width="20" />
        Browse
      </button>
      <button
        type="button"
        class="upload-btn"
        onclick={() => iconFileInput?.click()}
        title="Upload custom icon"
        disabled={isUploadingIcon}
      >
        {#if isUploadingIcon}
          <Icon icon="mdi:loading" width="20" class="spin" />
        {:else}
          <Icon icon="mdi:upload" width="20" />
        {/if}
        Upload
      </button>
      <input
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
        onchange={handleIconUpload}
        bind:this={iconFileInput}
        style="display: none;"
        aria-label="Upload custom icon image"
      />
    </div>

    <!-- Always present so screen readers hear it change; empty while there is nothing to say. -->
    <p id="icon-suggest-status" class="suggest-status" role="status">{statusVisible ? suggestStatus : ''}</p>

    {#if uploadError}
      <small class="error-text" role="alert">{uploadError}</small>
    {/if}

    <small class="hint">Type a name for suggestions (↑/↓ to move, Tab or Enter to accept), browse the icon library, use any name from <a href="https://icon-sets.iconify.design/" target="_blank" rel="noopener">iconify.design</a>, or upload your own</small>

    <div class="icon-bg-section">
      <ColorPicker
        label="Icon background"
        selectedColor={iconBgColor}
        onSelect={onIconBgColorChange}
      />
    </div>

    <div class="footer">
      <button type="button" class="btn-primary" onclick={onClose}>Done</button>
    </div>
  </div>
</Modal>

{#if showIconPicker}
  <IconPickerModal
    currentIcon={icon}
    currentImageUrl={iconUrl}
    onSelect={handleIconSelect}
    onCancel={() => showIconPicker = false}
  />
{/if}

<style>
  .body {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .custom-icon-display {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.6rem 0.85rem;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    background: var(--bg-secondary);
  }

  /* Wrapper that takes on the iconBgColor when one is set, so the
     preview in this modal looks like the rendered tile/folder/tab. */
  .custom-icon-backing {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    border-radius: 0.4rem;
  }

  .custom-icon-backing.has-bg {
    padding: 0.35rem;
  }

  .custom-icon-preview {
    width: 32px;
    height: 32px;
    object-fit: contain;
    flex-shrink: 0;
  }

  .custom-icon-label {
    flex: 1;
    color: var(--text-primary);
    font-size: 0.9rem;
  }

  .clear-icon-btn {
    background: none;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    padding: 0.25rem;
    display: flex;
    align-items: center;
  }

  .clear-icon-btn:hover {
    color: var(--color-error, #ef4444);
  }

  .icon-input-wrapper {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .icon-input {
    flex: 1;
    position: relative;
    min-width: 12rem;
  }

  .icon-input input {
    width: 100%;
    padding: 0.5rem 2.5rem 0.5rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: 0.4rem;
    background: var(--bg-secondary);
    color: var(--text-primary);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.9rem;
  }

  /* M6 §7.6: the placeholder is readable — the theme's secondary text colour at full
     opacity (≥ 8:1 on --bg-secondary in both themes; the browser default was ~2:1). */
  .icon-input input::placeholder {
    color: var(--text-secondary);
    opacity: 1;
    font-style: italic;
  }

  .hint {
    color: var(--text-secondary);
  }

  /* The accent blue is ~3.9:1 on the dark --bg-secondary, and theme presets change that
     background; the hint's link uses the primary text colour, underlined, so it stays
     readable on every preset. */
  .hint a {
    color: var(--text-primary);
    text-decoration: underline;
  }

  .suggestions {
    position: absolute;
    top: calc(100% + 0.25rem);
    left: 0;
    right: 0;
    z-index: 5;
    list-style: none;
    margin: 0;
    padding: 0.25rem;
    border: 1px solid var(--border);
    border-radius: 0.4rem;
    background: var(--bg-primary);
    box-shadow: 0 6px 18px var(--shadow);
  }

  .suggestions li {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.35rem 0.5rem;
    border-radius: 0.3rem;
    cursor: pointer;
    color: var(--text-primary);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.85rem;
  }

  .suggestions li.active {
    background: var(--bg-tertiary);
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  .suggestion-icon {
    display: inline-flex;
    width: 20px;
    height: 20px;
    flex-shrink: 0;
  }

  .suggestion-icon img {
    width: 20px;
    height: 20px;
    object-fit: contain;
  }

  .suggestion-label {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .suggestion-source {
    font-family: inherit;
    font-size: 0.75rem;
    color: var(--text-secondary);
  }

  .suggest-status {
    margin: 0;
    font-size: 0.8rem;
    color: var(--text-secondary);
  }

  /* Empty, it stays in the accessibility tree (a live region) but out of the flex flow. */
  .suggest-status:empty {
    position: absolute;
  }

  .icon-input input:focus {
    outline: none;
    border-color: var(--accent);
  }

  .icon-preview {
    position: absolute;
    right: 0.5rem;
    top: 50%;
    transform: translateY(-50%);
    color: var(--accent);
    border-radius: 0.4rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
  }

  .icon-preview.has-bg {
    padding: 0.2rem;
    /* Override the negative-position trick — we still want a coloured box,
       not a tiny pill behind the icon. */
    right: 0.3rem;
  }

  .browse-btn,
  .upload-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.5rem 0.85rem;
    border: 1px solid var(--border);
    border-radius: 0.4rem;
    background: var(--bg-secondary);
    color: var(--text-primary);
    cursor: pointer;
    font-size: 0.9rem;
  }

  .browse-btn:hover,
  .upload-btn:hover {
    border-color: var(--accent);
  }

  .error-text {
    color: var(--color-error, #ef4444);
  }

  .icon-bg-section {
    margin-top: 0.5rem;
    padding-top: 0.75rem;
    border-top: 1px solid var(--border);
  }

  .footer {
    display: flex;
    justify-content: flex-end;
    margin-top: 0.75rem;
  }

  .btn-primary {
    padding: 0.5rem 1.25rem;
    border: none;
    border-radius: 0.4rem;
    background: var(--accent);
    color: white;
    font-weight: 500;
    cursor: pointer;
  }

  .btn-primary:hover {
    filter: brightness(1.1);
  }

  :global(.spin) {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
</style>
