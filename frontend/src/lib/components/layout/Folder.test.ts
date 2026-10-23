// M5 Task 3: ONE Folder component draws every folder, everywhere — minimised (a tile of its size with
// its name and up to four icons), open (a box with a title bar, one page of items at its contents
// size, and a page bar only when there is more than one page) and drilled into a sub-folder (a folder
// inside a folder: an inset box a level, M5 §7). No pop-over and no maximise.
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
import { editorDialog, editorMenu } from '$lib/editor/editorUi';

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

// M5 §7 (walkthrough 2): a drilled-in sub-folder is a folder inside a folder — every level is an inset
// box inside the last, with its own title bar — identical to a top folder's (Ruling 15): its name on the
// left, the same minimise (–) on the right. The top folder's title stays its own. There is no ‹.
const nested = (c: ParentNode, id: string) => c.querySelector(`.nested-box[data-nested-folder="${id}"]`) as HTMLElement;
const barName = (c: ParentNode) => (c.querySelector('.folder-header h3, .folder-header .title-button') as HTMLElement | null)?.textContent?.trim();
describe('drilling into a sub-folder: a folder inside a folder, one inset box a level (M5 §7)', () => {
  const tree = () => [folder('f', [kid('a'), sub('s', [kid('deep'), sub('s2', [kid('deeper')])], { display: 'expanded' })])];
  it('a sub-folder shows in the page as its minimised tile, whatever its saved display', async () => {
    const { container } = await renderTab(tree());
    expect(el(container, 's').classList.contains('collapsed')).toBe(true);
    expect(container.querySelector('[data-node-id="deep"]')).toBeNull();
    expect(container.querySelector('.nested-box')).toBeNull();
  });
  it('a click drills in: the top title stays, the sub-folder is an inset box with its name and minimise holding the page', async () => {
    const { container } = await renderTab(tree());
    await fireEvent.click(screen.getByRole('button', { name: /^s, folder with/ }));
    expect(get(folderNavFor('d1')).drill).toEqual({ f: ['s'] });
    expect(container.querySelector('nav.crumbs')).toBeNull(); // no breadcrumb any more
    expect(barName(el(container, 'f'))).toBe('f'); // the top folder keeps its own title
    const box = nested(el(container, 'f'), 's');
    expect(box).not.toBeNull();
    expect(el(container, 'f').querySelector('.folder-body')!.contains(box)).toBe(true);
    const head = box.querySelector(':scope > .nested-header') as HTMLElement;
    // Ruling 15: the same controls as the top folder's bar, last in the bar; no ‹ back control.
    expect(within(head).queryByRole('button', { name: /^Back to/ })).toBeNull();
    expect(head.textContent).not.toContain('‹');
    expect(within(head).getByText('s')).toBeInTheDocument();
    const controls = head.lastElementChild as HTMLElement;
    expect(controls.classList.contains('folder-controls')).toBe(true);
    expect(within(controls).getByRole('button', { name: 'Minimise s' })).toBeInTheDocument();
    const top = el(container, 'f').querySelector('.folder-header') as HTMLElement;
    expect((top.lastElementChild as HTMLElement).classList.contains('folder-controls')).toBe(true);
    // The items sit inside the inset box.
    expect(box.contains(page(container))).toBe(true);
    expect(page(container).getAttribute('data-folder-id')).toBe('s');
    expect(shownIds(container)).toEqual(['deep', 's2']);
  });
  it('2 deep: three titled boxes, each inside the last; the page is in the innermost', async () => {
    setFolderDrill('d1', 'f', ['s', 's2']);
    const { container } = await renderTab(tree());
    const s = nested(el(container, 'f'), 's');
    const s2 = nested(s, 's2');
    expect(s2).not.toBeNull();
    expect(barName(el(container, 'f'))).toBe('f');
    expect((s.querySelector(':scope > .nested-header') as HTMLElement).textContent).toContain('s');
    expect((s2.querySelector(':scope > .nested-header') as HTMLElement).textContent).toContain('s2');
    expect(s2.contains(page(container))).toBe(true);
    expect(shownIds(container)).toEqual(['deeper']);
    expect(container.querySelectorAll('[data-folder-page]')).toHaveLength(1); // only the innermost page is drawn
  });
  it('minimise on an inset box goes up one level (back to its tile); an outer box\'s title goes back to that level; this browser remembers', async () => {
    setFolderDrill('d1', 'f', ['s', 's2']);
    const { container } = await renderTab(tree());
    await fireEvent.click(within(nested(container, 's2')).getByRole('button', { name: 'Minimise s2' }));
    expect(get(folderNavFor('d1')).drill).toEqual({ f: ['s'] });
    expect(nested(container, 's2')).toBeNull();
    expect(shownIds(container)).toEqual(['deep', 's2']);
    // Focus lands on its tile in the parent (the minimised box's control is gone).
    await tick();
    expect(document.activeElement).toBe(el(container, 's2').querySelector('.folder-collapsed-tile'));
    // Deeper again, then the TOP title goes all the way back.
    setFolderDrill('d1', 'f', ['s', 's2']);
    await tick();
    await fireEvent.click(nested(container, 's').querySelector(':scope > .nested-header .title-button')!);
    expect(get(folderNavFor('d1')).drill).toEqual({ f: ['s'] });
    setFolderDrill('d1', 'f', ['s', 's2']);
    await tick();
    await fireEvent.click(el(container, 'f').querySelector('.folder-header .title-button')!);
    expect(get(folderNavFor('d1')).drill).toEqual({});
    expect(container.querySelector('.nested-box')).toBeNull();
    expect(shownIds(container)).toEqual(['a', 's']);
  });
  it('the outer title bars are the go-up targets (data-crumb); the innermost bar is the folder shown (data-folder-bar)', async () => {
    setFolderDrill('d1', 'f', ['s', 's2']);
    const { container } = await renderTab(tree());
    const top = el(container, 'f').querySelector('.folder-header') as HTMLElement;
    expect(top.getAttribute('data-crumb')).toBe('f');
    expect(top.hasAttribute('data-folder-bar')).toBe(false);
    const sHead = nested(container, 's').querySelector(':scope > .nested-header') as HTMLElement;
    expect(sHead.getAttribute('data-crumb')).toBe('s');
    const s2Head = nested(container, 's2').querySelector(':scope > .nested-header') as HTMLElement;
    expect(s2Head.getAttribute('data-folder-bar')).toBe('s2');
    expect(s2Head.hasAttribute('data-crumb')).toBe(false);
    // Its minimise is the top folder's control: not a go-up target of its own (no data-crumb).
    expect(within(s2Head).getByRole('button', { name: 'Minimise s2' }).hasAttribute('data-crumb')).toBe(false);
    // No inset box is an item: the drag never takes it for a node.
    expect(container.querySelector('.nested-box[data-node-id]')).toBeNull();
  });
  it('an inset box shows its own colour', async () => {
    setFolderDrill('d1', 'f', ['s']);
    const { container } = await renderTab([folder('f', [sub('s', [kid('x')], { color: '#123456' })])]);
    expect(nested(container, 's').querySelector('.folder-surface, [style*="#123456"], [style*="rgb(18, 52, 86)"]')).not.toBeNull();
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
    expect(nested(container, 's')).not.toBeNull();
  });
  it('each level remembers its own page; the inset box pages in its own (smaller) box', async () => {
    setFolderDrill('d1', 'f', ['s']);
    setFolderPage('d1', 's', 1);
    setFolderPage('d1', 'f', 1);
    // f's content 702 x 302; s's box inside it 684 x 256 → 5 a row, 2 rows; 12 items → page bar → 1 row of 5.
    const { container } = await renderTab([folder('f', [...kids(11), sub('s', kids(12, 'x'))])]);
    expect(page(container).getAttribute('data-folder-per-page')).toBe('5');
    expect(shownIds(container)).toEqual(['x6', 'x7', 'x8', 'x9', 'x10']);
    expect(nested(container, 's').querySelector('[data-page-bar="next"]')).not.toBeNull();
    await fireEvent.click(el(container, 'f').querySelector('.folder-header .title-button')!);
    expect(shownIds(container)).toEqual(['k11', 's']); // f's own page 2
  });
  it('not enough room: a deep level in a small folder says so visibly, and draws no clipped items', async () => {
    setFolderDrill('d1', 'f', ['s', 's2']);
    // 4 x 4 at 60 px cells: content 222 x 182; s 204 x 136 (fits a 120 px item); s2 186 x 90 (does not).
    const { container } = await renderTab([folder('f', [sub('s', [sub('s2', [kid('deeper')])])], { placement: { x: 0, y: 0, w: 4, h: 4 } })]);
    const note = el(container, 'f').querySelector('[data-folder-no-room]') as HTMLElement;
    expect(note).not.toBeNull();
    expect(note.textContent).toMatch(/Not enough room — make the folder bigger/);
    expect(note.getAttribute('role')).toBe('status');
    expect(container.querySelector('[data-node-id="deeper"]')).toBeNull();
    // s2's body (90 + 16 px) holds the note: it is drawn inside the innermost box (review minor 3).
    expect(nested(container, 's2').querySelector(':scope > .nested-body > [data-folder-no-room]')).toBe(note);
    // One level up there is room: no note.
    await fireEvent.click(within(nested(container, 's2')).getByRole('button', { name: 'Minimise s2' }));
    expect(el(container, 'f').querySelector('[data-folder-no-room]')).toBeNull();
    expect(shownIds(container)).toEqual(['s2']);
  });
  it('room for one item but not for the page bar its items need: "Not enough room", nothing clipped (review Important 1)', async () => {
    setFolderDrill('d1', 'f', ['s']);
    // 4 x 4 at 60 px: s's box 204 x 136 holds one 120 px item, but 3 items need a page bar (136 - 32 < 120).
    const { container } = await renderTab([folder('f', [sub('s', kids(3, 'x'))], { placement: { x: 0, y: 0, w: 4, h: 4 } })]);
    expect(el(container, 'f').querySelector('[data-folder-no-room]')).not.toBeNull();
    expect(container.querySelector('[data-node-id="x1"]')).toBeNull();
    expect(container.querySelector('[data-page-bar]')).toBeNull();
  });
  it('so deep the inset bars run out of room: the note is on the folder\'s own body, always seen (review minor 4)', async () => {
    setFolderDrill('d1', 'f', ['a', 'b', 'c', 'd']);
    // 4 x 4 at 60 px: content 182 px high; four inset levels need 4 x 46 = 184 px of bars and padding.
    const deep = sub('a', [sub('b', [sub('c', [sub('d', [kid('z')])])])]);
    const { container } = await renderTab([folder('f', [deep], { placement: { x: 0, y: 0, w: 4, h: 4 } })]);
    const note = el(container, 'f').querySelector(':scope > .folder-body > [data-folder-no-room]');
    expect(note).not.toBeNull();
    expect(note!.textContent).toMatch(/Not enough room — make the folder bigger/);
    expect(el(container, 'f').querySelectorAll('[data-folder-no-room]')).toHaveLength(1);
  });
  it('an untitled sub-folder\'s inset bar says "Untitled folder" (muted), and an outer one goes up', async () => {
    setFolderDrill('d1', 'f', ['s', 's2']);
    const { container } = await renderTab([folder('f', [sub('s', [sub('s2', [kid('z')])], { showTitle: false })])]);
    const head = nested(container, 's').querySelector(':scope > .nested-header') as HTMLElement;
    const label = within(head).getByRole('button', { name: 'Untitled folder' });
    expect(label.classList.contains('muted')).toBe(true);
    await fireEvent.click(label);
    expect(get(folderNavFor('d1')).drill).toEqual({ f: ['s'] });
    const inner = nested(container, 's').querySelector(':scope > .nested-header') as HTMLElement;
    expect(within(inner).getByText('Untitled folder').classList.contains('muted')).toBe(true);
    // Its minimise is still a labelled button (Ruling 15).
    expect(within(inner).getByRole('button', { name: 'Minimise Untitled folder' })).toBeInTheDocument();
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

describe('untitled folders (showTitle: false): the bar shows only the controls, drilled in or not', () => {
  it('no name in the bar, but Minimise is there; drilled in, the sub-folder is an inset box', async () => {
    const { container } = await renderTab([folder('f', [sub('s', [kid('deep')])], { showTitle: false, name: 'Hidden' })]);
    const bar = el(container, 'f').querySelector('.folder-header') as HTMLElement;
    expect(within(bar).queryByText('Hidden')).toBeNull();
    expect(within(bar).getByRole('button', { name: 'Minimise folder' })).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: /^s, folder with/ }));
    expect(within(bar).queryByText('Hidden')).toBeNull(); // never a breadcrumb in its bar
    expect(bar.getAttribute('data-crumb')).toBe('f'); // still the drag's go-up target
    expect(within(nested(container, 's')).getByRole('button', { name: 'Minimise s' })).toBeInTheDocument();
  });
  it('the shape is ignored: a "folder-tab" folder draws the same rounded box', async () => {
    const { container } = await renderTab([folder('f', kids(1), { shape: 'folder-tab' })]);
    expect(el(container, 'f').classList.contains('folder-style')).toBe(false);
  });
});

describe('edit mode looks the same (§7.2 WYSIWYG), plus handles', () => {
  it('the page bar and nested boxes are the same; Minimise sets the draft\'s saved default (one undo step)', async () => {
    setFolderDrill('d1', 'f', ['s']);
    const { container } = await renderEditing([folder('f', [kid('a'), sub('s', kids(12, 'x'))])]);
    expect(page(container).getAttribute('data-folder-id')).toBe('s'); // drill-down works while editing
    expect(nested(container, 's').contains(page(container))).toBe(true);
    expect(container.querySelector('[data-page-bar="next"]')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Edit f' })).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Minimise folder' }));
    const s = get(session)!;
    expect((s.draft.tabs[0].root.children[0] as any).display).toBe('collapsed');
    expect(s.undo).toHaveLength(1);
    expect(get(folderViewFor('d1'))).toEqual({});
    expect(get(selectedNodes).has('f')).toBe(false);
  });
  it('right-click on an inset box\'s bar opens THAT sub-folder\'s menu (Ruling 14)', async () => {
    setFolderDrill('d1', 'f', ['s']);
    const { container } = await renderEditing([folder('f', [kid('a'), sub('s', kids(2, 'x'))])]);
    const head = nested(container, 's').querySelector(':scope > .nested-header') as HTMLElement;
    try {
      await fireEvent.contextMenu(head, { clientX: 50, clientY: 60 });
      expect(get(editorMenu)?.target).toEqual({ kind: 'node', id: 's' });
      // On the top folder's own bar it is still the top folder's.
      editorMenu.set(null);
      await fireEvent.contextMenu(el(container, 'f').querySelector('.folder-header')!, { clientX: 50, clientY: 20 });
      expect(get(editorMenu)?.target).toEqual({ kind: 'node', id: 'f' });
    } finally {
      editorMenu.set(null);
    }
  });
  it('each inset box has its own edit handle, which edits that sub-folder', async () => {
    setFolderDrill('d1', 'f', ['s']);
    const { container } = await renderEditing([folder('f', [kid('a'), sub('s', kids(2, 'x'))])]);
    const head = nested(container, 's').querySelector(':scope > .nested-header') as HTMLElement;
    try {
      await fireEvent.click(within(head).getByRole('button', { name: 'Edit s' }));
      expect(get(editorDialog)).toEqual({ kind: 'folder', id: 's' });
      expect(get(selectedNodes).has('f')).toBe(false); // the click is the handle's own
      // Its minimise in edit mode goes up (this browser's memory, never the draft), and never selects or edits.
      editorDialog.set(null);
      await fireEvent.click(within(head).getByRole('button', { name: 'Minimise s' }));
      expect(get(folderNavFor('d1')).drill).toEqual({});
      expect(get(editorDialog)).toBeNull();
      expect(get(selectedNodes).has('f')).toBe(false);
      expect(get(session)!.undo).toHaveLength(0);
    } finally {
      editorDialog.set(null);
    }
  });
  // Walkthrough 1 (M5 §3a.8): click, Enter and the menu's Open ALL open a minimised folder, in edit
  // mode too — the draft's saved default, one undo step. A double-click still only edits (§4B).
  const displayOf = () => (get(session)!.draft.tabs[0].root.children[0] as any).display;
  it('a click on a minimised folder opens it (the draft, one undo step) and selects it', async () => {
    vi.useFakeTimers();
    try {
      await renderEditing([folder('f', kids(2), { display: 'collapsed' })]);
      await fireEvent.click(screen.getByRole('button', { name: /^f, folder with/ }), { detail: 1 });
      expect(get(selectedNodes).has('f')).toBe(true);
      await vi.advanceTimersByTimeAsync(1000);
      expect(displayOf()).toBe('expanded');
      expect(get(session)!.undo).toHaveLength(1);
      expect(get(session)!.lastLabel).toBe('Open folder');
    } finally {
      vi.useRealTimers();
    }
  });
  it('Enter opens it like the menu\'s Open', async () => {
    await renderEditing([folder('f', kids(2), { display: 'collapsed' })]);
    await fireEvent.keyDown(screen.getByRole('button', { name: /^f, folder with/ }), { key: 'Enter' });
    expect(displayOf()).toBe('expanded');
    expect(get(session)!.undo).toHaveLength(1);
  });
  it('a double-click edits it and never also opens it', async () => {
    vi.useFakeTimers();
    try {
      await renderEditing([folder('f', kids(2), { display: 'collapsed' })]);
      const t = screen.getByRole('button', { name: /^f, folder with/ });
      await fireEvent.click(t, { detail: 1 });
      await fireEvent.click(t, { detail: 2 });
      await fireEvent.dblClick(t, { detail: 2 });
      expect(get(editorDialog)).toEqual({ kind: 'folder', id: 'f' });
      await vi.advanceTimersByTimeAsync(1000);
      expect(displayOf()).toBe('collapsed');
      expect(get(session)!.undo).toHaveLength(0);
    } finally {
      vi.useRealTimers();
      editorDialog.set(null);
    }
  });
  it('Ctrl+click only adds it to the selection (it does not open)', async () => {
    vi.useFakeTimers();
    try {
      await renderEditing([folder('f', kids(2), { display: 'collapsed' }), tile('t9', 20, 0)]);
      await fireEvent.click(screen.getByRole('button', { name: /^f, folder with/ }), { detail: 1, ctrlKey: true });
      await vi.advanceTimersByTimeAsync(1000);
      expect(get(selectedNodes).has('f')).toBe(true);
      expect(displayOf()).toBe('collapsed');
    } finally {
      vi.useRealTimers();
    }
  });
  it('a click on a sub-folder on a page drills into it (this browser\'s memory), without selecting it', async () => {
    vi.useFakeTimers();
    try {
      const { container } = await renderEditing([folder('f', [kid('a'), sub('s', kids(3, 'x'))])]);
      await fireEvent.click(screen.getByRole('button', { name: /^s, folder with/ }), { detail: 1 });
      await vi.advanceTimersByTimeAsync(1000);
      await tick();
      expect(page(container).getAttribute('data-folder-id')).toBe('s');
      expect(get(selectedNodes).has('s')).toBe(false);
      expect(get(session)!.undo).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
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
  it('the innermost title bar names the folder it shows: itself, or the sub-folder drilled into', async () => {
    const { container } = await renderTab([folder('f', [kid('a'), sub('s', [kid('deep')])])]);
    expect(container.querySelector('.folder-header')!.getAttribute('data-folder-bar')).toBe('f');
    await fireEvent.click(screen.getByRole('button', { name: /^s, folder with/ }));
    expect(container.querySelectorAll('[data-folder-bar]')).toHaveLength(1);
    expect(container.querySelector('.nested-header')!.getAttribute('data-folder-bar')).toBe('s');
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
