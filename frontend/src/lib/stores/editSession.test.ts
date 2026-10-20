import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { get } from 'svelte/store';
import { render, screen, fireEvent } from '@testing-library/svelte';

const { route } = vi.hoisted(() => ({ route: { v: null as unknown } }));
vi.mock('./config', async () => {
	const actual = await vi.importActual<typeof import('./config')>('./config');
	const { writable } = await import('svelte/store');
	route.v = writable<unknown>(undefined);
	return { ...actual, currentRoute: route.v };
});
vi.mock('$lib/utils/api', async () => ({
	...(await vi.importActual<object>('$lib/utils/api')),
	saveDashboardV3: vi.fn(),
	getConfig: vi.fn(),
	listSettings: vi.fn(),
	getDashboardSettings: vi.fn(),
	logout: vi.fn()
}));

import * as api from '$lib/utils/api';
import { ConflictError } from '$lib/utils/api';
import { config, layoutStale, layoutDoc, saveConflict } from './config';
import { isAuthenticated, logout } from './auth';
import { editMode, enableEditMode, disableEditMode } from './editMode';
import { initEditModeIdleWatcher } from './editModeIdleWatcher';
import { confirmModalState, closeConfirmModal } from './confirmModal';
import { toast } from './toast';
import {
	session, dirty, begin, apply, undo, redo, save, discard, end, sessionConflict,
	keepEditingAfterConflict, reloadAfterConflict, guardNavigation, guardUnload, parkedDraft,
	resetEditSessionForTests
} from './editSession';
import {
	TreeOpError, moveNodes, updateNode, resizeNode, addTab, reorderTabs, deleteNodes, insertNode,
	setZ, updateTab, mergeIntoNewFolder
} from '$lib/editor/treeOps';
import ConflictBanner from '$lib/components/ConflictBanner.svelte';
import ParkedDraftBanner from '$lib/components/ParkedDraftBanner.svelte';
import type { Config } from '$lib/types';
import type { LayoutDashboard, LayoutDoc, LayoutNode, Placement } from '$lib/types/layout';

const p = (x: number, y: number, w = 1, h = 1): Placement => ({ x, y, w, h });
const tile = (id: string, pl: Placement): LayoutNode =>
	({ kind: 'tile', id, name: id, url: 'http://x', placement: pl }) as unknown as LayoutNode;

function dash(): LayoutDashboard {
	return {
		id: 'd', name: 'D', path: '/d', revision: 7,
		tabs: [
			{
				id: 't1', name: 'One',
				root: {
					columns: 12,
					children: [
						tile('a', p(0, 0)), tile('b', p(3, 0)), tile('c', p(6, 2)),
						{ kind: 'folder', id: 'f1', name: 'F', display: 'expanded', placement: p(0, 4, 4, 3),
							content: { columns: 4, children: [tile('x', p(0, 0))] } }
					]
				}
			},
			{ id: 't2', name: 'Two', root: { columns: 12, children: [tile('z', p(5, 5))] } }
		]
	};
}
function doc(): LayoutDoc {
	return { schemaVersion: 3, dashboards: [dash(), { id: 'other', name: 'O', path: '/o', revision: 1, tabs: [] }] };
}
const draft = () => get(session)!.draft;
const setName = (n: string) => (d: LayoutDashboard) => updateNode(d, 'a', { name: n } as Partial<LayoutNode>);
const setRoute = (id: string | undefined) =>
	(route.v as import('svelte/store').Writable<unknown>).set(
		id ? { id } : undefined
	);
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(async () => {
	vi.clearAllMocks();
	if (get(confirmModalState).isOpen) closeConfirmModal(false);
	resetEditSessionForTests();
	saveConflict.set(null);
	layoutStale.set(false);
	toast.clear();
	config.set(doc());
	isAuthenticated.set(true);
	editMode.set(false);
	setRoute('d');
});
afterEach(() => {
	vi.useRealTimers();
});

