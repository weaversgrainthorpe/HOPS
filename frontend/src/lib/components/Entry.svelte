<script lang="ts">
  // One tile as the layout renderer draws it (view mode and inside the v3
  // editor, whose containers handle selection, menus and dialogs).
  import type { Entry } from '$lib/types';
  import ColoredIcon from './ColoredIcon.svelte';
  import IframeModal from './IframeModal.svelte';
  import PopupModal from './PopupModal.svelte';
  import StatusIndicator from './StatusIndicator.svelte';
  import { safeOpenUrl, isValidUrl, safeFrameUrl, tileUrlProblem } from '$lib/utils/url';
  import { toast } from '$lib/stores/toast';
  import { isSshUrl, openSshInPlace } from '$lib/utils/ssh';
  import { tileMayBeChecked } from '$lib/editor/statusChecks';
  import { tileOpenUrl, hasAwayUrl } from '$lib/utils/tileUrl';
  import { awayMode } from '$lib/stores/awayMode';
  import { getContext } from 'svelte';
  import { RECENT_CONTEXT, type RecentContext } from '$lib/utils/recentTiles';

  interface Props {
    entry: Entry;
    /**
     * The tile fills its cell exactly (no min-height of its own) and scales its
     * content with the cell (spec §10: a size container). 'compact' marks a small
     * cell but draws the same arrangement; only a note tile drops its body there.
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
  // Home/Away (per browser): the address this tile opens now, the same for every way of opening it.
  const openUrl = $derived(tileOpenUrl(entry, $awayMode));
  const usingAway = $derived($awayMode && hasAwayUrl(entry));
  // Pentest L1: an address outside the allow-list (javascript:, data:, …; the
  // server refuses new ones, but stored data may predate that) is never opened.
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

  // Walkthrough §2: opacity fades the tile's BACKGROUND only (a separate layer, as in
  // FolderSurface); the text and the icon have their own; the status badge never fades.
  // All three are clamped to 0–1 before they reach a style.
  const clamp01 = (n: unknown, d: number) =>
    typeof n === 'number' && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : d;
  const bgOpacity = $derived(String(clamp01(entry.opacity, 0.95)));
  const textOpacity = $derived(String(clamp01(entry.textOpacity, 1)));
  const iconOpacity = $derived(String(clamp01(entry.iconOpacity, 1)));

  // The size class follows the tile (spec §8: a changed Size shows at once, no reload).
  const sizeClass = $derived(entry.size === 'small' || entry.size === 'large' ? entry.size : 'medium');
</script>

<div class="entry-container" class:sized={!!fit} style:height={fit ? '100%' : undefined}>
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
    class:url-broken={!!urlProblem}
    onclick={handleClick}
    title={urlProblem ? `${tileTitle}\n${urlProblemText}` : tileTitle}
    aria-label={inEditor || isNote ? entry.name : `Open ${entry.name}${usingAway ? ' (away address)' : ''}`}
    aria-pressed={inEditor ? editorSelected : undefined}
  >
    <span class="entry-bg" aria-hidden="true" style:background-color={entry.color} style:opacity={bgOpacity}></span>
    {#if isNote}
      <!-- Note tile: just the name as a heading + description as body
           text. No icon, no status badge, no click-to-open. -->
      <div class="note-title" style:opacity={textOpacity}>{entry.name}</div>
      {#if entry.description && !compact}
        <div class="note-body" style:opacity={textOpacity}>{entry.description}</div>
      {/if}
    {:else}
      <div class="title" style:opacity={textOpacity}>{entry.name}</div>

      <div class="icon" style:opacity={iconOpacity}>
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

      <!-- Spec §10: one arrangement at every size and fit. The description is hidden only by a
           container height query, when the tile is too short to fit it. -->
      {#if entry.description}
        <div class="subtitle" style:opacity={textOpacity}>{entry.description}</div>
      {/if}

      <!-- Layered status checks (M4 §4b): a tile switched on or set to inherit asks the
           server, which resolves the levels; an unset or switched-off tile is never checked. -->
      {#if inEditor && urlProblem}
        <span class="url-problem" data-testid="tile-url-problem" role="note">{urlProblemText}</span>
      {/if}

      {#if tileMayBeChecked(entry)}
        <StatusIndicator entryId={entry.id} showOff={inEditor} />
      {/if}
    {/if}
  </button>
</div>

{#if showIframeModal}
  <IframeModal url={openUrl} title={entry.name} onClose={() => showIframeModal = false} />
{/if}

{#if showPopupModal}
  <PopupModal url={openUrl} title={entry.name} onClose={() => showPopupModal = false} />
{/if}

<style>
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
    /* Spec §10: name, icon and description kept together as one group, centred in the tile. */
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

  .title {
    font-weight: 600;
    text-align: center;
    font-size: 0.875rem;
    line-height: 1.2;
    width: 100%;
    flex-shrink: 0;
    /* The name is always shown, on one line. */
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .icon {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--accent-text);
    flex: 0 0 auto;
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

  /* The description: at most two lines, with an ellipsis. */
  .subtitle {
    font-size: 0.75rem;
    line-height: 1.2;
    color: var(--text-secondary);
    text-align: center;
    width: 100%;
    flex-shrink: 0;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
    overflow-wrap: anywhere;
  }

  /* Size variants: the v2 sizes of an unfitted tile (phone stacking). */
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
    font-size: 0.6875rem; /* 11px: the description's readable floor (spec §10 fix round 1) */
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

  /* Layout renderer fit (Ruling 22, spec §10): the cell sets the tile's size (inline height and
     min-height) and the tile is a size container, so its content scales with it: 1cqmin is 1% of
     the tile's shorter side. ONE rule at every size (walkthrough 1, Ruling 10): icon, name,
     description, padding and gaps are a share of the tile, with no caps, so a bigger tile is the same
     tile scaled up; the size class only sets the shares. Medium: icon 34%, name 10.5%, description 9%.
     Large is a scaled-up Medium with its icon about 45% of the tile (Ruling 10). Small keeps its
     smaller shares, so it is driven by the floors. Text has readable floors (fix round 1): a name is
     never under 12px, a description never under 11px. A description that cannot fit at its floor is
     hidden, not shrunk. */
  .entry-container.sized {
    container: tile / size;
  }
  .entry.fill {
    --icon-r: 34cqmin;
    --name-r: 10.5cqmin;
    --desc-r: 9cqmin;
    padding: max(3px, 5cqmin);
    gap: max(2px, 4cqmin);
  }
  .entry.fill.small {
    --icon-r: 28cqmin;
    --name-r: 9cqmin;
    --desc-r: 8cqmin;
  }
  .entry.fill.large {
    --icon-r: 45cqmin;
  }
  /* Large with an icon badge: the badge (icon plus its padding) is the 45%, so the content still fits. */
  .entry.fill.large:has(.icon-backing.has-bg) {
    --icon-r: calc(45cqmin - 2 * clamp(2px, 4cqmin, 8px));
  }
  .entry.fill .title {
    font-size: max(12px, var(--name-r));
  }
  .entry.fill .subtitle {
    font-size: max(11px, var(--desc-r));
  }
  /* Large's description scales too, but never past 1.25rem (review round, walkthrough 1 D: at 1920 it
     reached about 28px, bigger than the navbar title). A smaller description only needs less room. */
  .entry.fill.large .subtitle {
    font-size: clamp(11px, var(--desc-r), 1.25rem);
  }
  .entry.fill .icon :global(svg),
  .entry.fill .icon img {
    width: max(12px, var(--icon-r));
    height: max(12px, var(--icon-r));
  }
  .entry.fill .icon-backing.has-bg {
    padding: clamp(2px, 4cqmin, 8px);
  }
  /* Hide, don't shrink: the description shows only when the tile is tall enough for it at its floor.
     The height the content needs, with s = 1cqmin in px and the text at its floors (line-height 1.2):
       padding 2 x 5s + gaps 2 x 4s + icon (Medium 34s; Small 28s; Large 45s) + name 12 x 1.2
       + description 2 x 11 x 1.2 = 52s + 40.8 px (Small 46s + 40.8; Large 63s + 40.8).
     The worst case is a tile no taller than it is wide (s = height / 100), where that needs
     height >= 85px (Small >= 75.6px, Large >= 110.3px); a taller-than-wide tile needs less. Above the
     floors the shares add up to 86.2s (Large 97.2s), so these never clip. */
  @container tile (max-height: 84.99px) {
    .entry.fill:not(.small) .subtitle {
      display: none;
    }
  }
  @container tile (max-height: 75.99px) {
    .entry.fill.small .subtitle {
      display: none;
    }
  }
  @container tile (max-height: 110.29px) {
    .entry.fill.large .subtitle {
      display: none;
    }
  }

  .entry.selected {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-solid) 30%, transparent);
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
