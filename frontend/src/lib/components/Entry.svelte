<script lang="ts">
  // One tile as the layout renderer draws it (view mode and inside the v3
  // editor, whose containers handle selection, menus and dialogs).
  import type { Entry } from '$lib/types';
  import ColoredIcon from './ColoredIcon.svelte';
  import IframeModal from './IframeModal.svelte';
  import PopupModal from './PopupModal.svelte';
  import StatusIndicator from './StatusIndicator.svelte';
  import TileContent from './layout/TileContent.svelte';
  import { safeOpenUrl, isValidUrl, safeFrameUrl, tileUrlProblem } from '$lib/utils/url';
  import { toast } from '$lib/stores/toast';
  import { isSshUrl, openSshInPlace } from '$lib/utils/ssh';
  import { tileMayBeChecked } from '$lib/editor/statusChecks';
  import { tileOpenUrl, hasAwayUrl } from '$lib/utils/tileUrl';
  import { awayMode } from '$lib/stores/awayMode';
  import { getContext } from 'svelte';
  import { RECENT_CONTEXT, type RecentContext } from '$lib/utils/recentTiles';
  import { textColourOn } from '$lib/utils/colorContrast';

  interface Props {
    entry: Entry;
    /**
     * The tile fills its cell exactly (no min-height of its own) and scales its
     * content with the cell (a size container). 'compact' marks a small
     * cell but draws the same arrangement; only a note tile drops its body there.
     */
    fit?: 'fill' | 'compact';
    /**
     * v3 editor: defined while editing — the tile is a selectable item (its
     * container handles clicks) and this says whether it is selected.
     * Undefined outside the editor.
     */
    editorSelected?: boolean;
    /**
     * The "Recently used" strip: a one-line chip (icon, name, status) instead of the tile. The
     * same entry and the same open path (handleClick below), so Home/Away, open mode, the address
     * check and the recorder behave exactly as on the grid.
     */
    chip?: boolean;
  }

  let { entry, fit, editorSelected, chip = false }: Props = $props();
  const inEditor = $derived(editorSelected !== undefined);
  const compact = $derived(fit === 'compact');
  let showIframeModal = $state(false);
  let showPopupModal = $state(false);

  // Note tiles are text-only — name + description, no URL, no icon, no
  // status, no click-to-open behaviour. Treated as "link" when type is
  // undefined so configs from older HOPS releases keep their existing
  // tile semantics.
  let isNote = $derived(entry.type === 'note');
  // Home/Away (per browser): the address this tile opens now, the same for every way of opening it.
  const openUrl = $derived(tileOpenUrl(entry, $awayMode));
  const usingAway = $derived($awayMode && hasAwayUrl(entry));
  // An address outside the allow-list (javascript:, data:, rdp: …; the server
  // refuses new ones, but stored data may predate that) is never opened.
  // The tile stays visible, says so in edit mode, and a click explains why.
  const urlProblem = $derived(isNote ? null : tileUrlProblem(openUrl));
  const urlProblemText = $derived(
    urlProblem === 'unsafe' ? 'Unsafe address: this tile will not open' : urlProblem === 'blank' ? 'No address: this tile will not open' : ''
  );

  // "Recently used" (per browser): the dashboard's recorder. Every way a tile opens (click, Enter,
  // arrow-key focus then Enter, search's show-and-open, the row itself) comes through handleClick.
  const recent = getContext<RecentContext | undefined>(RECENT_CONTEXT);

  function handleClick() {
    // Note tiles are inert — no URL to open.
    if (isNote) return;
    if (urlProblem) {
      if (!inEditor) toast.error(`"${entry.name}" was not opened: ${urlProblem === 'unsafe' ? "its address isn't one HOPS will open (only http, https, ftp, ssh and mailto)" : 'it has no address'}.`);
      return;
    }
    if (!inEditor) recent?.record(entry.id);

    // ssh:// goes to the computer's SSH app in place: no empty new tab, and
    // never into the iframe/popup modals (whatever mode is stored).
    if (isSshUrl(openUrl)) {
      if (isValidUrl(openUrl)) openSshInPlace(openUrl);
      return;
    }

    switch (entry.openMode) {
      case 'newtab':
        safeOpenUrl(openUrl, '_blank');
        break;
      case 'sametab':
        safeOpenUrl(openUrl, '_self');
        break;
      case 'iframe':
      case 'popup':
        // The dialogs show only http(s) addresses; anything else is refused here too.
        if (!safeFrameUrl(openUrl)) {
          toast.error(`"${entry.name}" was not opened: only http and https addresses open in a ${entry.openMode === 'iframe' ? 'frame' : 'popup'}.`);
          break;
        }
        if (entry.openMode === 'iframe') showIframeModal = true;
        else showPopupModal = true;
        break;
      default:
        // Default to new tab if no mode specified
        safeOpenUrl(openUrl, '_blank');
        break;
    }
  }

  // The hover title. Away, a tile opening its away address says so, and that its status dot is
  // still the server's check of the home address (the server is at home; no Away status is faked).
  const tileTitle = $derived(
    usingAway
      ? `${entry.description || entry.name}\nOpens away address: ${openUrl}${tileMayBeChecked(entry) ? '\nStatus checked at home address' : ''}`
      : entry.description || entry.name
  );

  // Opacity fades the tile's BACKGROUND only (a separate layer, as in
  // FolderSurface); the text and the icon have their own; the status badge never fades.
  // All three are clamped to 0–1 before they reach a style.
  const clamp01 = (n: unknown, d: number) =>
    typeof n === 'number' && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : d;
  const bgOpacity = $derived(String(clamp01(entry.opacity, 0.95)));
  const textOpacity = $derived(String(clamp01(entry.textOpacity, 1)));
  const iconOpacity = $derived(String(clamp01(entry.iconOpacity, 1)));

  // The description is the tile's accessible description, shown or not: a Small tile with no room
  // for it still has it for screen readers (and in its hover title).
  const descId = $props.id();

  // The text on a coloured tile: THE one rule (textColourOn; folders use the same Auto choice). No
  // colour, or one that can't be read, is the theme's surface and text; an unreadable one says so in
  // edit mode (never a silent guess).
  const text = $derived(textColourOn(entry.color, entry.textColor));
  const coloured = $derived(!text.themed);

  // The size class follows the tile (a changed Size shows at once, no reload).
  const sizeClass = $derived(entry.size === 'small' || entry.size === 'large' ? entry.size : 'medium');