describe('begin', () => {
	it('starts a session from the stored layout', () => {
		begin('d');
		const s = get(session)!;
		expect(s.dashboardId).toBe('d');
		expect(s.baseRevision).toBe(7);
		expect(s.saved).toEqual(dash());
		expect(s.draft).toEqual(dash());
		expect(s.undo).toEqual([]);
		expect(get(dirty)).toBe(false);
		expect(s.draft).toBe(s.saved); // shared until the first op (ops are pure)
	});

	it('reads the stored layout, never the per-browser folder view', () => {
		localStorage.setItem('hops.folderView.d', JSON.stringify({ f1: 'collapsed' }));
		begin('d');
		const f1 = draft().tabs[0].root.children.find((n) => n.id === 'f1')!;
		expect((f1 as { display: string }).display).toBe('expanded');
	});

	it('refuses with a visible error when the layout is stale', () => {
		const err = vi.spyOn(toast, 'error');
		layoutStale.set(true);
		begin('d');
		expect(get(session)).toBeNull();
		expect(err).toHaveBeenCalled();
	});

	it('refuses with a visible error when the layout or dashboard is missing', () => {
		const err = vi.spyOn(toast, 'error');
		begin('nope');
		expect(get(session)).toBeNull();
		config.set(null);
		begin('d');
		expect(get(session)).toBeNull();
		expect(err).toHaveBeenCalledTimes(2);
	});

	it('the session is independent of later store changes', () => {
		begin('d');
		const cfg = get(config)!;
		config.set({ ...cfg, dashboards: [{ ...dash(), name: 'changed' }] });
		expect(draft().name).toBe('D');
	});
});

