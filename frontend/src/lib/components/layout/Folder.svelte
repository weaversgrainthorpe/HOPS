<script lang="ts">
  /**
   * THE folder (M5 §2, plan Task 3): one component draws every folder, everywhere, in view and edit
   * mode, on the tab and on a phone.
   * - minimised: a tile of the folder's own size (on a tab, at the top-left of the space it keeps;
   *   inside a folder, at that folder's contents size) with its name and up to four child icons;
   * - open: a box with a title bar (name or breadcrumb, edit handle in edit mode, minimise), ONE page
   *   of its items at its contents size (only the current page is drawn, Tenet 4) and a page bar
   *   only when there is more than one page;
   * - drilled (M5 §7): a folder inside a folder — every opened sub-folder level is an inset box inside
   *   the last (its own colour), and only the innermost box holds a page. Every box's title bar is the
   *   top folder's (Ruling 15): its name on the left, the same minimise on the right (on an inset box it
   *   returns it to its tile in the parent: up one level). An outer box's title goes back up to that level.
   * Click, Enter, the menu's "Open" and Restore all open a folder in place: nothing pops over.
   * Page and drill-down are this browser's memory (folderView), never saved to the layout.
   * The drag (hitTest, Task 4) reads data-folder-id / data-folder-page / data-folder-per-page (the
   * page shown: a drop goes at the pointer's place in it), data-folder-bar (the title bar: a drop
   * goes at the end of the folder shown), data-page-bar ("prev" / "next": held, it flips the page)
   * and data-crumb (the folder id an outer box's title bar goes back to: held, it goes up; a
   * drop goes at its end). Only the innermost box's bar is data-folder-bar; inset boxes carry
   * data-nested-folder, never data-node-id (they are levels of this folder, not items).
   */
  import { getContext, tick, untrack } from 'svelte';
  import type { FolderNode, LayoutDashboard, LayoutTab } from '$lib/types/layout';
  import type { CanvasPlan, ContainerMetrics } from '$lib/layout/geometry';
  import {
    FOLDER_CHROME, NESTED_CHROME, NESTED_LEVEL_Y_PX, folderFlowMetrics, folderTabRect, hasTab, isFolderShape, nestedPaging, nodeBox,
    folderMinCells, openFolderContentBox, phoneFlowMetrics, phonePaging, previewChildren, shapeOf, sizeSpan
  } from '$lib/layout/geometry';
  import { deriveFolderColours } from '$lib/layout/folderColours';
  import { MINI_NAME_MIN_TILE_PX, shapeParts, tabWantPx } from '$lib/layout/folderShapePaths';
  import FolderShape from './FolderShape.svelte';
  import { getTextColorValue } from '$lib/utils/colorContrast';
  import Icon from '@iconify/svelte';
  import ColoredIcon from '../ColoredIcon.svelte';
  import ContainerView from './ContainerView.svelte';
  import {
    FOLDER_VIEW_CONTEXT, clearFolderView, differsFromSaved, drillTo, folderNavFor, pageReveal, resolveDrill,
    setFolderDrill, setFolderPage, setFolderView, takePageReveal, type FolderViewContext
  } from '$lib/stores/folderView';
  import { selectedNodes, toggleNode } from '$lib/stores/nodeSelection';
  import { editorMenu, openDialog, openMenu, menuPointFor } from '$lib/editor/editorUi';
  import { get } from 'svelte/store';
  import { makeFolderBigEnough, setDisplay } from '$lib/editor/editorActions';
  import { playDrill, playFolderToggle, playPageSlide } from '$lib/editor/drag/flourishes';
  import { drag, dragSource } from '$lib/editor/drag/dragController';
  import { crumbDwellKey, pageDwellKey } from '$lib/editor/drag/targets';
  import { COLLAPSED_HINT } from '$lib/editor/resize';
  import { focusFolderControl } from '$lib/utils/overlayActions';
  import ResizeHandles from '../editor/ResizeHandles.svelte';
  import EditHandle from '../editor/EditHandle.svelte';
  import BackgroundFailedBadge from '../background/BackgroundFailedBadge.svelte';

  interface Props {
    folder: FolderNode;
    /** Grid placement CSS from the container it sits in. */
    style?: string;
    plan: CanvasPlan;
    dashboard: LayoutDashboard;
    tab: LayoutTab;
    /** Folders enclosing this one (outermost first); does not include `folder`. */
    folderChain: FolderNode[];
    /** Metrics of the container this folder sits in; every inner size derives from them. */
    parent: ContainerMetrics;
    /** An item on another folder's page: always its minimised tile; opening it drills in. */
    item?: boolean;
    /** Edit mode: a click selects (a minimised folder: and opens), double-click / the handle edits, right-click = item menu. */
    editing?: boolean;
    /** M6 §13: rows this folder is drawn taller on this screen outside edit mode (render-only, never saved; 0 = as stored). */
    screenExtraRows?: number;
  }
  let { folder, style = '', plan, dashboard, tab, folderChain, parent, item = false, editing = false, screenExtraRows = 0 }: Props = $props();

  const minimised = $derived(item || folder.display === 'collapsed');

  // ---- editing: select, edit, menu, drag (as every item)
  const selected = $derived(editing && $selectedNodes.has(folder.id));
  function select(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation(); // an enclosing folder must not select itself too
    toggleNode(folder.id, e.ctrlKey || e.metaKey);
  }
  function menu(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    cancelPendingOpen(); // the menu is the answer to this press, never also an open
    openMenu({ ...menuPointFor(e, e.currentTarget as Element), target: { kind: 'node', id: folder.id } });
  }
  /** Touch long-press released without moving (Ruling 18(1)): the folder's menu. */
  const pressed = (x: number, y: number) => {
    cancelPendingOpen();
    openMenu({ x, y, target: { kind: 'node', id: folder.id } });
  };
  /** Every item edits the same way (§4B): the handle and a double-click open the folder dialog. */
  const edit = () => openDialog({ kind: 'folder', id: folder.id });
  const dragging = $derived(editing && ($drag?.ids.includes(folder.id) ?? false));
  /** In edit mode a control's click (and double-click) is its own: it never also selects or edits the folder. */
  function own(e: Event) {
    if (editing) e.stopPropagation();
  }

  // ---- this viewer's remembered view and the saved default (TabCanvas has already applied the view)
  const views = getContext<FolderViewContext | undefined>(FOLDER_VIEW_CONTEXT);
  const remembered = $derived(views?.remembered(folder.id));
  const saved = $derived(views?.saved(folder.id) ?? folder.display);
  const showRestore = $derived(!editing && !item && !!views && differsFromSaved(saved, remembered));
  /** The folder's name in its controls' labels, as an inset box's ("Untitled folder" when it shows none). */
  const boxName = $derived(folder.showTitle === false || !folder.name?.trim() ? 'Untitled folder' : folder.name);

  /** The clicked control is about to unmount: hand focus to whatever replaces it. */
  async function thenFocus() {
    await tick();
    focusFolderControl(folder.id);
  }

  /**
   * Open in place (click, Enter, the menu's Open): a sub-folder on a page drills in (this browser's
   * memory, in view and edit mode alike); a folder on the tab opens into the space it kept — in edit
   * mode that is its saved default (undoable, as Minimise there), else this viewer's view.
   */
  function open() {
    if (item) {
      // §9: the inner box zooms forward from this tile; the open folder holding it recedes slightly.
      if (folderChain[0]) playDrill(dashboard.id, folder.id, folderChain[0].id, 'in');
      drillTo(dashboard.id, [...folderChain.map((f) => f.id), folder.id]);
      return;
    }
    playFolderToggle(dashboard.id, folder.id, 'open'); // §9: it grows from its tile into its box
    if (editing) setDisplay(folder.id, 'expanded');
    else setFolderView(dashboard.id, folder.id, 'expanded');
    void thenFocus();
  }
  function minimise(e: Event) {
    own(e);
    playFolderToggle(dashboard.id, folder.id, 'minimise'); // §9: it shrinks back into its tile
    if (editing) setDisplay(folder.id, 'collapsed');
    else setFolderView(dashboard.id, folder.id, 'collapsed');
    void thenFocus();
  }
  function restore(e: Event) {
    own(e);
    playFolderToggle(dashboard.id, folder.id, minimised ? 'open' : 'minimise');
    clearFolderView(dashboard.id, folder.id);
    void thenFocus();
  }
  /**
   * A click on the minimised tile opens it (M5 §3a.8: click, Enter, the menu's Open — in edit mode
   * too, walkthrough 1). In edit mode a double-click edits it instead (§4B), so the open waits out the
   * double-click: the dblclick cancels it, and a double-click never also opens. Edit mode also
   * selects a folder on the tab at once (its outline shows; it is then the open box); a sub-folder on
   * a page drills in and is not selected (it would be a selection nobody can see). Ctrl/Cmd/Shift
   * only changes the selection, as on every item.
   */
  const OPEN_AFTER_DOUBLE_CLICK_MS = 300;
  let pendingOpen: ReturnType<typeof setTimeout> | null = null;
  function cancelPendingOpen() {
    if (pendingOpen !== null) clearTimeout(pendingOpen);
    pendingOpen = null;
  }
  $effect(() => () => cancelPendingOpen());
  function onTileClick(e: MouseEvent) {
    if (!editing) {
      open();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.shiftKey) {
      select(e);
      return;
    }
    e.preventDefault();
    e.stopPropagation(); // an enclosing folder must not select itself too
    if (e.detail > 1) return; // the second click of a double-click: its dblclick edits
    // A menu is open: this click is the release of the long-press (or right-press) that opened it —
    // a tablet sends one after the long-press. A real new tap first presses outside the menu, which
    // closes it. So it neither opens nor selects (walkthrough 1 D).
    if (get(editorMenu) !== null) return;
    if (!item) toggleNode(folder.id, false);
    cancelPendingOpen();
    pendingOpen = setTimeout(() => {
      pendingOpen = null;
      open();
    }, OPEN_AFTER_DOUBLE_CLICK_MS);
  }
  function onTileKey(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      open();
    }
  }

  // ---- look (M6): the folder's shape is drawn by FolderShape behind its content, in every state. Its
  // colour look applies to the SHAPE only, never to the tiles inside.
  const showTitle = $derived(folder.showTitle !== false);
  /** Tab shapes put the name on the tab and the controls at the top-right of the body (§3a.2). */
  const tabbed = $derived(hasTab(folder.shape));
  const tabPos = $derived(folder.tabPosition === 'centre' || folder.tabPosition === 'right' ? folder.tabPosition : 'left');
  /** The text colour on a look: Rounded keeps M5's; a tab shape uses its contrast-safe colour (§3a.7). */
  function lookText(f: FolderNode): string | undefined {
    if (!hasTab(f.shape)) return f.color ? getTextColorValue(f.textColor || 'auto', f.color) : undefined;
    if (shapeOf(f.shape) === 'folder-outline') return undefined; // see-through: the text of what shows through
    const c = deriveFolderColours(f.color, f.textColor);
    return c.text === 'inherit' ? undefined : c.text;
  }
  const textColor = $derived(lookText(folder) ?? 'inherit');
  /** Never silent (§3.9): a stored look or colour that can't be drawn says so in edit mode. */
  function lookProblems(f: FolderNode): { unknownShape: string | null; unreadableColour: boolean } {
    return {
      unknownShape: f.shape !== undefined && !isFolderShape(f.shape) ? String(f.shape) : null,
      unreadableColour: deriveFolderColours(f.color, f.textColor).invalid
    };
  }
  const problems = $derived(lookProblems(folder));
  /**
   * Never silent: a tab-level folder STORED below its smallest open box (imported, converted, or saved
   * before the minimum — edits can't make one) is flagged in edit mode, with a one-click fix.
   */
  const belowMin = $derived.by(() => {
    if (!editing || item || !folder.placement) return null;
    const m = folderMinCells(folder);
    const p = folder.placement;
    return p.w < m.w || p.h < m.h ? m : null;
  });
  /** The width a tab's label asks for: its name (and icon); an untitled tab asks for none. */
  function wantOf(f: FolderNode, compact = false): number {
    return f.showTitle === false ? 0 : tabWantPx(f.name ?? '', !compact && !!(f.iconUrl || f.icon), compact);
  }

  // ---- minimised tile: a compact version of its shape (measured: its size depends on where it is)
  let tileW = $state(0);
  let tileH = $state(0);
  /** The Small silhouette (§3a.6): too small for a 12 px name, so only the shape and its icons. */
  const silhouette = $derived(tabbed && tileH > 0 && tileH < MINI_NAME_MIN_TILE_PX);
  /** A tab shape's tile lays its name and icons out on the front panel, below the tab. */
  const miniFrontPx = $derived(
    tabbed ? shapeParts(folder.shape, folder.tabPosition, 'minimised', { widthPx: tileW || 120, heightPx: tileH || 120 }).frontRect.topPx : 0
  );
  /**
   * A tab shape's icons fit the front panel under its name: the grid (square) is no taller than the
   * room left below the tab, the name (~18 px + gap) and the bottom padding.
   */
  const miniGridPx = $derived(
    tabbed && tileH > 0 ? Math.max(12, Math.min(64, tileH - miniFrontPx - 2 - 8 - (silhouette ? 0 : 22))) : undefined
  );
  const previews = $derived(previewChildren(folder));
  const itemCount = $derived(Array.isArray(folder.content?.children) ? folder.content.children.length : 0);
  // Children exist but none can be drawn: say so, never "Empty folder" (no silent failures).
  const unreadable = $derived(previews.length === 0 && itemCount > 0);
  const collapsedLabel = $derived(
    `${folder.name}, folder with ${itemCount} ${itemCount === 1 ? 'item' : 'items'}` +
      (unreadable ? " (can't display its contents)" : '')
  );

  // ---- open: drill-down, the page model and the page shown (one geometry source: geometry.ts)
  const nav = $derived(folderNavFor(dashboard.id));
  const drilled = $derived(minimised ? [] : resolveDrill(folder, $nav.drill[folder.id]));
  const current = $derived(drilled.length > 0 ? drilled[drilled.length - 1] : folder);
  const chainShown = $derived([...folderChain, folder, ...drilled]);
  /** How many inset boxes deep the page is drawn (0 = this folder's own body). */
  const levels = $derived(drilled.length);
  const kids = $derived(Array.isArray(current.content?.children) ? current.content.children : []);
  // On a phone an open folder spans the stacked canvas (its width and the viewport come with the plan:
  // no extra observer, Tenet 4) and its items are the phone tab's tiles; on a tab it fills the box it
  // keeps and its items are tab cells at its contents size. One page model each (geometry.ts).
  const stacked = $derived(plan.kind === 'stacked' || !folder.placement);
  const phoneCanvasPx = $derived(plan.kind === 'stacked' ? (plan.widthPx ?? 0) : 0);
  // The open box: its content inset is its shape's (shapeInset), so a tab shape's page is the tab
  // allowance shorter than Rounded's (M6 §3a.4).
  const openBoxWidthPx = $derived(stacked ? phoneCanvasPx : nodeBox(folder.placement!, parent).widthPx);
  const contentWidthPx = $derived(
    stacked
      ? Math.max(0, phoneCanvasPx - FOLDER_CHROME.padXPx)
      : openFolderContentBox(nodeBox(folder.placement!, parent), folder.shape, folder.tabPosition).widthPx
  );
  /** Where the open folder's tab and its name sit (the same rect FolderShape draws). */
  const topTab = $derived(
    tabbed ? folderTabRect(folder.shape, folder.tabPosition, { widthPx: openBoxWidthPx, heightPx: 0 }, wantOf(folder)) : null
  );
  /** A nested level's box (level k fills the body of level k - 1) and its tab. */
  function nestedTab(f: FolderNode, k: number) {
    const widthPx = Math.max(0, contentWidthPx - (k - 1) * NESTED_CHROME.padXPx);
    return folderTabRect(f.shape, f.tabPosition, { widthPx, heightPx: 0 }, wantOf(f, true));
  }
  // The innermost box's content width: one inset box (NESTED_CHROME) comes off each level (M5 §7).
  const innerWidthPx = $derived(Math.max(0, contentWidthPx - levels * NESTED_CHROME.padXPx));
  const asked = $derived($nav.page[current.id] ?? 0);
  const phone = $derived(
    stacked
      ? phonePaging(
          innerWidthPx,
          phoneCanvasPx,
          {
            widthPx: plan.kind === 'stacked' ? (plan.viewportWidthPx ?? phoneCanvasPx) : 0,
            // Each inset level's tab allowance, bar and padding come off the screen a page may use.
            heightPx:
              plan.kind === 'stacked'
                ? Math.max(0, (plan.viewportHeightPx ?? 0) - levels * NESTED_LEVEL_Y_PX - (tabbed ? FOLDER_CHROME.tabPx : 0))
                : 0
          },
          current.contentSize,
          kids.length,
          asked
        )
      : null
  );
  const paging = $derived(
    phone
      ? { ...phone, noRoom: false, noRoomInside: false }
      : nestedPaging(openFolderContentBox(nodeBox(folder.placement!, parent), folder.shape, folder.tabPosition), levels, current.contentSize, parent.unitPx, kids.length, asked)
  );
  const metrics = $derived(phone ? phoneFlowMetrics(phone, innerWidthPx) : folderFlowMetrics(paging, parent.unitPx, innerWidthPx));
  const pageKids = $derived(kids.slice(paging.start, paging.end));
  const pageNumbers = $derived(paging.pages <= 7 ? Array.from({ length: paging.pages }, (_, i) => i) : []);
  /** The dwell a drag is holding over this folder's page arrows or crumbs (shown, so the hold is visible). */
  const holdingKey = $derived(editing ? ($drag?.dwell?.key ?? null) : null);

  function goPage(e: Event, n: number) {
    own(e);
    const p = Math.min(Math.max(0, n), paging.pages - 1);
    const from = paging.page;
    setFolderPage(dashboard.id, current.id, p);
    // §9: the new page slides in from the side it comes from (next from the right); a jump slides once.
    if (p !== from) playPageSlide(dashboard.id, current.id, p > from ? 1 : -1);
  }
  /** Back up to that level (0 = this folder itself): an inset box's minimise, or an outer box's title. */
  function goUp(e: Event, level: number) {
    own(e);
    // §9: the box left shrinks back into its tile in the level above; the folder comes forward again.
    const leaving = drilled[level];
    if (leaving) playDrill(dashboard.id, leaving.id, folder.id, 'up');
    setFolderDrill(dashboard.id, folder.id, drilled.slice(0, level).map((f) => f.id));
  }
  /** An inset box's bar is that sub-folder (Ruling 14): its right-click / long-press menu is the sub-folder's. */
  function subMenu(e: MouseEvent, id: string) {
    e.preventDefault();
    e.stopPropagation();
    openMenu({ ...menuPointFor(e, e.currentTarget as Element), target: { kind: 'node', id } });
  }
  /**
   * An inset box's bar grabbed (Ruling 14): the sub-folder is dragged as the tile it is on its parent's
   * page — that parent's item size (a phone tab column there), centred on the pointer — never as the
   * wide bar, so the ghost and the drop it aims are the sub-folder's own.
   */
  function grabbedTile(x: number, y: number, parentFolder: FolderNode) {
    const side = stacked ? (phone?.itemPx ?? 120) : sizeSpan(parentFolder.contentSize) * parent.unitPx;
    return { left: x - side / 2, top: y - side / 2, width: side, height: side };
  }
  /**
   * An inset box's minimise (Ruling 15): it returns to its tile in the parent — up one level, this
   * browser's memory (in edit mode too, never the draft). Focus goes to that tile (or, when it is on
   * another page of the parent, to the folder's own control).
   */
  function minimiseSub(e: Event, k: number, id: string) {
    goUp(e, k - 1);
    void tick().then(() => {
      const tile = Array.from(document.querySelectorAll<HTMLElement>('[data-node-id]'))
        .find((n) => n.getAttribute('data-node-id') === id && !n.closest('[role="dialog"]'))
        ?.querySelector<HTMLElement>('.folder-collapsed-tile');
      if (tile) tile.focus();
      else focusFolderControl(folder.id);
    });
  }
  /** An inset box's minimise is only "minimise": a press on it never drags the sub-folder or the open folder. */
  function noDrag(e: PointerEvent) {
    if (editing) e.stopPropagation();
  }
  /** An inset box's edit handle / double-click edits THAT sub-folder (M5 §7.6). */
  function editSub(e: Event | null, id: string) {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    openDialog({ kind: 'folder', id });
  }

  // Search reveal (M5 §3a.5): the folder holding the item flips to the item's page once it is shown.
  $effect(() => {
    const r = $pageReveal;
    const id = current.id;
    const perPage = paging.perPage;
    if (!r || minimised) return;
    untrack(() => {
      const taken = takePageReveal(dashboard.id, id);
      if (!taken) return;
      const idx = kids.findIndex((k) => (k as { id?: unknown } | null)?.id === taken.itemId);
      // Not here: the Dashboard's reveal reports it ("may have been moved or removed").
      if (idx >= 0) setFolderPage(dashboard.id, id, Math.floor(idx / perPage));
    });
  });
