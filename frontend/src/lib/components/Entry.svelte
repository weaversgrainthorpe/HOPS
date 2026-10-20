<script lang="ts">
  // One tile as the layout renderer draws it (view mode and inside the v3
  // editor, whose containers handle selection, menus and dialogs).
  import type { Entry } from '$lib/types';
  import ColoredIcon from './ColoredIcon.svelte';
  import IframeModal from './IframeModal.svelte';
  import PopupModal from './PopupModal.svelte';
  import StatusIndicator from './StatusIndicator.svelte';
  import { safeOpenUrl } from '$lib/utils/url';

  interface Props {
    entry: Entry;
    /**
     * The tile fills its cell exactly (no min-height of its own); 'compact'
     * also drops the description and shrinks padding/icon for small cells.
     */
    fit?: 'fill' | 'compact';
    /**
     * v3 editor: defined while editing — the tile is a selectable item (its
     * container handles clicks) and this says whether it is selected.
     * Undefined outside the editor.
     */
    editorSelected?: boolean;
  }

  let { entry, fit, editorSelected }: Props = $props();
  const inEditor = $derived(editorSelected !== undefined);
  const compact = $derived(fit === 'compact');
  let showIframeModal = $state(false);
  let showPopupModal = $state(false);

  // Note tiles are text-only — name + description, no URL, no icon, no
  // status, no click-to-open behaviour. Treated as "link" when type is
  // undefined so configs from older HOPS releases keep their existing
  // tile semantics.
  let isNote = $derived(entry.type === 'note');

  function handleClick() {
    // Note tiles are inert — no URL to open.
    if (isNote) return;

    switch (entry.openMode) {
      case 'newtab':
        safeOpenUrl(entry.url, '_blank');
        break;
      case 'sametab':
        safeOpenUrl(entry.url, '_self');
        break;
      case 'iframe':
        showIframeModal = true;
        break;
      case 'popup':
        showPopupModal = true;
        break;
      default:
        // Default to new tab if no mode specified
        safeOpenUrl(entry.url, '_blank');
        break;
    }
  }

  // Get size classes
  // svelte-ignore state_referenced_locally
  const sizeClass = entry.size || 'medium';
</script>