describe('apply / undo / redo', () => {
	it('discard after many operations restores the saved dashboard and sends nothing', async () => {
		begin('d');
		const saved = structuredClone(get(session)!.saved);
		const allIds = new Set(['a', 'b', 'c', 'f1', 'x', 'z', 'd']);
		apply('move', (d) => moveNodes(d, ['b'], { tabId: 't1' }, [p(9, 0)]));
		apply('rename', setName('renamed'));
		apply('resize', (d) => resizeNode(d, 'c', 2, 2));
		apply('add tab', (d) => addTab(d, 'Three').dashboard);
		apply('reorder', (d) => reorderTabs(d, [d.tabs[2].id, 't1', 't2']));
		apply('into folder', (d) => moveNodes(d, ['a'], { tabId: 't1', folderId: 'f1' }, [p(1, 0)]));
		apply('merge', (d) => mergeIntoNewFolder(d, ['z'], 'c', allIds).dashboard);
		apply('paste', (d) => insertNode(d, tile('new', p(0, 0)), { tabId: 't2' }, p(0, 0)));
		apply('z', (d) => setZ(d, 'b', 'forward'));
		apply('tab name', (d) => updateTab(d, 't2', { name: 'Renamed' }));
		apply('delete', (d) => deleteNodes(d, ['x']));
		expect(get(dirty)).toBe(true);

		const confirmed = discard();
		expect(get(confirmModalState).isOpen).toBe(true);
		closeConfirmModal(true);
		expect(await confirmed).toBe(true);

		expect(draft()).toEqual(saved);
		expect(draft()).toEqual(dash());
		expect(get(dirty)).toBe(false);
		expect(get(session)!.undo).toEqual([]);
		expect(get(session)!.redo).toEqual([]);
		for (const fn of [api.saveDashboardV3, api.getConfig]) {
			expect(fn).not.toHaveBeenCalled();
		}
	});

	it('discard without confirming when asked, and a cancelled confirm keeps the draft', async () => {
		begin('d');
		apply('rename', setName('one'));
		const p1 = discard();
		closeConfirmModal(false);
		expect(await p1).toBe(false);
		expect(draft().tabs[0].root.children[0].name).toBe('one');
		expect(await discard({ confirm: false })).toBe(true);
		expect(get(dirty)).toBe(false);
	});

	it('undo and redo walk the history in order', () => {
		begin('d');
		apply('1', setName('one'));
		apply('2', setName('two'));
		apply('3', setName('three'));
		const nameA = () => draft().tabs[0].root.children.find((n) => n.id === 'a')!.name;
		expect(get(session)!.lastLabel).toBe('3');
		undo();
		expect(nameA()).toBe('two');
		undo();
		expect(nameA()).toBe('one');
		redo();
		expect(nameA()).toBe('two');
		redo();
		expect(nameA()).toBe('three');
		redo(); // nothing left: no-op
		expect(nameA()).toBe('three');
	});

	it('a new operation clears redo', () => {
		begin('d');
		apply('1', setName('one'));
		apply('2', setName('two'));
		undo();
		expect(get(session)!.redo.length).toBe(1);
		apply('3', setName('three'));
		expect(get(session)!.redo).toEqual([]);
	});

	it('keeps at most 100 undo steps', () => {
		begin('d');
		for (let i = 0; i < 120; i++) apply(`op${i}`, setName(`n${i}`));
		expect(get(session)!.undo.length).toBe(100);
		for (let i = 0; i < 150; i++) undo();
		// The oldest reachable state is the one after op19.
		expect(draft().tabs[0].root.children[0].name).toBe('n19');
	});

	it('dirty is false after undoing back to saved', () => {
		begin('d');
		apply('1', setName('one'));
		apply('2', (d) => resizeNode(d, 'c', 2, 2));
		expect(get(dirty)).toBe(true);
		undo();
		undo();
		expect(get(dirty)).toBe(false);
	});

	it('a TreeOpError leaves the draft unchanged and toasts', () => {
		const err = vi.spyOn(toast, 'error');
		begin('d');
		apply('1', setName('one'));
		const before = draft();
		apply('bad', () => { throw new TreeOpError('That space is taken'); });
		expect(draft()).toBe(before);
		expect(get(session)!.undo.length).toBe(1);
		expect(err).toHaveBeenCalledWith('That space is taken');
	});

	it('an unexpected error is also visible and leaves the draft unchanged', () => {
		const err = vi.spyOn(toast, 'error');
		vi.spyOn(console, 'error').mockImplementation(() => {});
		begin('d');
		const before = draft();
		apply('bad', () => { throw new Error('boom'); });
		expect(draft()).toBe(before);
		expect(err).toHaveBeenCalled();
	});

	it('apply without a session is refused visibly', () => {
		const err = vi.spyOn(toast, 'error');
		apply('x', setName('n'));
		expect(get(session)).toBeNull();
		expect(err).toHaveBeenCalled();
	});
});