</script>

<!-- Every box's controls (Ruling 15): the top folder's bar and each inset box's bar draw the same
     minimise, last in the bar. `label` names the box ("Minimise <its name>", every box alike — I2), so
     no two folders' controls share a name. The top folder's controls carry a data- hook for
     focusFolderControl (never found by label). -->
{#snippet controls(label: string, title: string, onMinimise: (e: Event) => void, inset: boolean)}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <span class="folder-controls" ondblclick={own}>
    <button
      type="button"
      aria-label={label}
      {title}
      data-folder-minimise={inset ? undefined : folder.id}
      onclick={onMinimise}
      onpointerdown={inset ? noDrag : undefined}
    >
      <Icon icon="mdi:window-minimize" width="18" />
    </button>
    {#if showRestore && !inset}
      <button type="button" aria-label="Restore {boxName}" title="Restore {boxName}" data-folder-restore={folder.id} onclick={restore}>
        <Icon icon="mdi:restore" width="18" />
      </button>
    {/if}
  </span>
{/snippet}

<!-- Edit mode only: a look that can't be drawn as stored says so (M6 §3.9) — never a silent swap. -->
{#snippet lookNotes(f: FolderNode, cls: string)}
  {#if editing}
    {@const p = lookProblems(f)}
    {#if p.unknownShape !== null}
      <span class="look-note {cls}" role="status" data-shape-unknown={f.id} title="Pick a look in its dialog"
        >Unknown look “{p.unknownShape}” — drawn as Rounded</span
      >
    {/if}
    {#if p.unreadableColour}
      <span class="look-note {cls}" role="status" data-colour-unreadable={f.id}>Colour can't be read — theme colour shown</span>
    {/if}
  {/if}
{/snippet}

<!-- Edit mode: a box stored below its minimum says so, why, and fixes it in one undoable step. -->
{#snippet minNote()}
  {#if belowMin}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
    <div class="min-note" role="status" data-folder-below-min={folder.id}
      onclick={(e) => e.stopPropagation()} onpointerdown={(e) => e.stopPropagation()}>
      <span>Smaller than it can be drawn ({folder.placement?.w}×{folder.placement?.h}; needs at least {belowMin.w}×{belowMin.h})</span>
      <button type="button" data-folder-make-big-enough={folder.id}
        onclick={(e) => { e.stopPropagation(); makeFolderBigEnough(folder.id); }}>Make it big enough</button>
    </div>
  {/if}
{/snippet}

{#snippet pageArea()}
  {#if paging.tooSmall && levels === 0 && editing && screenExtraRows > 0 && !belowMin}
    <!-- M6 §13 (option A): edit mode draws the SAVED box so drag/drop geometry is exact; outside edit
         mode this screen draws it taller (screenGrowth). Said in place of its contents, never clipped. -->
    <p class="too-small taller-here" role="status" data-folder-too-small data-folder-taller-here={folder.id}>
      Taller on this screen — shown at its saved size while editing. Edit on a wider screen, or make it bigger.
    </p>
  {:else if paging.tooSmall && levels === 0}
    <!-- Never a silent clip (Important 2): a box below its minimum says so, and how to fix it. -->
    <p class="too-small" role="status" data-folder-too-small>
      Too small to show its contents — resize it{editing ? '' : ' in edit mode'}.
    </p>
  {/if}
  {#if paging.noRoom || (paging.tooSmall && levels === 0)}
    <!-- No room for this level's page (or a box below its minimum, noted above) (one item, or the page bar it needs): nothing is drawn clipped.
         The note is here when this box can hold it, else on the folder's own body. -->
    {#if paging.noRoomInside}
      <p class="too-small" role="status" data-folder-no-room>Not enough room — make the folder bigger.</p>
    {/if}
  {:else if kids.length === 0}
    <span class="empty-note open-empty">Empty folder</span>
  {:else}
    <div class="page" data-folder-page-content={current.id}>
      <ContainerView
        container={{ children: pageKids }}
        {metrics}
        {plan}
        {dashboard}
        {tab}
        folderChain={chainShown}
        {editing}
      />
    </div>
  {/if}
  {#if paging.pageBar && !paging.noRoom && !(paging.tooSmall && levels === 0)}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <nav class="page-bar" aria-label="{current.name} pages" ondblclick={own}>
      <button type="button" aria-label="First page" disabled={paging.page === 0} onclick={(e) => goPage(e, 0)}>«</button>
      <button
        type="button"
        aria-label="Previous page"
        data-page-bar="prev"
        class:holding={holdingKey === pageDwellKey(current.id, paging.page - 1)}
        disabled={paging.page === 0}
        onclick={(e) => goPage(e, paging.page - 1)}>‹</button
      >
      {#if pageNumbers.length > 0}
        {#each pageNumbers as n (n)}
          <button
            type="button"
            class="page-num"
            aria-label="Page {n + 1}"
            aria-current={n === paging.page ? 'page' : undefined}
            onclick={(e) => goPage(e, n)}>{n + 1}</button
          >
        {/each}
      {:else}
        <span class="page-of" aria-live="polite">Page {paging.page + 1} of {paging.pages}</span>
      {/if}
      <button
        type="button"
        aria-label="Next page"
        data-page-bar="next"
        class:holding={holdingKey === pageDwellKey(current.id, paging.page + 1)}
        disabled={paging.page >= paging.pages - 1}
        onclick={(e) => goPage(e, paging.page + 1)}>›</button
      >
      <button type="button" aria-label="Last page" disabled={paging.page >= paging.pages - 1} onclick={(e) => goPage(e, paging.pages - 1)}>»</button>
    </nav>
  {/if}
{/snippet}

<!-- One drilled level (M5 §7): sub-folder drilled[k - 1] as an inset box in the level above, with its
     own bar — the top folder's (Ruling 15): its name, its edit handle, the same minimise (back to its
     tile, up one level) — and its own colour; it holds the next level, or (the innermost) the page.
     Not an item: no data-node-id. -->
{#snippet level(k: number)}
  {@const sub = drilled[k - 1]}
  {@const up = k === 1 ? folder : drilled[k - 2]}
  {@const innermost = k === drilled.length}
  {@const untitled = sub.showTitle === false || !sub.name?.trim()}
  {@const shownName = untitled ? 'Untitled folder' : sub.name}
  {@const ownLook = !!sub.color || !!(sub.background && !sub.background.inherit && sub.background.type)}
  {@const subTabbed = hasTab(sub.shape)}
  {@const subTab = subTabbed ? nestedTab(sub, k) : null}
  {@const subPos = sub.tabPosition === 'centre' || sub.tabPosition === 'right' ? sub.tabPosition : 'left'}
  <!-- A tab shape's tab fills the level's tab allowance; a Rounded box keeps it as spare room in its
       body (one minimum for every shape, §3a.4) — never an empty band above the box (Ruling 1). -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="nested-box"
    class:tabbed={subTabbed}
    class:dragging={editing && ($drag?.ids.includes(sub.id) ?? false)}
    data-nested-folder={sub.id}
    style:color={lookText(sub)}
    ondblclick={editing ? (e) => editSub(e, sub.id) : undefined}
  >
    {#if subTabbed || ownLook}
      <FolderShape look={sub} variant="nested" dashboardId={dashboard.id} tabRect={subTab} />
    {/if}
    <!-- The bar IS the sub-folder (Ruling 14): it drags that sub-folder and its menu is the sub-folder's.
         On a tab shape the name is on its tab (part of the bar), the controls at the bar's right. -->
    <div
      class="nested-header"
      class:holding={!subTabbed && !innermost && holdingKey === crumbDwellKey(folder.id, sub.id)}
      data-crumb={subTabbed || innermost ? undefined : sub.id}
      data-folder-bar={innermost ? sub.id : undefined}
      oncontextmenu={editing ? (e) => subMenu(e, sub.id) : undefined}
      use:dragSource={{
        id: sub.id,
        enabled: editing,
        onMenu: (x, y) => openMenu({ x, y, target: { kind: 'node', id: sub.id } }),
        measure: (x, y) => grabbedTile(x, y, up)
      }}
    >
      <!-- An untitled sub-folder still says what it is (muted), so an outer one can be clicked to go up. -->
      {#if subTabbed && subTab}
        <div
          class="shape-tab nested-tab"
          class:holding={!innermost && holdingKey === crumbDwellKey(folder.id, sub.id)}
          data-folder-tab={sub.id}
          data-tab-position={subPos}
          data-crumb={innermost ? undefined : sub.id}
          style:left="{subTab.leftPx}px"
          style:width="{subTab.widthPx}px"
        >
          {#if untitled}
            <!-- An untitled tab is small and empty; its name is still the controls' and the go-up's. -->
            {#if !innermost}
              <button type="button" class="title-button tab-fill" aria-label="Back to {shownName}" title="Back to {shownName}" onclick={(e) => goUp(e, k)} ondblclick={own}></button>
            {/if}
          {:else if innermost}
            <span class="tab-name" aria-current="page">{shownName}</span>
          {:else}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <button type="button" class="title-button tab-name" title="Back to {shownName}" onclick={(e) => goUp(e, k)} ondblclick={own}>{shownName}</button>
          {/if}
        </div>
        <span class="title-space"></span>
      {:else if innermost}
        <span class="nested-name" class:muted={untitled} aria-current="page">{shownName}</span>
      {:else}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <button
          type="button"
          class="title-button nested-name"
          class:muted={untitled}
          title="Back to {shownName}"
          onclick={(e) => goUp(e, k)}
          ondblclick={own}>{shownName}</button
        >
      {/if}
      {@render lookNotes(sub, 'bar-note')}
      {#if editing}
        <span class="handle-slot">
          <EditHandle name={sub.name} onEdit={() => editSub(null, sub.id)} placement="inline" />
        </span>
      {/if}
      <BackgroundFailedBadge background={sub.background} {editing} level="folder" placement="inline" />
      {@render controls(`Minimise ${shownName}`, `Minimise ${shownName} (back to ${up.name?.trim() ? up.name : 'Untitled folder'})`, (e) => minimiseSub(e, k, sub.id), true)}
    </div>
    {#if innermost}
      <div class="nested-body" data-folder-id={current.id} data-folder-page={paging.page} data-folder-per-page={paging.perPage}>
        {@render pageArea()}
      </div>
    {:else}
      <div class="nested-body">
        {@render level(k + 1)}
      </div>
    {/if}
  </div>
{/snippet}

{#if minimised}
  <!-- The positioned wrapper carries the node id and placement; the tile (role=button) and
       the restore control are siblings, never nested. -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="folder-slot collapsed"
    class:selected
    class:editable={editing}
    class:dragging
    data-node-id={folder.id}
    {style}
    title={editing && !item ? COLLAPSED_HINT : undefined}
    oncontextmenu={editing ? menu : undefined}
    use:dragSource={{ id: folder.id, enabled: editing, onMenu: pressed }}
  >
    <div
      class="folder tile-face folder-collapsed-tile"
      class:tabbed
      class:silhouette
      style:padding-top={tabbed ? `${miniFrontPx + 2}px` : undefined}
      role="button"
      tabindex="0"
      aria-label={collapsedLabel}
      aria-pressed={editing ? selected : undefined}
      aria-describedby={editing && !item ? `resize-hint-${folder.id}` : undefined}
      style:color={textColor}
      onclick={onTileClick}
      ondblclick={editing
        ? (e) => {
            // Edit mode: double-click edits, like every item (§4B) — and cancels the click's open.
            e.stopPropagation();
            cancelPendingOpen();
            edit();
          }
        : undefined}
      onkeydown={onTileKey}
    >
      <!-- Its shape, compact (the first image, still, on its front); the name and icons on the front.
           The Small silhouette shows only the icons: the name stays its accessible name (§3a.6). -->
      <FolderShape
        look={folder}
        variant="minimised"
        dashboardId={dashboard.id}
        onSize={(mw, mh) => {
          tileW = mw;
          tileH = mh;
        }}
      />
      {#if !silhouette}<span class="collapsed-name">{folder.name}</span>{/if}
      {#if unreadable}
        <span class="empty-note unreadable">Can't display this folder's contents</span>
      {:else if previews.length === 0}
        <span class="empty-note">Empty folder</span>
      {:else}
        <div class="preview-grid" style:max-width={miniGridPx !== undefined ? `${miniGridPx}px` : undefined}>
          {#each previews as p (p.id)}
            <span class="preview-cell">
              {#if p.iconUrl}
                <img src={p.iconUrl} alt="" />
              {:else if p.icon}
                <ColoredIcon icon={p.icon} width="100%" />
              {:else}
                <ColoredIcon icon={p.kind === 'folder' ? 'mdi:folder' : 'mdi:application'} width="100%" />
              {/if}
            </span>
          {/each}
        </div>
      {/if}
    </div>
    <!-- Edit mode: a failed background image, flagged on a tab outside the tile (never on its content). -->
    <BackgroundFailedBadge background={folder.background} {editing} level="folder" placement="corner" />
    {@render minNote()}
    {#if editing && (problems.unknownShape !== null || problems.unreadableColour)}
      <span class="tile-notes">{@render lookNotes(folder, 'tile-note')}</span>
    {/if}
    {#if editing}
      {#if !item}
        <!-- The tooltip's hint, also for touch and screen readers (a minimised folder has no handles). -->
        <span id="resize-hint-{folder.id}" class="sr-only">{COLLAPSED_HINT}</span>
      {/if}
      <EditHandle name={folder.name} onEdit={edit} />
    {/if}
    {#if showRestore}
      <span class="tile-restore">
        <button type="button" class="restore-btn" aria-label="Restore {boxName}" title="Restore {boxName}" data-folder-restore={folder.id} onclick={restore}>
          <Icon icon="mdi:restore" width="18" />
        </button>
      </span>
    {/if}
  </div>
{:else}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
  <div
    class="folder open"
    class:tabbed
    class:selected
    class:editable={editing}
    class:dragging
    data-node-id={folder.id}
    role="group"
    aria-label="{folder.name} folder"
    {style}
    data-render-grown={!editing && screenExtraRows > 0 ? screenExtraRows : undefined}
    onclick={editing ? select : undefined}
    ondblclick={editing
      ? (e) => {
          e.stopPropagation();
          edit();
        }
      : undefined}
    oncontextmenu={editing ? menu : undefined}
    use:dragSource={{ id: folder.id, enabled: editing, onMenu: pressed }}
    style:--group-bg={folder.color || 'var(--bg-secondary)'}
    style:color={textColor}
  >
    <FolderShape look={folder} variant="open" dashboardId={dashboard.id} tabRect={topTab} />
    <!-- Every open folder has its bar (M5 §3a.7): an untitled one shows only its controls. Its title
         is never replaced (M5 §7): drilled in, the title (Rounded: the whole bar; a tab shape: its tab)
         is the go-up target and the name goes up. A tab shape's bar is its tab (the name) plus the
         body's controls row (the minimise control and edit handle at its top-right, §3a.2). -->
    <div
      class="folder-header"
      class:holding={!tabbed && levels > 0 && holdingKey === crumbDwellKey(folder.id, folder.id)}
      data-folder-bar={levels === 0 ? folder.id : undefined}
      data-crumb={!tabbed && levels > 0 ? folder.id : undefined}
    >
      {#if tabbed && topTab}
        <div
          class="shape-tab"
          class:holding={levels > 0 && holdingKey === crumbDwellKey(folder.id, folder.id)}
          data-folder-tab={folder.id}
          data-tab-position={tabPos}
          data-crumb={levels > 0 ? folder.id : undefined}
          style:left="{topTab.leftPx}px"
          style:width="{topTab.widthPx}px"
        >
          {#if showTitle}
            {#if folder.iconUrl}
              <img src={folder.iconUrl} alt="" class="tab-icon" />
            {:else if folder.icon}
              <Icon icon={folder.icon} width="16" class="tab-icon" />
            {/if}
            {#if levels > 0}
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <button type="button" class="title-button tab-name" title="Back to {folder.name}" onclick={(e) => goUp(e, 0)} ondblclick={own}>{folder.name}</button>
            {:else}
              <span class="tab-name">{folder.name}</span>
            {/if}
          {:else if levels > 0}
            <button type="button" class="title-button tab-fill" aria-label="Back to {boxName}" title="Back to {boxName}" onclick={(e) => goUp(e, 0)} ondblclick={own}></button>
          {/if}
        </div>
        <span class="title-space"></span>
      {:else if showTitle}
        {#if folder.iconUrl || folder.icon}
          <span class="folder-icon-backing" class:has-bg={folder.iconBgColor} style:background-color={folder.iconBgColor}>
            {#if folder.iconUrl}
              <img src={folder.iconUrl} alt="" class="folder-icon-img" />
            {:else if folder.icon}
              <Icon icon={folder.icon} width="24" />
            {/if}
          </span>
        {/if}
        <h3>
          {#if levels > 0}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <button type="button" class="title-button" title="Back to {folder.name}" onclick={(e) => goUp(e, 0)} ondblclick={own}
              >{folder.name}</button
            >
          {:else}
            {folder.name}
          {/if}
        </h3>
      {:else}
        <span class="title-space"></span>
      {/if}
      {@render lookNotes(folder, 'bar-note')}
      {#if editing}
        <!-- A zero-width slot at the end of the title: the handle hangs from it over the title's end
             (never over the failed-background warning, the controls or an inner item, and taking no
             layout space — §7.2). -->
        <span class="handle-slot">
          <EditHandle name={folder.name} onEdit={edit} placement="inline" />
        </span>
      {/if}
      <BackgroundFailedBadge background={folder.background} {editing} level="folder" placement="inline" />
      {@render controls(`Minimise ${boxName}`, editing ? `Minimise ${boxName} (sets how it starts)` : `Minimise ${boxName}`, minimise, false)}
    </div>
    <!-- data-drop-area: the whole body is a drop target for the folder shown (the innermost), not just
         its items' rows. -->
    {#if levels === 0}
      <div
        class="folder-body"
        data-drop-area={editing ? '' : undefined}
        data-folder-id={current.id}
        data-folder-page={paging.page}
        data-folder-per-page={paging.perPage}
      >
        {@render pageArea()}
      </div>
    {:else}
      <div class="folder-body" data-drop-area={editing ? '' : undefined} data-folder-id={current.id}>
        {@render level(1)}
        {#if paging.noRoom && !paging.noRoomInside}
          <!-- Never a silent clip (M5 §7.2): so deep that the inset bars themselves run out of room, the
               note is drawn over this folder's own body, where it is always seen. -->
          <p class="too-small" role="status" data-folder-no-room>Not enough room — make the folder bigger.</p>
        {/if}
      </div>
    {/if}
    {#if editing && plan.kind !== 'stacked' && folder.placement}
      <!-- Handles on the rendered (open) box on a tab; a minimised folder has none (Ruling 13). -->
      <ResizeHandles id={folder.id} name={folder.name} metrics={parent} />
    {/if}
    {@render minNote()}
  </div>
{/if}

<style>
  .folder {
    position: relative;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    isolation: isolate;
  }
  /* geometry.FOLDER_CHROME: a 40px bar, 8px body padding, 1px border; PAGE_BAR_PX: a 32px bar. */
  .folder-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 1rem;
    height: 40px;
    box-sizing: border-box;
    flex: none;
  }
  h3 {
    margin: 0;
    font-size: 1.25rem;
    font-weight: 600;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .title-space {
    flex: 1;
  }
  .folder-icon-img {
    width: 24px;
    height: 24px;
    object-fit: contain;
  }
  .folder-icon-backing {
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .folder-icon-backing.has-bg {
    padding: 0.3rem;
    border-radius: 0.35rem;
  }
  /* Drilled in, an outer title goes back up to its level (M5 §7): a plain-looking button. */
  .title-button {
    background: none;
    border: none;
    color: inherit;
    font: inherit;
    padding: 0;
    margin: 0;
    cursor: pointer;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: left;
  }
  .title-button:hover,
  .title-button:focus-visible {
    text-decoration: underline;
  }
  /* geometry.NESTED_CHROME: one inset box a drilled level — the 24px tab allowance (M6 §3a.4), a 1px
     border, a 28px bar, 8px body padding; it fills the body of the level above (M5 §7). Rounded: the
     M5 box, its tab allowance spare room at the bottom of its body (no band above it, Ruling 1); a tab
     shape: its tab fills the allowance (.tabbed). */
  .nested-box {
    position: relative;
    isolation: isolate;
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    border: 1px solid color-mix(in srgb, currentColor 45%, transparent);
    border-radius: 0.5rem;
  }
  /* The same bar as .folder-header (Ruling 15) — name, handle and minimise in the same places — only
     compact (28px, NESTED_CHROME.titlePx). */
  .nested-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    height: 28px;
    padding: 0 1rem;
    box-sizing: border-box;
    flex: none;
    min-width: 0;
  }
  /* M6 tab shapes (geometry.shapeInset): the shape is drawn by FolderShape, so no CSS border; the tab
     allowance (24px) plus the 1px edge on top, the 1px edge on the other sides — the same content
     inset as the drawn shape, and the same totals as FOLDER_CHROME / NESTED_CHROME. */
  .folder.open.tabbed,
  .nested-box.tabbed {
    border: none;
    border-radius: 0;
    padding: 25px 1px 1px;
  }
  .folder.tile-face.tabbed {
    border: none;
    border-radius: 0;
  }
  /* The keyboard focus ring is the shape's own silhouette (FolderShape's focus ring). */
  .folder.tile-face.tabbed:focus-visible {
    outline: none;
  }
  .folder.tile-face.silhouette .preview-grid {
    width: 70%;
  }
  /* The tab: the tab allowance high, at its rect (geometry.folderTabRect); the name is real text. */
  .shape-tab {
    position: absolute;
    top: 0;
    height: 24px;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0 0.6rem;
    min-width: 0;
    overflow: hidden;
    z-index: 1;
    font-size: 0.875rem;
    font-weight: 600;
    line-height: 24px;
  }
  .shape-tab.nested-tab {
    font-size: 0.8125rem;
  }
  .shape-tab.holding {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  .tab-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tab-fill {
    position: absolute;
    inset: 0;
  }
  .shape-tab :global(.tab-icon) {
    width: 16px;
    height: 16px;
    flex: none;
    object-fit: contain;
  }
  .look-note {
    flex: none;
    max-width: 60%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.6875rem;
    font-weight: 600;
    font-style: normal;
    line-height: 1.3;
    padding: 0.05rem 0.35rem;
    border-radius: 0.25rem;
    color: #fff;
    background: var(--warning-solid);
  }
  .min-note {
    position: absolute;
    top: 0.15rem;
    left: 0.15rem;
    right: 0.15rem;
    z-index: 5;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.2rem 0.35rem;
    padding: 0.15rem 0.35rem;
    border-radius: 0.25rem;
    font-size: 0.6875rem;
    font-weight: 600;
    line-height: 1.3;
    color: #fff;
    background: var(--warning-solid);
  }
  .min-note button {
    font: inherit;
    padding: 0.05rem 0.4rem;
    border-radius: 0.25rem;
    border: 1px solid rgba(255, 255, 255, 0.8);
    background: rgba(0, 0, 0, 0.25);
    color: inherit;
    cursor: pointer;
  }
  .tile-notes {
    position: absolute;
    left: 0.15rem;
    bottom: 0.15rem;
    right: 0.15rem;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.1rem;
    z-index: 3;
    pointer-events: none;
  }
  .tile-notes .look-note {
    max-width: 100%;
  }
  .nested-name.muted {
    font-weight: 400;
    font-style: italic;
    opacity: 0.7;
  }
  .nested-name {
    flex: 1;
    min-width: 0;
    font-size: 0.9375rem;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .nested-body {
    position: relative;
    padding: 0.5rem;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .folder-body {
    position: relative;
    padding: 0.5rem;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .too-small {
    position: absolute;
    inset: auto 0 0 0;
    z-index: 2;
    margin: 0;
    padding: 0.25rem 0.5rem;
    font-size: 0.75rem;
    font-weight: 600;
    line-height: 1.2;
    text-align: center;
    color: #fff;
    background: var(--danger-solid);
    pointer-events: none;
  }
  .page {
    flex: none;
  }
  .page-bar {
    margin-top: auto;
    height: 32px;
    box-sizing: border-box;
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.25rem;
  }
  .page-bar button {
    background: none;
    border: 1px solid transparent;
    color: inherit;
    font: inherit;
    min-width: 1.75rem;
    height: 1.75rem;
    padding: 0 0.35rem;
    border-radius: 0.375rem;
    cursor: pointer;
    opacity: 0.85;
  }
  .page-bar button:hover:not(:disabled),
  .page-bar button:focus-visible {
    opacity: 1;
    background: rgba(128, 128, 128, 0.25);
  }
  .page-bar button:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .page-bar button[aria-current='page'] {
    border-color: currentColor;
    font-weight: 600;
    opacity: 1;
  }
  /* A drag holding here: it goes up / turns the page once the hold ripens (OPEN_DWELL_MS). */
  .folder-header.holding,
  .nested-header.holding,
  .page-bar button.holding {
    opacity: 1;
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .page-of {
    font-size: 0.875rem;
    padding: 0 0.5rem;
  }
  .folder-controls {
    display: inline-flex;
    gap: 0.25rem;
    flex: none;
  }
  .folder-controls button,
  .restore-btn {
    background: none;
    border: none;
    color: inherit;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    width: 1.5rem;
    height: 1.5rem;
    padding: 0;
    border-radius: 0.25rem;
    opacity: 0.8;
  }
  .folder-controls button:hover,
  .folder-controls button:focus-visible,
  .restore-btn:hover,
  .restore-btn:focus-visible {
    opacity: 1;
    background: rgba(128, 128, 128, 0.25);
  }

  .tile-face {
    align-items: center;
    justify-content: center;
    gap: 0.25rem;
    padding: 0.5rem;
    cursor: pointer;
  }
  .preview-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 0.25rem;
    width: 60%;
    max-width: 64px;
    min-height: 0;
  }
  .preview-cell {
    display: flex;
    align-items: center;
    justify-content: center;
    aspect-ratio: 1;
    min-width: 0;
  }
  .preview-cell img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
  /* Edit-mode selection outline on the rendered box. */
  .folder.selected,
  .folder-slot.selected {
    outline: 3px solid var(--accent);
    outline-offset: 2px;
  }
  .folder.editable,
  .folder-slot.editable {
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
  }
  .folder.dragging,
  .folder-slot.dragging,
  .nested-box.dragging {
    opacity: 0.4;
  }
  .folder-slot {
    position: relative;
    /* Its own stacking context: the edit handle inside its corner stacks with the item (as a tile's). */
    isolation: isolate;
    display: flex;
    min-width: 0;
    min-height: 0;
  }
  .folder-slot > .tile-face {
    flex: 1;
    min-width: 0;
  }
  /* The edit handle: hung from a zero-width slot just left of the controls, centred in the bar.
     Shown like every handle — on the folder's hover or focus, only when no inner item is hovered /
     focused (EditHandle's own rule keys on its parent, here the slot). */
  .handle-slot {
    position: relative;
    flex: none;
    width: 0;
    align-self: stretch;
  }
  .handle-slot > :global(.edit-handle) {
    position: absolute;
    top: 50%;
    right: 0.25rem;
    transform: translateY(-50%);
    z-index: 4;
  }
  .folder:hover:not(:has([data-node-id]:hover, .nested-box:hover)) > .folder-header > .handle-slot > :global(.edit-handle),
  .folder:focus-within:not(:has([data-node-id]:focus-within, .nested-box:focus-within)) > .folder-header > .handle-slot > :global(.edit-handle),
  /* An inset box's own handle (M5 §7.6): on its hover or focus, never while a deeper box or an item is. */
  .nested-box:hover:not(:has([data-node-id]:hover, .nested-box:hover)) > .nested-header > .handle-slot > :global(.edit-handle),
  .nested-box:focus-within:not(:has([data-node-id]:focus-within, .nested-box:focus-within)) > .nested-header > .handle-slot > :global(.edit-handle) {
    opacity: 1;
    pointer-events: auto;
  }
  .tile-restore {
    position: absolute;
    top: 0.15rem;
    right: 0.15rem;
  }
  .empty-note {
    font-size: 0.75rem;
    color: var(--text-secondary);
  }
  .empty-note.open-empty {
    margin: auto;
    font-size: 0.875rem;
  }
  .empty-note.unreadable {
    color: var(--color-error, #dc2626);
    text-align: center;
  }
  .collapsed-name {
    font-weight: 600;
    text-align: center;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex-shrink: 0;
  }
</style>