</script>

{#if chip}
  <button
    type="button"
    class="recent-chip"
    class:url-broken={!!urlProblem}
    onclick={handleClick}
    title={urlProblem ? `${tileTitle}\n${urlProblemText}` : tileTitle}
    aria-label={`Open ${entry.name}${usingAway ? ' (away address)' : ''}`}
  >
    <span class="chip-icon" aria-hidden="true">
      {#if entry.iconUrl}
        <img src={entry.iconUrl} alt="" />
      {:else}
        <ColoredIcon icon={entry.icon || 'mdi:application'} width="20" />
      {/if}
    </span>
    <span class="title chip-name">{entry.name}</span>
    {#if tileMayBeChecked(entry)}
      <StatusIndicator entryId={entry.id} />
    {/if}
  </button>
{:else}
<div class="entry-container" class:sized={!!fit} style:height={fit ? '100%' : undefined}>
  <button
    class="entry {sizeClass}"
    class:fill={!!fit}
    class:compact
    style:height={fit ? '100%' : undefined}
    style:min-height={fit ? '0px' : undefined}
    style:box-sizing={fit ? 'border-box' : undefined}
    style:overflow={fit ? 'hidden' : undefined}
    class:custom-color={coloured}
    style:--tile-text={coloured ? text.text : undefined}
    class:selected={editorSelected === true}
    class:entry-note={isNote}
    class:url-broken={!!urlProblem}
    onclick={handleClick}
    title={urlProblem ? `${tileTitle}\n${urlProblemText}` : tileTitle}
    aria-label={inEditor || isNote ? entry.name : `Open ${entry.name}${usingAway ? ' (away address)' : ''}`}
    aria-pressed={inEditor ? editorSelected : undefined}
    aria-describedby={!isNote && entry.description ? descId : undefined}
  >
    <span class="entry-bg" aria-hidden="true" style:background-color={coloured ? entry.color : undefined} style:opacity={bgOpacity}></span>
    {#if inEditor && text.invalid}
      <span class="url-problem colour-problem" data-testid="tile-colour-unreadable" role="note">Colour can't be read — theme colour shown</span>
    {/if}
    {#if isNote}
      <!-- Note tile: just the name as a heading + description as body
           text. No icon, no status badge, no click-to-open. -->
      <div class="note-title" style:opacity={textOpacity}>{entry.name}</div>
      {#if entry.description && !compact}
        <div class="note-body" style:opacity={textOpacity}>{entry.description}</div>
      {/if}
    {:else}
      <!-- ONE rule for what's inside (TileContent): the name at the top, the icon a fixed share of the
           tile, the description under it without moving the icon. -->
      <TileContent name={entry.name} size={sizeClass} description={entry.description || undefined} descriptionId={descId} {textOpacity}>
        {#snippet icon()}
          <!-- icon-backing exists on every tile so layout doesn't shift when the optional background is
               added/removed. It's only visually present (padding + rounding + bg) when entry.iconBgColor is set. -->
          <div class="icon" style:opacity={iconOpacity}>
            <div class="icon-backing" class:has-bg={entry.iconBgColor} style:background-color={entry.iconBgColor}>
              {#if entry.iconUrl}
                <img src={entry.iconUrl} alt="" />
              {:else}
                <ColoredIcon icon={entry.icon || 'mdi:application'} width="100%" />
              {/if}
            </div>
          </div>
        {/snippet}
      </TileContent>

      <!-- Status checks: a tile switched On (or holding a setting HOPS can't read, shown as
           such) asks the server, which applies the gates above it; an Off tile is never checked. -->
      {#if inEditor && urlProblem}
        <span class="url-problem" data-testid="tile-url-problem" role="note">{urlProblemText}</span>
      {/if}

      {#if tileMayBeChecked(entry)}
        <StatusIndicator entryId={entry.id} showOff={inEditor} />
      {/if}
    {/if}
  </button>
</div>
{/if}

{#if showIframeModal}
  <IframeModal url={openUrl} title={entry.name} onClose={() => showIframeModal = false} />
{/if}

{#if showPopupModal}
  <PopupModal url={openUrl} title={entry.name} onClose={() => showPopupModal = false} />
{/if}

<style>
  /* Recently used chip: 40px tall (the phone tap target), one line, the name truncated. Theme
     tokens only: --text-primary on --bg-secondary is the same pair every dialog uses (>= 4.5:1). */
  .recent-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    flex: 0 0 auto;
    height: 40px;
    min-width: 40px;
    max-width: 12rem;
    padding: 0 0.6rem;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    background: var(--bg-secondary);
    color: var(--text-primary);
    font-size: 0.875rem;
    cursor: pointer;
  }
  .recent-chip:hover,
  .recent-chip:focus-visible {
    background: var(--bg-tertiary);
  }
  .recent-chip.url-broken {
    border-style: dashed;
  }
  .chip-icon {
    display: inline-flex;
    flex: 0 0 20px;
    width: 20px;
    height: 20px;
  }
  .chip-icon img {
    width: 20px;
    height: 20px;
    object-fit: contain;
  }
  .chip-name {
    font-weight: 600;
    line-height: 1.2;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .recent-chip :global(.status-badge) {
    position: static;
    flex: 0 0 auto;
  }
  .url-problem {
    position: absolute;
    left: 0.25rem;
    right: 0.25rem;
    bottom: 0.25rem;
    padding: 0.125rem 0.25rem;
    border-radius: 0.25rem;
    background: var(--danger, #b91c1c);
    color: #fff;
    font-size: 0.7rem;
    line-height: 1.2;
    text-align: center;
    z-index: 2;
  }
  /* An unreadable colour's note sits at the top, so it never covers an address note. */
  .colour-problem {
    top: 0.25rem;
    bottom: auto;
  }

  .entry.url-broken {
    outline: 2px dashed var(--danger, #b91c1c);
    outline-offset: -2px;
  }

  .entry-container {
    position: relative;
    width: 100%;
    height: 100%;
  }

  .entry {
    display: flex;
    flex-direction: column;
    align-items: center;
    /* Name, icon and description kept together as one group, centred in the tile. */
    justify-content: center;
    gap: 0.5rem;
    padding: 1rem 1.5rem;
    /* The background is drawn by .entry-bg (its own opacity), never by the tile itself. */
    background: transparent;
    isolation: isolate;
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

  /* The tile's background layer: behind the content, inside the tile's own stacking
     context (isolation), so its opacity never fades the text, icon or status badge. */
  .entry-bg {
    position: absolute;
    inset: 0;
    z-index: -1;
    border-radius: inherit;
    background-color: var(--bg-secondary);
    pointer-events: none;
    transition: background-color 0.2s;
  }

  .entry:hover .entry-bg {
    background-color: var(--bg-tertiary);
  }

  .entry:hover {
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

  .entry-note:hover .entry-bg {
    background-color: var(--bg-secondary);
  }

  .entry-note:hover {
    /* Suppress the link-tile hover effect entirely. */
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

  /* What's inside a link tile is TileContent's (one rule at every size; the dashboard's Tile content
     size scales it). These style only the icon in its square: it fills the square, a badge included. */
  /* A square as tall as the icon's box (at Small the box is the full width; the icon stays square). */
  .icon {
    height: 100%;
    aspect-ratio: 1;
    max-width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--accent-text);
  }

  /* Wrapper around the icon graphic. Invisible by default — only takes on
     padding + rounded corners + a background when the user has set
     iconBgColor (giving a "logo badge" look that rescues dark logos on
     dark tiles). The badge is the icon's square, so it never needs more room. */
  .icon-backing {
    width: 100%;
    height: 100%;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .icon-backing.has-bg {
    padding: 8%;
    border-radius: 12%;
  }

  .icon img,
  .icon :global(svg) {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  /* Phone (stacked) tiles keep their own outer sizes, the v2 sizes (geometry.PHONE_TILE_MIN_PX); inside,
     the same rule. A link tile's content is positioned in it, so the tile needs no padding of its own. */
  .small {
    min-height: 100px;
  }
  .medium {
    min-height: 120px;
  }
  .large {
    min-height: 160px;
  }
  .entry:not(.entry-note) {
    padding: 0;
  }

  /* Layout renderer fit: the cell sets the tile's size (inline height and min-height). A note's
     text scales with the tile (a size container: 1cqmin is 1% of its shorter side). */
  .entry-container.sized {
    container: tile / size;
  }
  .entry.fill.entry-note {
    padding: max(3px, 5cqmin);
  }
  /* A note has no icon, so its title has the whole Small tile: three lines at the name's size. */
  .entry.fill.small .note-title {
    font-size: max(12px, 9cqmin);
    line-height: 1.1;
    overflow: hidden;
    overflow-wrap: anywhere;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
    line-clamp: 3;
  }

  .entry.selected {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-solid) 30%, transparent);
  }

  /* A coloured tile: its text (and an icon drawn in the text colour) is --tile-text, set from the
     one text-colour rule (textColourOn): white or black, never a fixed white. */
  .entry.custom-color {
    color: var(--tile-text);
    border-color: rgba(255, 255, 255, 0.2);
  }

  .entry.custom-color :global(.title),
  .entry.custom-color :global(.subtitle),
  .entry.custom-color .note-title,
  .entry.custom-color .note-body {
    color: var(--tile-text);
  }

  .entry.custom-color .icon {
    color: var(--tile-text);
  }

  .entry.custom-color:hover {
    filter: brightness(1.1);
    border-color: rgba(255, 255, 255, 0.4);
  }

</style>