describe('save', () => {
	it('save success updates the base revision and layout', async () => {
		begin('d');
		apply('1', setName('one'));
		const sent = draft();
		const fresh: LayoutDoc = { schemaVersion: 3, dashboards: [{ ...sent, revision: 8 }] };
		vi.mocked(api.saveDashboardV3).mockResolvedValue({ revision: 8, layout: fresh });
		// A follow-up GET refreshes only the notices (M4 Task 7); its document is never taken.
		vi.mocked(api.getConfig).mockResolvedValue({ schemaVersion: 3, dashboards: [{ ...sent, name: 'from GET', revision: 99 }] });
		expect(await save()).toBe('saved');
		expect(api.saveDashboardV3).toHaveBeenCalledWith('d', sent, 7);
		await new Promise((r) => setTimeout(r, 0));
		const s = get(session)!;
		expect(s.baseRevision).toBe(8);
		expect(get(dirty)).toBe(false);
		expect(s.saved.tabs).toEqual(sent.tabs);
		expect(get(layoutDoc)).toEqual(fresh);
	});

	it('a clean draft saves nothing', async () => {
		begin('d');
		expect(await save()).toBe('saved');
		expect(api.saveDashboardV3).not.toHaveBeenCalled();
	});

	it('a missing layout in the response marks the layout stale rather than trusting the old one', async () => {
		begin('d');
		apply('1', setName('one'));
		vi.mocked(api.saveDashboardV3).mockResolvedValue({ revision: 8 });
		vi.mocked(api.getConfig).mockReturnValue(new Promise(() => {}));
		expect(await save()).toBe('saved');
		expect(get(layoutStale)).toBe(true);
	});

	it('conflict keeps the draft and offers reload', async () => {
		begin('d');
		apply('1', setName('mine'));
		const mine = draft();
		vi.mocked(api.saveDashboardV3).mockRejectedValue(new ConflictError('d', 9));
		expect(await save()).toBe('conflict');
		expect(draft()).toBe(mine);
		expect(get(session)!.baseRevision).toBe(7);
		expect(get(dirty)).toBe(true);
		expect(get(sessionConflict)).toEqual({ dashboardId: 'd', currentRevision: 9 });

		render(ConflictBanner);
		expect(screen.getByRole('alert').textContent).toMatch(/changed somewhere else, so your changes were\s*not\s*saved/);
		await fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
		expect(get(sessionConflict)).toBeNull();
		expect(draft()).toBe(mine);
		expect(get(session)!.undo.length).toBe(1);
		expect(screen.queryByRole('alert')).toBeNull();

		// Saving again still refuses (never overwrites the other change).
		expect(await save()).toBe('conflict');
		expect(draft()).toBe(mine);
		await flush();
		const fresh: LayoutDoc = { schemaVersion: 3, dashboards: [{ ...dash(), revision: 9, name: 'theirs' }] };
		vi.mocked(api.getConfig).mockResolvedValue(fresh);
		await fireEvent.click(screen.getByRole('button', { name: 'Reload (lose my draft)' }));
		await vi.waitFor(() => expect(get(session)?.baseRevision).toBe(9));
		expect(api.getConfig).toHaveBeenCalled();
		expect(draft().name).toBe('theirs');
		expect(get(dirty)).toBe(false);
		expect(get(sessionConflict)).toBeNull();
	});

	it('reload ends the session and edit mode when the reload fails', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const err = vi.spyOn(toast, 'error');
		enableEditMode();
		apply('1', setName('mine'));
		vi.mocked(api.saveDashboardV3).mockRejectedValue(new ConflictError('d', 9));
		await save();
		vi.mocked(api.getConfig).mockRejectedValue(new Error('down'));
		await reloadAfterConflict();
		expect(get(session)).toBeNull();
		expect(get(editMode)).toBe(false);
		expect(err).toHaveBeenCalledWith(expect.stringContaining("Couldn't reload"));
	});

	it('reload turns edit mode off when the session cannot restart', async () => {
		enableEditMode();
		apply('1', setName('mine'));
		vi.mocked(api.saveDashboardV3).mockRejectedValue(new ConflictError('d', 9));
		await save();
		// The dashboard is gone from the reloaded layout.
		vi.mocked(api.getConfig).mockResolvedValue({ schemaVersion: 3, dashboards: [] });
		await reloadAfterConflict();
		expect(get(session)).toBeNull();
		expect(get(editMode)).toBe(false);
	});

	it('takes the saved dashboard from the server response when present', async () => {
		begin('d');
		apply('1', setName('one'));
		const normalised = { ...draft(), revision: 8, normalisedByServer: true };
		const fresh: LayoutDoc = { schemaVersion: 3, dashboards: [normalised] };
		vi.mocked(api.saveDashboardV3).mockResolvedValue({ revision: 8, layout: fresh });
		vi.mocked(api.getConfig).mockResolvedValue(fresh);
		expect(await save()).toBe('saved');
		expect(get(session)!.saved).toEqual(normalised);
		expect(draft()).toEqual(normalised);
		expect(get(dirty)).toBe(false);
	});

	it('keepEditingAfterConflict only hides the message', async () => {
		begin('d');
		apply('1', setName('mine'));
		vi.mocked(api.saveDashboardV3).mockRejectedValue(new ConflictError('d', 9));
		await save();
		const s = get(session);
		keepEditingAfterConflict();
		expect(get(session)).toBe(s);
	});

	it('other failures are visible and keep the draft', async () => {
		const err = vi.spyOn(toast, 'error');
		vi.spyOn(console, 'error').mockImplementation(() => {});
		begin('d');
		apply('1', setName('mine'));
		const mine = draft();
		vi.mocked(api.saveDashboardV3).mockRejectedValue(new Error('Invalid layout: too deep'));
		expect(await save()).toBe('error');
		expect(draft()).toBe(mine);
		expect(err).toHaveBeenCalledWith(expect.stringContaining('too deep'));
	});
});