<div class="entry-container" style:height={fit ? '100%' : undefined}>
  <button
    class="entry {sizeClass}"
    class:fill={!!fit}
    class:compact
    style:height={fit ? '100%' : undefined}
    style:min-height={fit ? '0px' : undefined}
    style:box-sizing={fit ? 'border-box' : undefined}
    style:overflow={fit ? 'hidden' : undefined}
    class:custom-color={entry.color}
    class:selected={editorSelected === true}
    class:entry-note={isNote}
    style:background-color={entry.color}
    style:opacity={entry.opacity !== undefined ? entry.opacity : 0.95}
    onclick={handleClick}
    title={entry.description || entry.name}
    aria-label={inEditor || isNote ? entry.name : `Open ${entry.name}`}
    aria-pressed={inEditor ? editorSelected : undefined}
  >
    {#if isNote}
      <!-- Note tile: just the name as a heading + description as body
           text. No icon, no status badge, no click-to-open. -->
      <div class="note-title">{entry.name}</div>
      {#if entry.description && !compact}
        <div class="note-body">{entry.description}</div>
      {/if}
    {:else}
      <div class="title">{entry.name}</div>

      <div class="icon">
        <!-- icon-backing exists on every tile so layout doesn't shift when
             the optional background is added/removed. It's only visually
             present (padding + rounding + bg) when entry.iconBgColor is set. -->
        <div
          class="icon-backing"
          class:has-bg={entry.iconBgColor}
          style:background-color={entry.iconBgColor}
        >
        {#if entry.iconUrl}
          <img src={entry.iconUrl} alt="" />
        {:else if entry.icon}
          <ColoredIcon icon={entry.icon} width="48" />
        {:else}
          <ColoredIcon icon="mdi:application" width="48" />
        {/if}
        </div>
      </div>

      {#if entry.description && !compact}
        <div class="subtitle">{entry.description}</div>
      {/if}

      {#if entry.statusCheck?.enabled}
        <div class="status-badge">
          <StatusIndicator entryId={entry.id} />
        </div>
      {/if}
    {/if}
  </button>
</div>

{#if showIframeModal}
  <IframeModal url={entry.url} title={entry.name} onClose={() => showIframeModal = false} />
{/if}

{#if showPopupModal}
  <PopupModal url={entry.url} title={entry.name} onClose={() => showPopupModal = false} />
{/if}

<style>
  .entry-container {
    position: relative;
    width: 100%;
    height: 100%;
  }

  .entry {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 1rem 1.5rem;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 0.75rem;
    cursor: pointer;
    transition: all 0.2s;
    text-decoration: none;
    color: var(--text-primary);
    position: relative;
    min-height: 120px;
    width: 100%;
  }

  .entry:hover {
    background: var(--bg-tertiary);
    border-color: var(--accent);
    transform: translateY(-2px);
    box-shadow: 0 4px 12px var(--shadow);
  }

  /* Keyboard focus ring — visible only for keyboard navigation (focus-visible),
     not after a click. Two ring layers so it stands out on any background. */
  .entry:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 3px;
    box-shadow: 0 0 0 4px rgba(79, 140, 255, 0.15);
  }

  /* Note tiles: text-only, no hover lift (they don't open anything), and a
     left-aligned layout that reads more like a panel of text than a tile. */
  .entry-note {
    cursor: default;
    align-items: flex-start;
    justify-content: flex-start;
    text-align: left;
    padding: 1rem 1.25rem;
  }

  .entry-note:hover {
    /* Suppress the link-tile hover effect entirely. */
    background: var(--bg-secondary);
    border-color: var(--border);
    transform: none;
    box-shadow: none;
  }

  .note-title {
    font-weight: 700;
    font-size: 1.05rem;
    color: var(--text-primary);
    line-height: 1.3;
  }

  .note-body {
    margin-top: 0.4rem;
    font-size: 0.9rem;
    color: var(--text-secondary);
    line-height: 1.45;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .title {
    font-weight: 600;
    text-align: center;
    font-size: 0.875rem;
    width: 100%;
    flex-shrink: 0;
  }

  .icon {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--accent);
    flex: 1;
  }

  /* Wrapper around the icon graphic. Invisible by default — only takes on
     padding + rounded corners + a background when the user has set
     iconBgColor (giving a "logo badge" look that rescues dark logos on
     dark tiles). */
  .icon-backing {
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .icon-backing.has-bg {
    padding: 0.5rem;
    border-radius: 0.5rem;
  }

  .icon img {
    width: 48px;
    height: 48px;
    object-fit: contain;
  }

  .status-badge {
    position: absolute;
    top: 0.375rem;
    right: 0.375rem;
    background: rgba(0, 0, 0, 0.4);
    border-radius: 50%;
    padding: 2px;
  }

  .subtitle {
    font-size: 0.75rem;
    color: var(--text-secondary);
    text-align: center;
    width: 100%;
    flex-shrink: 0;
  }

  /* Size variants */
  .small {
    min-height: 100px;
    padding: 0.75rem 1rem;
  }

  .small .title {
    font-size: 0.75rem;
  }

  .small .icon :global(svg) {
    width: 32px;
    height: 32px;
  }

  .small .icon img {
    width: 32px;
    height: 32px;
  }

  .small .subtitle {
    font-size: 0.65rem;
  }

  .medium {
    min-height: 120px;
  }

  .medium .icon :global(svg) {
    width: 48px;
    height: 48px;
  }

  .large {
    min-height: 160px;
    padding: 1.25rem 1.5rem;
  }

  .large .title {
    font-size: 1rem;
  }

  .large .icon :global(svg) {
    width: 64px;
    height: 64px;
  }

  .large .icon img {
    width: 64px;
    height: 64px;
  }

  .large .subtitle {
    font-size: 0.875rem;
  }

  /* Layout renderer fit (Ruling 22): the cell sets the size (inline height/min-height),
     so content shrinks to it rather than spilling into the next row. */
  .entry.fill {
    padding: 0.6rem 0.75rem;
    gap: 0.3rem;
  }
  .entry.fill .title,
  .entry.fill .subtitle {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .entry.fill .icon {
    min-height: 0;
  }
  .entry.fill .icon :global(svg),
  .entry.fill .icon img {
    max-height: 100%;
  }
  .entry.compact {
    padding: 0.35rem 0.4rem;
    gap: 0.2rem;
    justify-content: center;
  }
  .entry.compact .title {
    font-size: 0.7rem;
    order: 1;
  }
  .entry.compact .icon :global(svg),
  .entry.compact .icon img {
    width: 28px;
    height: 28px;
  }
  .entry.compact .icon-backing.has-bg {
    padding: 0.25rem;
  }

  .entry.selected {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 30%, transparent);
  }

  /* Custom color styles */
  .entry.custom-color {
    color: white;
    border-color: rgba(255, 255, 255, 0.2);
  }

  .entry.custom-color .title,
  .entry.custom-color .subtitle {
    color: white;
  }

  .entry.custom-color .icon {
    color: white;
  }

  .entry.custom-color:hover {
    filter: brightness(1.1);
    border-color: rgba(255, 255, 255, 0.4);
  }

</style>
