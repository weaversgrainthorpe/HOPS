// M5 Task 3: ONE Folder component draws every folder, everywhere — minimised (a tile of its size with
// its name and up to four icons), open (a box with a title bar, one page of items at its contents
// size, and a page bar only when there is more than one page) and drilled into a sub-folder (which
// fills the box, with a breadcrumb). No pop-over and no maximise.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { get } from 'svelte/store';
import TabCanvas from './TabCanvas.svelte';
import { config } from '$lib/stores/config';
import { editMode } from '$lib/stores/editMode';
import {
  folderViewFor, folderNavFor, setFolderView, setFolderPage, setFolderDrill, resetFolderViewsForTests
} from '$lib/stores/folderView';
import type { LayoutDashboard, LayoutTab } from '$lib/types/layout';
import { begin, session, resetEditSessionForTests } from '$lib/stores/editSession';
import { selectedNodes, clearSelection } from '$lib/stores/nodeSelection';
import { toast } from '$lib/stores/toast';

let width = 1440; // 60 px cells: a Medium item is 120 px
class FakeRO {
  cb: ResizeObserverCallback;
  constructor(cb: ResizeObserverCallback) { this.cb = cb; }
  observe(el: Element) {
    this.cb([{ target: el, contentRect: { width } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
  unobserve() {}
  disconnect() {}
}
const tile = (id: string, x = 0, y = 0): any => ({ kind: 'tile', id, name: id, url: 'http://x.test', icon: 'mdi:home', openMode: 'newtab', size: 'medium', order: 0, placement: { x, y, w: 2, h: 2 } });
const kid = (id: string, extra: any = {}): any => ({ kind: 'tile', id, name: id, url: 'http://x.test', icon: 'mdi:home', openMode: 'newtab', size: 'medium', order: 0, ...extra });
const kids = (n: number, prefix = 'k') => Array.from({ length: n }, (_, i) => kid(`${prefix}${i + 1}`));
const sub = (id: string, children: any[], extra: any = {}): any => ({
  kind: 'folder', id, name: id, display: 'expanded', size: 'medium', contentSize: 'medium', content: { children }, ...extra
});
/** A 12 x 6 open folder at 60 px cells: content 702 x 302 px → 5 Medium items a row, 2 rows (10 a page). */
const folder = (id: string, children: any[], extra: any = {}): any => ({
  kind: 'folder', id, name: id, display: 'expanded', size: 'medium', contentSize: 'medium',
  placement: { x: 0, y: 0, w: 12, h: 6 }, content: { children }, ...extra
});
function mk(children: any[]): { dash: LayoutDashboard; tab: LayoutTab } {
  const tab: LayoutTab = { id: 't1', name: 'Main', root: { columns: 24, children } };
  return { dash: { id: 'd1', name: 'Home', path: '/home', revision: 1, tabs: [tab] }, tab };
}
async function renderTab(children: any[]) {
  const { dash, tab } = mk(children);
  config.set({ schemaVersion: 3, layoutVersion: 1, dashboards: [dash] } as any);
  const r = render(TabCanvas, { dashboard: dash, tab });
  await tick();
  return { ...r, dash, tab };
}
async function renderEditing(children: any[]) {
  const { dash } = mk(children);
  config.set({ schemaVersion: 3, layoutVersion: 1, dashboards: [dash] } as any);
  begin('d1');
  editMode.set(true);
  const d = get(session)!.draft;
  const r = render(TabCanvas, { dashboard: d, tab: d.tabs[0], editing: true });
  await tick();
  return r;
}
const el = (c: ParentNode, id: string) => c.querySelector(`[data-node-id="${id}"]`) as HTMLElement;
const page = (c: ParentNode) => c.querySelector('[data-folder-page]') as HTMLElement;
const shownIds = (c: ParentNode) =>
  Array.from(page(c).querySelectorAll('[data-container-id] > [data-node-id]')).map((e) => e.getAttribute('data-node-id'));

beforeEach(() => {
  width = 1440;
  localStorage.clear();
  resetFolderViewsForTests();
  editMode.set(false);
  resetEditSessionForTests();
  clearSelection();
  vi.stubGlobal('ResizeObserver', FakeRO);
});
afterEach(() => { vi.unstubAllGlobals(); config.set(null); editMode.set(false); });

describe('minimised: a tile of its size with its name and up to four icons', () => {
  const min = (children: any[], extra: any = {}) => folder('f', children, { display: 'collapsed', ...extra });
  it('shows the name and four icons for six children', async () => {
    const { container } = await renderTab([min(kids(6))]);
    const t = el(container, 'f').querySelector('.folder-collapsed-tile') as HTMLElement;
    expect(within(t).getByText('f')).toBeInTheDocument();
    expect(t.querySelectorAll('.preview-cell')).toHaveLength(4);
  });
  it('the name is above the icons (as on every tile)', async () => {
    const { container } = await renderTab([min(kids(2))]);
    const t = el(container, 'f').querySelector('.folder-collapsed-tile') as HTMLElement;
    const name = t.querySelector('.collapsed-name')!;
    const grid = t.querySelector('.preview-grid')!;
    expect(name.compareDocumentPosition(grid) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
  it('"Empty folder" for no children; a folder whose children cannot be drawn says so instead', async () => {
    const { container, unmount } = await renderTab([min([])]);
    expect(within(el(container, 'f')).getByText('Empty folder')).toBeInTheDocument();
    unmount();
    const r = await renderTab([min([{ bad: true }])]);
    expect(within(el(r.container, 'f')).getByText(/Can't display this folder's contents/)).toBeInTheDocument();
  });
  it('is a button named for the folder and its item count; no pop-over (aria-haspopup) any more', async () => {
    await renderTab([min(kids(3))]);
    const b = screen.getByRole('button', { name: 'f, folder with 3 items' });
    expect(b.hasAttribute('aria-haspopup')).toBe(false);
  });
  it('on a tab it is its own size at the top-left of the space it keeps (Large: 4 x 4)', async () => {
    const { container } = await renderTab([min(kids(1), { size: 'large' })]);
    expect(el(container, 'f').style.gridColumn).toBe('1 / span 4');
    expect(el(container, 'f').style.gridRow).toBe('1 / span 4');
  });
});

describe('opening in place: click, Enter and the restore control; neighbours never move', () => {
  it('a click opens it in place into the space it kept; the neighbour is unmoved; this browser remembers', async () => {
    const { container } = await renderTab([folder('f', kids(3), { display: 'collapsed' }), tile('n', 14, 0)]);
    const before = el(container, 'n').getAttribute('style');
    expect(el(container, 'f').style.gridColumn).toBe('1 / span 2');
    await fireEvent.click(screen.getByRole('button', { name: /^f, folder with/ }));
    expect(el(container, 'f').style.gridColumn).toBe('1 / span 12');
    expect(el(container, 'f').style.gridRow).toBe('1 / span 6');
    expect(el(container, 'n').getAttribute('style')).toBe(before);
    expect(get(folderViewFor('d1'))).toEqual({ f: 'expanded' });
    expect(document.querySelector('[role="dialog"]')).toBeNull(); // nothing pops over
  });
  it('Enter (and Space) open it in place too', async () => {
    const { container } = await renderTab([folder('f', kids(3), { display: 'collapsed' })]);
    await fireEvent.keyDown(screen.getByRole('button', { name: /^f, folder with/ }), { key: 'Enter' });
    expect(el(container, 'f').style.gridColumn).toBe('1 / span 12');
  });
  it('the title bar has Minimise (no Maximise); minimising is remembered; Restore brings the saved default back', async () => {
    const { container } = await renderTab([folder('f', kids(3)), tile('n', 14, 0)]);
    expect(screen.queryByRole('button', { name: 'Maximise folder' })).toBeNull();
    const before = el(container, 'n').getAttribute('style');
    await fireEvent.click(screen.getByRole('button', { name: 'Minimise folder' }));
    expect(el(container, 'f').classList.contains('collapsed')).toBe(true);
    expect(el(container, 'f').style.gridColumn).toBe('1 / span 2');
    expect(el(container, 'n').getAttribute('style')).toBe(before);
    expect(JSON.parse(localStorage.getItem('hops.folderView.d1')!)).toEqual({ f: 'collapsed' });
    await fireEvent.click(screen.getByRole('button', { name: 'Restore folder' }));
    expect(el(container, 'f').style.gridColumn).toBe('1 / span 12');
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Minimise folder');
  });
  it('a remembered "maximised" (an older build) draws open in place', async () => {
    localStorage.setItem('hops.folderView.d1', JSON.stringify({ f: 'maximised' }));
    const { container } = await renderTab([folder('f', kids(1), { display: 'collapsed' })]);
    expect(el(container, 'f').style.gridColumn).toBe('1 / span 12');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});

describe('pages: only the current page renders', () => {
  it('everything fits: one page, no page bar', async () => {
    const { container } = await renderTab([folder('f', kids(10))]);
    expect(shownIds(container)).toHaveLength(10);
    expect(container.querySelector('[data-page-bar]')).toBeNull();
    expect(page(container).getAttribute('data-folder-id')).toBe('f');
    expect(page(container).getAttribute('data-folder-page')).toBe('0');
  });
  it('overfull: a page bar; page 1 holds what fits, › shows the rest, and this browser remembers the page', async () => {
    const { container } = await renderTab([folder('f', kids(12))]);
    // The bar takes 32 px: 302 - 32 = 270 → still 2 rows of 5 = 10 a page.
    expect(shownIds(container)).toEqual(kids(10).map((k) => k.id));
    expect(container.querySelector('[data-node-id="k11"]')).toBeNull();
    const next = container.querySelector('[data-page-bar="next"]') as HTMLButtonElement;
    const prev = container.querySelector('[data-page-bar="prev"]') as HTMLButtonElement;
    expect(prev.disabled).toBe(true);
    await fireEvent.click(next);
    expect(shownIds(container)).toEqual(['k11', 'k12']);
    expect(page(container).getAttribute('data-folder-page')).toBe('1');
    expect(get(folderNavFor('d1')).page).toEqual({ f: 1 });
    expect((container.querySelector('[data-page-bar="next"]') as HTMLButtonElement).disabled).toBe(true);
    await fireEvent.click(container.querySelector('[data-page-bar="prev"]')!);
    expect(shownIds(container)).toHaveLength(10);
  });
  it('the page bar names each page; the current one is marked', async () => {
    const { container } = await renderTab([folder('f', kids(25))]);
    const bar = container.querySelector('nav.page-bar') as HTMLElement;
    expect(bar.getAttribute('aria-label')).toBe('f pages');
    await fireEvent.click(within(bar).getByRole('button', { name: 'Page 3' }));
    expect(within(bar).getByRole('button', { name: 'Page 3' }).getAttribute('aria-current')).toBe('page');
    expect(shownIds(container)).toEqual(['k21', 'k22', 'k23', 'k24', 'k25']);
  });
  it('a remembered page past the end (items removed, folder resized) shows the last page', async () => {
    setFolderPage('d1', 'f', 7);
    const { container } = await renderTab([folder('f', kids(12))]);
    expect(shownIds(container)).toEqual(['k11', 'k12']);
  });
  it('a bigger box shows more per page (a 24 x 6 box holds all twelve)', async () => {
    const { container } = await renderTab([folder('f', kids(12), { placement: { x: 0, y: 0, w: 24, h: 6 } })]);
    expect(shownIds(container)).toHaveLength(12);
    expect(container.querySelector('[data-page-bar]')).toBeNull();
  });
  it('items are drawn at the contents size: a Small-contents folder lays out one-cell tracks', async () => {
    const { container } = await renderTab([folder('f', kids(3), { contentSize: 'small' })]);
    const flow = page(container).querySelector('[data-container-id="f"]') as HTMLElement;
    expect(flow.style.gridAutoRows).toBe('60px');
    expect(flow.style.gridTemplateColumns).toBe('repeat(11, 60px)'); // 702 px / 60 px
  });
  it('an empty open folder says "Empty folder"', async () => {
    const { container } = await renderTab([folder('f', [])]);
    expect(within(el(container, 'f')).getByText('Empty folder')).toBeInTheDocument();
  });
});

describe('drilling into a sub-folder: it fills the box, the title becomes a breadcrumb', () => {
  const tree = () => [folder('f', [kid('a'), sub('s', [kid('deep'), sub('s2', [kid('deeper')])], { display: 'expanded' })])];
  it('a sub-folder shows in the page as its minimised tile, whatever its saved display', async () => {
    const { container } = await renderTab(tree());
    expect(el(container, 's').classList.contains('collapsed')).toBe(true);
    expect(container.querySelector('[data-node-id="deep"]')).toBeNull();
  });
  it('a click drills in; the breadcrumb goes back up; this browser remembers the path', async () => {
    const { container } = await renderTab(tree());
    await fireEvent.click(screen.getByRole('button', { name: /^s, folder with/ }));
    expect(shownIds(container)).toEqual(['deep', 's2']);
    expect(page(container).getAttribute('data-folder-id')).toBe('s');
    expect(get(folderNavFor('d1')).drill).toEqual({ f: ['s'] });
    const crumbs = container.querySelector('nav.crumbs') as HTMLElement;
    expect(crumbs.getAttribute('aria-label')).toBe('Folder path');
    expect(within(crumbs).getByText('s').getAttribute('aria-current')).toBe('page');
    // deeper
    await fireEvent.click(screen.getByRole('button', { name: /^s2, folder with/ }));
    expect(shownIds(container)).toEqual(['deeper']);
    expect(get(folderNavFor('d1')).drill).toEqual({ f: ['s', 's2'] });
    // any crumb goes back up to that level
    await fireEvent.click(container.querySelector('[data-crumb="s"]')!);
    expect(shownIds(container)).toEqual(['deep', 's2']);
    await fireEvent.click(container.querySelector('[data-crumb="f"]')!);
    expect(shownIds(container)).toEqual(['a', 's']);
    expect(container.querySelector('nav.crumbs')).toBeNull();
    expect(get(folderNavFor('d1')).drill).toEqual({});
  });
  it('Enter drills in too; the box (and the neighbours) never change', async () => {
    const { container } = await renderTab([...tree(), tile('n', 14, 0)]);
    const before = [el(container, 'f').getAttribute('style'), el(container, 'n').getAttribute('style')];
    await fireEvent.keyDown(screen.getByRole('button', { name: /^s, folder with/ }), { key: 'Enter' });
    expect(shownIds(container)).toEqual(['deep', 's2']);
    expect([el(container, 'f').getAttribute('style'), el(container, 'n').getAttribute('style')]).toEqual(before);
  });
  it('the remembered path is restored on the next visit, and a stale one goes as far as it still holds', async () => {
    setFolderDrill('d1', 'f', ['s', 'gone']);
    const { container } = await renderTab(tree());
    expect(page(container).getAttribute('data-folder-id')).toBe('s');
  });
  it('each level remembers its own page', async () => {
    setFolderDrill('d1', 'f', ['s']);
    setFolderPage('d1', 's', 0);
    setFolderPage('d1', 'f', 1);
    const { container } = await renderTab([folder('f', [...kids(11), sub('s', kids(3, 'x'))])]);
    expect(shownIds(container)).toEqual(['x1', 'x2', 'x3']);
    await fireEvent.click(container.querySelector('[data-crumb="f"]')!);
    expect(shownIds(container)).toEqual(['k11', 's']); // f's own page 2
  });
  it('a sub-folder deleted elsewhere closes, saying so', async () => {
    setFolderDrill('d1', 'f', ['s']);
    const { container, rerender, dash } = await renderTab(tree());
    toast.clear();
    const gone = { ...dash, tabs: [{ ...dash.tabs[0], root: { columns: 24, children: [folder('f', [kid('a')])] } }] };
    config.set({ schemaVersion: 3, layoutVersion: 1, dashboards: [gone] } as any);
    await rerender({ dashboard: gone, tab: gone.tabs[0] });
    await tick();
    expect(shownIds(container)).toEqual(['a']);
    expect(get(toast).at(-1)?.message).toMatch(/A folder you had open was changed elsewhere and has been closed/);
  });
});

describe('untitled folders (showTitle: false): the bar shows only the controls, or the breadcrumb when drilled', () => {
  it('no name in the bar, but Minimise is there', async () => {
    const { container } = await renderTab([folder('f', [sub('s', [kid('deep')])], { showTitle: false, name: 'Hidden' })]);
    const bar = el(container, 'f').querySelector('.folder-header') as HTMLElement;
    expect(within(bar).queryByText('Hidden')).toBeNull();
    expect(within(bar).getByRole('button', { name: 'Minimise folder' })).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: /^s, folder with/ }));
    expect(within(bar).getByText('Hidden')).toBeInTheDocument(); // the root crumb
    expect(container.querySelector('[data-crumb="f"]')).not.toBeNull();
  });
  it('the shape is ignored: a "folder-tab" folder draws the same rounded box', async () => {
    const { container } = await renderTab([folder('f', kids(1), { shape: 'folder-tab' })]);
    expect(el(container, 'f').classList.contains('folder-style')).toBe(false);
  });
});

describe('edit mode looks the same (§7.2 WYSIWYG), plus handles', () => {
  it('the page bar and breadcrumb are the same; Minimise sets the draft\'s saved default (one undo step)', async () => {
    setFolderDrill('d1', 'f', ['s']);
    const { container } = await renderEditing([folder('f', [kid('a'), sub('s', kids(12, 'x'))])]);
    expect(page(container).getAttribute('data-folder-id')).toBe('s'); // drill-down works while editing
    expect(container.querySelector('[data-page-bar="next"]')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Edit f' })).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Minimise folder' }));
    const s = get(session)!;
    expect((s.draft.tabs[0].root.children[0] as any).display).toBe('collapsed');
    expect(s.undo).toHaveLength(1);
    expect(get(folderViewFor('d1'))).toEqual({});
    expect(get(selectedNodes).has('f')).toBe(false);
  });
  it('a click on a minimised folder selects it (it does not open); Enter opens it like the menu\'s Open', async () => {
    const { container } = await renderEditing([folder('f', kids(2), { display: 'collapsed' })]);
    const t = screen.getByRole('button', { name: /^f, folder with/ });
    await fireEvent.click(t);
    expect(get(selectedNodes).has('f')).toBe(true);
    expect(el(container, 'f').classList.contains('collapsed')).toBe(true);
    await fireEvent.keyDown(t, { key: 'Enter' });
    // The saved default (the draft the Dashboard re-renders from), one undo step.
    expect((get(session)!.draft.tabs[0].root.children[0] as any).display).toBe('expanded');
    expect(get(session)!.undo).toHaveLength(1);
  });
  it('remembered views are not applied while editing (the saved layout shows), so no Restore', async () => {
    setFolderView('d1', 'f', 'collapsed');
    const { container } = await renderEditing([folder('f', kids(2))]);
    expect(el(container, 'f').classList.contains('collapsed')).toBe(false);
    expect(screen.queryByRole('button', { name: 'Restore folder' })).toBeNull();
  });
});

describe('phone (stacked): the same component at full width', () => {
  it('an open folder spans the row and pages its items; a minimised one is a tile', async () => {
    width = 500;
    const { container } = await renderTab([folder('f', kids(30)), folder('m', kids(2), { display: 'collapsed', placement: { x: 0, y: 6, w: 6, h: 4 } })]);
    expect(el(container, 'f').getAttribute('style')).toContain('grid-column: 1 / -1');
    expect(container.querySelector('[data-node-id="f"] [data-page-bar="next"]')).not.toBeNull();
    expect(shownIds(container).length).toBeLessThan(30);
    expect(el(container, 'm').classList.contains('collapsed')).toBe(true);
    // Items are the phone tab tile's column wide (jsdom: a 1024 px window → 135 px minimum, 14 px gap):
    // the tab has 3 columns of (500 - 28) / 3 px; the folder (482 px inside) fits 2 of them.
    const flow = page(container).querySelector('[data-container-id="f"]') as HTMLElement;
    expect(flow.style.gridTemplateColumns).toBe('repeat(2, 157.33px)');
    expect(flow.style.gap).toBe('14px');
    // Unfitted, like a phone tab tile (its size's own minimum height).
    expect(flow.querySelector('button.entry')!.classList.contains('fill')).toBe(false);
  });
});

describe('the pop-over and maximise are gone', () => {
  it('no overlay, maximised panel or their stores remain', async () => {
    const mods = import.meta.glob('/src/lib/**/*.{ts,svelte}');
    for (const gone of ['FolderOverlay.svelte', 'MaximisedFolder.svelte', 'FolderView.svelte', 'FolderControls.svelte', 'stores/folderOverlay.ts']) {
      expect(Object.keys(mods).some((k) => k.endsWith(gone)), gone).toBe(false);
    }
  });
});

// M5 Task 4: the drag reads the folder's own targets from the DOM (hitTest), and holding a crumb
// or a page arrow during a drag shows which one is being held.
describe('drag targets on an open folder (M5 Task 4)', () => {
  it('its title bar names the folder it shows: itself, or the sub-folder drilled into', async () => {
    const { container } = await renderTab([folder('f', [kid('a'), sub('s', [kid('deep')])])]);
    expect(container.querySelector('.folder-header')!.getAttribute('data-folder-bar')).toBe('f');
    await fireEvent.click(screen.getByRole('button', { name: /^s, folder with/ }));
    expect(container.querySelector('.folder-header')!.getAttribute('data-folder-bar')).toBe('s');
  });
  it('a minimised folder has no title bar target', async () => {
    const { container } = await renderTab([folder('f', kids(2), { display: 'collapsed' })]);
    expect(container.querySelector('[data-folder-bar]')).toBeNull();
  });
});

// M5 final review, Important 2 (backstop): a box below its minimum — which the server refuses, so
// only reachable by a bug — says so visibly instead of clipping its item or page bar.
describe('an undersized open box is flagged, never clipped silently', () => {
  it('a 24 x 4 box at 1024 px with a full row: "too small" note', async () => {
    width = 1024; // cells of 42.7 px: content 106 px high, the page bar leaves 74 px < one 85 px item
    const { container } = await renderTab([folder('f', kids(12), { placement: { x: 0, y: 0, w: 24, h: 4 } })]);
    const note = el(container, 'f').querySelector('[data-folder-too-small]');
    expect(note).not.toBeNull();
    expect(note!.textContent).toMatch(/Too small to show its contents — resize it/);
  });
  it('the same folder at its minimum and more has no note', async () => {
    width = 1024;
    const { container } = await renderTab([folder('f', kids(12), { placement: { x: 0, y: 0, w: 24, h: 5 } })]);
    expect(el(container, 'f').querySelector('[data-folder-too-small]')).toBeNull();
  });
});