describe('end and edit mode', () => {
	it('enableEditMode begins a session for the route dashboard; a clean end is silent', async () => {
		expect(enableEditMode()).toBe(true);
		expect(get(session)?.dashboardId).toBe('d');
		expect(await disableEditMode()).toBe(true);
		expect(get(editMode)).toBe(false);
		expect(get(session)).toBeNull();
		expect(get(confirmModalState).isOpen).toBe(false);
	});

	it('enableEditMode refuses when the session cannot begin', () => {
		layoutStale.set(true);
		expect(enableEditMode()).toBe(false);
		expect(get(editMode)).toBe(false);
	});

	it('turning edit mode off while dirty offers Save / Discard / Keep editing', async () => {
		enableEditMode();
		apply('1', setName('mine'));
		const off = disableEditMode();
		const st = get(confirmModalState);
		expect(st.isOpen).toBe(true);
		expect(st.options?.confirmText).toBe('Save');
		expect(st.options?.alternateText).toBe('Discard');
		expect(st.options?.cancelText).toBe('Keep editing');
		closeConfirmModal(false); // Keep editing
		expect(await off).toBe(false);
		expect(get(editMode)).toBe(true);
		expect(get(dirty)).toBe(true);

		const off2 = disableEditMode();
		closeConfirmModal('alternate'); // Discard
		expect(await off2).toBe(true);
		expect(get(editMode)).toBe(false);
		expect(get(session)).toBeNull();
		expect(api.saveDashboardV3).not.toHaveBeenCalled();
	});

	it('choosing Save ends only when the save succeeds', async () => {
		enableEditMode();
		apply('1', setName('mine'));
		vi.mocked(api.saveDashboardV3).mockRejectedValue(new ConflictError('d', 9));
		const off = end();
		closeConfirmModal(true);
		expect(await off).toBe(false);
		expect(get(session)).not.toBeNull();
		expect(get(dirty)).toBe(true);
	});

	it('guardNavigation asks when dirty; leaving anyway discards', async () => {
		begin('d');
		const clean = { willUnload: false, to: { url: new URL('http://localhost/o') }, cancel: vi.fn() };
		const go = vi.fn(async () => {});
		guardNavigation(clean, go);
		expect(clean.cancel).not.toHaveBeenCalled();

		apply('1', setName('mine'));
		const unload = { willUnload: true, to: null, cancel: vi.fn() };
		guardNavigation(unload, go);
		expect(unload.cancel).toHaveBeenCalled(); // native "leave site?" prompt

		const nav = { willUnload: false, to: { url: new URL('http://localhost/o') }, cancel: vi.fn() };
		guardNavigation(nav, go);
		expect(nav.cancel).toHaveBeenCalled();
		expect(get(confirmModalState).isOpen).toBe(true);
		closeConfirmModal(true);
		await vi.waitFor(() => expect(go).toHaveBeenCalledWith('/o'));
		expect(get(session)).toBeNull();
		expect(api.saveDashboardV3).not.toHaveBeenCalled();
	});

	it('guardNavigation: leaving on back/forward repeats the history step instead of pushing', async () => {
		begin('d');
		apply('1', setName('mine'));
		const go = vi.fn(async () => {});
		const hgo = vi.spyOn(window.history, 'go').mockImplementation(() => {});
		const nav = { willUnload: false, type: 'popstate', delta: -1, to: { url: new URL('http://localhost/o') }, cancel: vi.fn() };
		guardNavigation(nav, go);
		expect(nav.cancel).toHaveBeenCalled();
		closeConfirmModal(true);
		await vi.waitFor(() => expect(hgo).toHaveBeenCalledWith(-1));
		expect(go).not.toHaveBeenCalled();
		expect(get(session)).toBeNull();
	});

	it('guardNavigation: staying keeps the draft', async () => {
		begin('d');
		apply('1', setName('mine'));
		const go = vi.fn(async () => {});
		const nav = { willUnload: false, to: { url: new URL('http://localhost/o') }, cancel: vi.fn() };
		guardNavigation(nav, go);
		closeConfirmModal(false);
		await flush();
		expect(go).not.toHaveBeenCalled();
		expect(get(dirty)).toBe(true);
	});
});

