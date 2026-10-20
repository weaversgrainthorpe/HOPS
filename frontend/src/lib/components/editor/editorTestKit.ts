// Shared fixtures for the editor component tests (not shipped: only *.test.ts import it).
import { get } from 'svelte/store';
import { config, layoutStale } from '$lib/stores/config';
import { begin, session, resetEditSessionForTests } from '$lib/stores/editSession';
import { clearSelection } from '$lib/stores/nodeSelection';
import { clearNodeClipboard } from '$lib/stores/nodeClipboard';
import { closeAll } from '$lib/stores/folderOverlay';
import { canvasStacked, editorDialog, editorMenu } from '$lib/editor/editorUi';
import { confirmModalState, closeConfirmModal } from '$lib/stores/confirmModal';
import { toast } from '$lib/stores/toast';
import type { Config } from '$lib/types';
import type { FolderNode, LayoutDashboard, LayoutNode, Placement } from '$lib/types/layout';

export const p = (x: number, y: number, w = 1, h = 1, z?: number): Placement =>
  z === undefined ? { x, y, w, h } : { x, y, w, h, z };
export const tile = (id: string, pl: Placement, extra: Record<string, unknown> = {}): LayoutNode =>
  ({
    kind: 'tile', id, name: id.toUpperCase(), url: 'http://x.test', icon: '', openMode: 'newtab', size: 'medium',
    order: 0, placement: pl, ...extra
  }) as unknown as LayoutNode;
export const folder = (id: string, pl: Placement, children: LayoutNode[], over: Partial<FolderNode> = {}): FolderNode => ({
  kind: 'folder', id, name: id.toUpperCase(), display: 'expanded', placement: pl, content: { columns: pl.w, children },
  ...over
});

/** d1: grid tab t1 (a, b, folder f1 [x], collapsed folder c1 [y]), free tab t2 (fa, fb). */
export function home(): LayoutDashboard {
  return {
    id: 'd1', name: 'Home', path: '/home', revision: 5,
    header: { centerTitle: 'Saved title' },
    tabs: [
      { id: 't1', name: 'Main', root: { columns: 12, children: [
        tile('a', p(0, 0)), tile('b', p(1, 0)),
        folder('f1', p(0, 1, 4, 3), [tile('x', p(0, 0))]),
        folder('c1', p(5, 1, 2, 2), [tile('y', p(0, 0))], { display: 'collapsed' })
      ] } },
      { id: 't2', name: 'Free', layout: 'free', designWidth: 1280, root: { columns: 160, children: [
        tile('fa', p(0, 0, 16, 16, 0)), tile('fb', p(20, 0, 16, 16, 1))
      ] } }
    ]
  };
}

export function other(): LayoutDashboard {
  return { id: 'o', name: 'Other', path: '/other', revision: 2, tabs: [
    { id: 'ot', name: 'OT', root: { columns: 12, children: [tile('o1', p(0, 0))] } }
  ] };
}

export function setLayout(dashes: LayoutDashboard[] = [home(), other()], extra: Partial<Config> = {}): void {
  config.set({
    dashboards: [], theme: { mode: 'auto' }, settings: {}, dashboardRevisions: {},
    layout: { schemaVersion: 3, dashboards: dashes }, v3OnlyDashboards: [], ...extra
  } as unknown as Config);
}

export function resetEditor(): void {
  if (get(confirmModalState).isOpen) closeConfirmModal(false);
  resetEditSessionForTests();
  layoutStale.set(false);
  clearSelection();
  clearNodeClipboard();
  closeAll();
  editorDialog.set(null);
  editorMenu.set(null);
  canvasStacked.set(false);
  toast.clear();
}

export function startSession(id = 'd1'): void {
  begin(id);
  if (get(session)?.dashboardId !== id) throw new Error('session did not start');
}

export const draft = (): LayoutDashboard => get(session)!.draft;

export function nodeIn(d: LayoutDashboard, id: string): LayoutNode | undefined {
  const walk = (c: LayoutNode[]): LayoutNode | undefined => {
    for (const n of c) {
      if (n.id === id) return n;
      if (n.kind === 'folder') {
        const r = walk(n.content.children);
        if (r) return r;
      }
    }
    return undefined;
  };
  for (const t of d.tabs) {
    const r = walk(t.root.children);
    if (r) return r;
  }
  return undefined;
}

/** Answer the open confirm dialog. */
export async function answerConfirm(ok: boolean): Promise<void> {
  for (let i = 0; i < 20 && !get(confirmModalState).isOpen; i++) await new Promise((r) => setTimeout(r, 0));
  closeConfirmModal(ok);
  await new Promise((r) => setTimeout(r, 0));
}

export class FakeRO {
  cb: ResizeObserverCallback;
  constructor(cb: ResizeObserverCallback) { this.cb = cb; }
  observe(el: Element) {
    this.cb([{ target: el, contentRect: { width: 1440 } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
  unobserve() {}
  disconnect() {}
}