describe('sign-out', () => {
	it('a 401 during save parks the draft; signing in and editing restores it', async () => {
		enableEditMode();
		apply('1', setName('mine'));
		apply('2', (d) => resizeNode(d, 'c', 2, 2));
		const mine = draft();
		const err = vi.spyOn(toast, 'error');
		vi.mocked(api.saveDashboardV3).mockImplementation(async () => {
			isAuthenticated.set(false); // what the session-expired handler does before the throw
			throw new Error('SESSION_EXPIRED');
		});
		expect(await save()).toBe('error');
		expect(get(editMode)).toBe(false);
		expect(get(session)).toBeNull();
		expect(get(parkedDraft)?.draft).toBe(mine);
		expect(err).toHaveBeenCalledWith(expect.stringContaining('sign in to save them'));

		render(ParkedDraftBanner);
		expect(screen.getByRole('alert').textContent).toMatch(/You were signed out — sign in to save your changes/);

		isAuthenticated.set(true);
		expect(get(parkedDraft)).not.toBeNull(); // kept until edit mode is entered
		expect(enableEditMode()).toBe(true);
		const s = get(session)!;
		expect(s.draft).toBe(mine);
		expect(s.baseRevision).toBe(7);
		expect(s.undo.length).toBe(2);
		expect(get(dirty)).toBe(true);
		expect(get(parkedDraft)).toBeNull();
		await flush();
		expect(screen.queryByRole('alert')).toBeNull();
	});

	it('the unload guard prompts while a draft is parked, and not when nothing is dirty or parked', () => {
		const evt = () => {
			const e = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
			const pd = vi.spyOn(e, 'preventDefault');
			return { e, pd };
		};
		// Nothing dirty or parked: no prompt.
		begin('d');
		const a = evt();
		guardUnload(a.e);
		expect(a.pd).not.toHaveBeenCalled();
		// Dirty live session: prompt.
		enableEditMode();
		apply('1', setName('mine'));
		const b = evt();
		guardUnload(b.e);
		expect(b.pd).toHaveBeenCalled();
		// Signed out: the draft is parked, the live session is gone, still prompt.
		isAuthenticated.set(false);
		expect(get(session)).toBeNull();
		expect(get(parkedDraft)).not.toBeNull();
		const c = evt();
		guardUnload(c.e);
		expect(c.pd).toHaveBeenCalled();
	});

	it('a clean session ends silently on sign-out', () => {
		enableEditMode();
		isAuthenticated.set(false);
		expect(get(session)).toBeNull();
		expect(get(parkedDraft)).toBeNull();
	});

	it('logout with unsaved changes asks first; Keep editing stays signed in', async () => {
		enableEditMode();
		apply('1', setName('mine'));
		const out = logout();
		await flush();
		const st = get(confirmModalState);
		expect(st.isOpen).toBe(true);
		expect(st.options?.alternateText).toBe('Discard');
		closeConfirmModal(false); // Keep editing
		expect(await out).toBe(false);
		expect(api.logout).not.toHaveBeenCalled();
		expect(get(isAuthenticated)).toBe(true);
		expect(get(editMode)).toBe(true);
		expect(get(dirty)).toBe(true);

		const out2 = logout();
		await flush();
		closeConfirmModal('alternate'); // Discard
		expect(await out2).toBe(true);
		expect(api.logout).toHaveBeenCalled();
		expect(get(isAuthenticated)).toBe(false);
		expect(get(parkedDraft)).toBeNull();
	});
});

describe('idle timeout', () => {
	it('an idle timeout with a dirty draft prompts and never discards', async () => {
		vi.useFakeTimers();
		vi.mocked(api.getDashboardSettings).mockResolvedValue({
			overrides: {}, revision: 1, effective: { editIdleTimeoutMinutes: 1 }
		} as never);
		initEditModeIdleWatcher();
		enableEditMode();
		apply('1', setName('mine'));
		await vi.advanceTimersByTimeAsync(61_000);
		const st = get(confirmModalState);
		expect(st.isOpen).toBe(true);
		expect(st.options?.alternateText).toBe('Discard');
		// Left alone for hours: still asking, nothing discarded.
		await vi.advanceTimersByTimeAsync(5 * 60 * 60 * 1000);
		expect(get(editMode)).toBe(true);
		expect(get(dirty)).toBe(true);
		expect(api.saveDashboardV3).not.toHaveBeenCalled();
		closeConfirmModal(false); // Keep editing
		await vi.advanceTimersByTimeAsync(0);
		expect(get(editMode)).toBe(true);
		expect(get(dirty)).toBe(true);

		// A clean draft ends silently as before.
		await discard({ confirm: false });
		await vi.advanceTimersByTimeAsync(61_000);
		expect(get(confirmModalState).isOpen).toBe(false);
		expect(get(editMode)).toBe(false);
		expect(get(session)).toBeNull();
	});
});

describe('final fix wave', () => {
	function deferred<T>() {
		let resolve!: (v: T) => void;
		let reject!: (e: unknown) => void;
		const promise = new Promise<T>((res, rej) => {
			resolve = res;
			reject = rej;
		});
		return { promise, resolve, reject };
	}

	it('Minor 1: a save of an unchanged-meanwhile draft keeps the SAME draft object', async () => {
		begin('d');
		apply('1', setName('one'));
		const sent = draft();
		const fresh: LayoutDoc = { schemaVersion: 3, dashboards: [clone({ ...sent, revision: 8 })] };
		vi.mocked(api.saveDashboardV3).mockResolvedValue({ revision: 8, layout: fresh });
		expect(await save()).toBe('saved');
		const s = get(session)!;
		expect(s.draft).toBe(sent);
		expect(s.saved).toBe(sent);
		expect(s.baseRevision).toBe(8);
		expect(s.draft.revision).toBe(8);
		expect(get(dirty)).toBe(false);
	});

	it('Minor 1: a server copy that differs from what was sent still replaces the draft', async () => {
		begin('d');
		apply('1', setName('one'));
		const sent = draft();
		const fresh: LayoutDoc = { schemaVersion: 3, dashboards: [{ ...clone(sent), revision: 8, name: 'normalised' }] };
		vi.mocked(api.saveDashboardV3).mockResolvedValue({ revision: 8, layout: fresh });
		await save();
		expect(draft()).not.toBe(sent);
		expect(draft().name).toBe('normalised');
	});

	it('Minor 2: leaving edit mode while a save is in flight waits for it; no Discard prompt after it saved', async () => {
		enableEditMode();
		apply('1', setName('mine'));
		const sent = draft();
		const d = deferred<{ revision: number; layout: LayoutDoc }>();
		vi.mocked(api.saveDashboardV3).mockReturnValue(d.promise);
		const saving = save();
		const off = disableEditMode();
		await flush();
		expect(get(confirmModalState).isOpen).toBe(false); // not asked while the save is unresolved
		d.resolve({ revision: 8, layout: { schemaVersion: 3, dashboards: [clone({ ...sent, revision: 8 })] } });
		await saving;
		expect(await off).toBe(true);
		expect(get(confirmModalState).isOpen).toBe(false);
		expect(get(session)).toBeNull();
		expect(get(toast).map((t) => t.message)).toContain('Changes saved');
	});

	it('Minor 2: Discard pressed while a save is in flight says the changes were already saved', async () => {
		begin('d');
		apply('1', setName('mine'));
		const sent = draft();
		const d = deferred<{ revision: number; layout: LayoutDoc }>();
		vi.mocked(api.saveDashboardV3).mockReturnValue(d.promise);
		const saving = save();
		const dropping = discard();
		await flush();
		expect(get(confirmModalState).isOpen).toBe(false);
		d.resolve({ revision: 8, layout: { schemaVersion: 3, dashboards: [clone({ ...sent, revision: 8 })] } });
		await saving;
		expect(await dropping).toBe(true);
		expect(get(toast).at(-1)?.message).toMatch(/already saved, so there was nothing to discard/);
		expect(draft().name).toBe('D'); // the saved state, not the pre-save one
		expect(nodeName('a')).toBe('mine');
		expect(get(dirty)).toBe(false);
	});

	it('Minor 2: Discard chosen in the leave prompt while a save started meanwhile reports it truthfully', async () => {
		enableEditMode();
		apply('1', setName('mine'));
		const sent = draft();
		const off = disableEditMode();
		await flush();
		expect(get(confirmModalState).isOpen).toBe(true);
		const d = deferred<{ revision: number; layout: LayoutDoc }>();
		vi.mocked(api.saveDashboardV3).mockReturnValue(d.promise);
		const saving = save(); // e.g. a keyboard shortcut reached Save
		closeConfirmModal('alternate');
		await flush();
		expect(get(session)).not.toBeNull(); // waits for the save
		d.resolve({ revision: 8, layout: { schemaVersion: 3, dashboards: [clone({ ...sent, revision: 8 })] } });
		await saving;
		expect(await off).toBe(true);
		expect(get(toast).at(-1)?.message).toMatch(/already saved/);
	});

	it('Minor 6: a newer layout revision rebases a CLEAN session, visibly', async () => {
		begin('d');
		const theirs = { ...dash(), revision: 9, name: 'theirs' };
		config.set({ schemaVersion: 3, dashboards: [theirs] } as unknown as Config);
		await flush();
		const s = get(session)!;
		expect(s.baseRevision).toBe(9);
		expect(s.draft.name).toBe('theirs');
		expect(s.saved).toBe(s.draft);
		expect(get(dirty)).toBe(false);
		expect(get(toast).at(-1)?.message).toMatch(/changed somewhere else/);
	});

	it('Minor 6: a dirty session is left alone (its save will conflict)', async () => {
		begin('d');
		apply('1', setName('mine'));
		const mine = draft();
		config.set({ schemaVersion: 3, dashboards: [{ ...dash(), revision: 9, name: 'theirs' }] } as unknown as Config);
		await flush();
		expect(draft()).toBe(mine);
		expect(get(session)!.baseRevision).toBe(7);
	});

	it('Minor 6: our own save does not trigger a rebase toast', async () => {
		begin('d');
		apply('1', setName('one'));
		const sent = draft();
		vi.mocked(api.saveDashboardV3).mockResolvedValue({
			revision: 8, layout: { schemaVersion: 3, dashboards: [clone({ ...sent, revision: 8 })] }
		});
		await save();
		await flush();
		expect(draft()).toBe(sent);
		expect(get(toast).map((t) => t.message).join('|')).not.toMatch(/changed somewhere else/);
	});
});

function clone<T>(v: T): T {
	return JSON.parse(JSON.stringify(v)) as T;
}
function nodeName(id: string): string | undefined {
	const n = draft().tabs[0].root.children.find((c) => c.id === id) as { name?: string } | undefined;
	return n?.name;
}
