import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get, writable } from 'svelte/store';
import { createRawSnippet } from 'svelte';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/svelte';

// The Settings shell (spec §4D + M5 §9): every settings page shares this layout. Logged out it
// asks for the password in place (the same LoginDialog as the pencil) on ANY settings address;
// signed in it shows the sidebar (Dashboards, Global settings, Discovery, Backups, Password,
// Factory reset, Log out) beside the page, with MigrationFailed / notices on top.
const nav = vi.hoisted(() => ({ after: [] as Array<(n: unknown) => void> }));
vi.mock('$app/navigation', () => ({
	goto: vi.fn(async () => {}),
	replaceState: vi.fn(),
	beforeNavigate: vi.fn(),
	afterNavigate: vi.fn((cb: (n: unknown) => void) => nav.after.push(cb))
}));
const route = vi.hoisted(() => ({ path: '/settings/dashboards' }));
vi.mock('$app/stores', async () => {
	const { writable: w } = await import('svelte/store');
	const page = w({ url: new URL(`http://localhost${route.path}`), params: {}, route: { id: route.path } });
	return { page, navigating: w(null), updated: w(false) };
});
vi.mock('$lib/utils/api', async () => ({
	...(await vi.importActual<object>('$lib/utils/api')),
	login: vi.fn(),
	logout: vi.fn(async () => {}),
	getConfig: vi.fn(() => new Promise(() => {})),
	listBackups: vi.fn(async () => ({ backups: [] })),
	getBackendVersion: vi.fn(async () => ({ version: 'test' }))
}));

import * as api from '$lib/utils/api';
import { goto } from '$app/navigation';
import { page } from '$app/stores';
import { toast } from '$lib/stores/toast';
import { isAuthenticated, authChecked, mustChangePassword, clearMustChangePassword } from '$lib/stores/auth';
import { config, migrationFailure } from '$lib/stores/config';
import { confirmModalState, closeConfirmModal } from '$lib/stores/confirmModal';
import { begin, apply, resetEditSessionForTests, dirty } from '$lib/stores/editSession';
import { updateNode } from '$lib/editor/treeOps';
import { globalNav, resetGlobalNavForTests } from '$lib/settings/globalNav';
import Layout from './+layout.svelte';
import type { Config } from '$lib/types';
import type { LayoutNode } from '$lib/types/layout';

const gotoMock = goto as unknown as ReturnType<typeof vi.fn>;
const apiLogin = api.login as unknown as ReturnType<typeof vi.fn>;
const flush = () => new Promise((r) => setTimeout(r, 0));
const pageStore = page as unknown as ReturnType<typeof writable>;

function at(path: string) {
	pageStore.set({ url: new URL(`http://localhost${path}`), params: {}, route: { id: path } });
}

// The page under the layout: a marker, so the tests can see when the layout shows it.
const child = createRawSnippet(() => ({ render: () => '<p data-testid="settings-child">the page</p>' }));
const renderShell = () => render(Layout, { props: { children: child } });
const childShown = () => screen.queryByTestId('settings-child') !== null;

function doc(extra: Partial<Config> = {}): Config {
	return {
		schemaVersion: 3,
		dashboards: [{
			id: 'd', name: 'D', path: '/d', revision: 1,
			tabs: [{ id: 't', name: 'T', root: { columns: 24, children: [
				{ kind: 'tile', id: 'a', name: 'a', url: 'http://x', placement: { x: 0, y: 0, w: 2, h: 2 } } as unknown as LayoutNode
			] } }]
		}],
		...extra
	} as Config;
}

async function signIn() {
	const dlg = screen.getByRole('dialog', { name: 'Sign in' });
	await fireEvent.input(within(dlg).getByLabelText('Username'), { target: { value: 'admin' } });
	await fireEvent.input(within(dlg).getByLabelText('Password'), { target: { value: 'pw' } });
	await fireEvent.click(within(dlg).getByRole('button', { name: 'Sign in' }));
}

const sidebar = () => screen.getByRole('navigation', { name: 'Settings sections' });

beforeEach(() => {
	vi.clearAllMocks();
	nav.after.length = 0;
	resetEditSessionForTests();
	at('/settings/dashboards');
	config.set(doc());
	migrationFailure.set(null);
	mustChangePassword.set(false);
	authChecked.set(true);
	isAuthenticated.set(true);
	resetGlobalNavForTests();
});

describe('settings shell, logged out', () => {
	beforeEach(() => isAuthenticated.set(false));

	it('opens the sign-in dialog in place; no redirect, no page, no sidebar', async () => {
		renderShell();
		expect(await screen.findByRole('dialog', { name: 'Sign in' })).toBeTruthy();
		expect(screen.getByRole('dialog', { name: 'Sign in' }).textContent).toContain('Sign in to open Settings.');
		await flush();
		expect(gotoMock).not.toHaveBeenCalled();
		expect(childShown()).toBe(false);
		expect(screen.queryByRole('navigation', { name: 'Settings sections' })).toBeNull();
	});

	it('a deep settings address asks in place too, and signing in shows that same page (no redirect)', async () => {
		at('/settings/backups');
		apiLogin.mockResolvedValue({ mustChangePassword: false });
		renderShell();
		await screen.findByRole('dialog', { name: 'Sign in' });
		await signIn();
		await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Sign in' })).toBeNull());
		await waitFor(() => expect(childShown()).toBe(true));
		expect(within(sidebar()).getByRole('link', { name: 'Backups' }).getAttribute('aria-current')).toBe('page');
		expect(gotoMock).not.toHaveBeenCalled();
	});

	it('Cancel with no previous page goes to /', async () => {
		renderShell();
		await fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
		expect(gotoMock).toHaveBeenCalledWith('/');
		expect(childShown()).toBe(false);
	});

	it('Cancel goes back to the page you came from', async () => {
		renderShell();
		for (const cb of nav.after) cb({ from: { url: new URL('http://localhost/d?x=1') }, to: { url: new URL('http://localhost/settings/dashboards') } });
		await fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
		expect(gotoMock).toHaveBeenCalledWith('/d?x=1');
	});

	it('Cancel after moving between settings pages still goes back to where you came from, not to a settings page', async () => {
		renderShell();
		for (const cb of nav.after) cb({ from: { url: new URL('http://localhost/d') }, to: { url: new URL('http://localhost/settings/dashboards') } });
		for (const cb of nav.after) cb({ from: { url: new URL('http://localhost/settings/dashboards') }, to: { url: new URL('http://localhost/settings/global') } });
		await fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
		expect(gotoMock).toHaveBeenCalledWith('/d');
	});

	it('Cancel after a redirect from an admin page goes to /, not back into the redirect (no loop)', async () => {
		renderShell();
		for (const cb of nav.after) cb({ from: { url: new URL('http://localhost/admin/discovery') }, to: { url: new URL('http://localhost/settings/dashboards') } });
		await fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
		expect(gotoMock).toHaveBeenCalledWith('/');
		expect(gotoMock).not.toHaveBeenCalledWith('/admin/discovery');
	});

	it('a failed migration, logged out: the notice says to sign in here (no link to this same page)', async () => {
		migrationFailure.set('could not migrate');
		renderShell();
		const notice = screen.getByRole('alert');
		expect(notice.textContent).toContain('Sign in, then open Backups on this page.');
		expect(within(notice).queryByRole('link')).toBeNull();
	});

	it('a sign-in that must change the password shows nothing until the password is changed', async () => {
		apiLogin.mockResolvedValue({ mustChangePassword: true });
		renderShell();
		await screen.findByRole('dialog', { name: 'Sign in' });
		await signIn();
		await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Sign in' })).toBeNull());
		await flush();
		expect(childShown()).toBe(false);
		clearMustChangePassword();
		await waitFor(() => expect(childShown()).toBe(true));
	});

	it('a failed migration is shown on top even before signing in', async () => {
		migrationFailure.set('could not migrate');
		renderShell();
		expect(screen.getByRole('heading', { name: /couldn't migrate your configuration/ })).toBeTruthy();
		expect(await screen.findByRole('dialog', { name: 'Sign in' })).toBeTruthy();
	});

	it('nothing is decided before the first auth check answers (no dialog, no page)', async () => {
		authChecked.set(false);
		renderShell();
		await flush();
		expect(screen.queryByRole('dialog', { name: 'Sign in' })).toBeNull();
		expect(childShown()).toBe(false);
		expect(screen.getByRole('status').textContent).toContain('Checking sign-in');
	});
});

describe('settings shell, signed in', () => {
	it('the sidebar lists the sections in order, with their own addresses (Discovery at /settings/discovery, M5 §11)', () => {
		renderShell();
		const items = within(sidebar()).getAllByRole('link').map((a) => [a.textContent?.trim(), a.getAttribute('href')]);
		expect(items).toEqual([
			['Dashboards', '/settings/dashboards'],
			['Global settings', '/settings/global'],
			['Discovery', '/settings/discovery'],
			['Backups', '/settings/backups'],
			['Password', '/settings/password'],
			['Factory reset', '/settings/reset']
		]);
		// Log out is the last item: an action, not a page.
		const buttons = within(sidebar()).getAllByRole('button');
		expect(buttons.map((b) => b.textContent?.trim())).toEqual(['Log out']);
		expect(childShown()).toBe(true);
		expect(screen.getByRole('heading', { name: 'Settings', level: 1 })).toBeTruthy();
	});

	it.each([
		['/settings/dashboards', 'Dashboards'],
		['/settings/global', 'Global settings'],
		['/settings/discovery', 'Discovery'],
		['/settings/discovery/new', 'Discovery'],
		['/settings/discovery/diagnostics', 'Discovery'],
		['/settings/discovery/detectors', 'Discovery'],
		['/settings/discovery/0123abcd', 'Discovery'],
		['/settings/backups', 'Backups'],
		['/settings/password', 'Password'],
		['/settings/reset', 'Factory reset']
	])('on %s the current item is %s (aria-current), and only that one', (path, label) => {
		at(path);
		renderShell();
		const current = within(sidebar()).getAllByRole('link').filter((a) => a.getAttribute('aria-current') === 'page');
		expect(current.map((a) => a.textContent?.trim())).toEqual([label]);
	});

	it('the current item follows navigation (back/forward re-renders the highlight)', async () => {
		renderShell();
		at('/settings/password');
		await flush();
		const current = within(sidebar()).getAllByRole('link').filter((a) => a.getAttribute('aria-current') === 'page');
		expect(current.map((a) => a.textContent?.trim())).toEqual(['Password']);
	});

	it('the server notices sit at the top, above the page', async () => {
		config.set(doc({ notices: [{ id: 'n1', text: 'Status checks now follow the most specific setting' }] } as Partial<Config>));
		renderShell();
		const notice = await screen.findByText(/Status checks now follow/);
		const pageEl = screen.getByTestId('settings-child');
		expect(notice.compareDocumentPosition(pageEl) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
	});

	it('a failed migration: MigrationFailed on top with Open Backups, which opens the backups dialog on any page', async () => {
		at('/settings/password');
		migrationFailure.set('could not migrate');
		config.set(null);
		renderShell();
		const notice = screen.getByRole('alert');
		expect(within(notice).getByRole('heading', { name: /couldn't migrate your configuration/ })).toBeTruthy();
		await fireEvent.click(within(notice).getByRole('button', { name: 'Open Backups' }));
		expect(await screen.findByRole('dialog', { name: /Backup/ })).toBeTruthy();
	});

	it('the session ending hides the page and closes the backups dialog; signing back in does not reopen it', async () => {
		migrationFailure.set('could not migrate');
		renderShell();
		await fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Open Backups' }));
		expect(await screen.findByRole('dialog', { name: /Backup/ })).toBeTruthy();
		isAuthenticated.set(false);
		await waitFor(() => expect(screen.queryByRole('dialog', { name: /Backup/ })).toBeNull());
		expect(await screen.findByRole('dialog', { name: 'Sign in' })).toBeTruthy();
		expect(childShown()).toBe(false);
		expect(screen.queryByRole('navigation', { name: 'Settings sections' })).toBeNull();
		isAuthenticated.set(true);
		await flush();
		expect(screen.queryByRole('dialog', { name: /Backup/ })).toBeNull();
		expect(childShown()).toBe(true);
	});

	it('Log out signs out and goes to /', async () => {
		renderShell();
		await fireEvent.click(within(sidebar()).getByRole('button', { name: 'Log out' }));
		await waitFor(() => expect(api.logout).toHaveBeenCalled());
		expect(get(isAuthenticated)).toBe(false);
		await waitFor(() => expect(gotoMock).toHaveBeenCalledWith('/'));
		expect(screen.queryByRole('dialog', { name: 'Sign in' })).toBeNull();
	});

	it('Log out with unsaved edit-session changes: Keep editing cancels it and the page stays signed in', async () => {
		begin('d');
		apply('rename', (d) => updateNode(d, 'a', { name: 'mine' } as Partial<LayoutNode>));
		renderShell();
		await fireEvent.click(within(sidebar()).getByRole('button', { name: 'Log out' }));
		await flush();
		expect(get(confirmModalState).isOpen).toBe(true);
		closeConfirmModal(false); // Keep editing
		await flush();
		expect(api.logout).not.toHaveBeenCalled();
		expect(get(isAuthenticated)).toBe(true);
		expect(get(dirty)).toBe(true);
		expect(gotoMock).not.toHaveBeenCalled();
		expect(within(sidebar()).getByRole('button', { name: 'Log out' })).toBeInTheDocument();
		expect(childShown()).toBe(true);
	});

	it('Log out hides the page and sidebar at once, while leaving (no signed-out admin shell)', async () => {
		gotoMock.mockImplementationOnce(() => new Promise(() => {}));
		renderShell();
		await fireEvent.click(within(sidebar()).getByRole('button', { name: 'Log out' }));
		await waitFor(() => expect(gotoMock).toHaveBeenCalledWith('/'));
		expect(get(isAuthenticated)).toBe(false);
		expect(childShown()).toBe(false);
		expect(screen.queryByRole('navigation', { name: 'Settings sections' })).toBeNull();
		expect(screen.queryByRole('dialog', { name: 'Sign in' })).toBeNull();
	});

	it('Log out whose navigation fails: the reason is shown and the page asks to sign in (never stuck)', async () => {
		const toastError = vi.spyOn(toast, 'error');
		gotoMock.mockImplementationOnce(async () => { throw new Error('navigation aborted'); });
		renderShell();
		await fireEvent.click(within(sidebar()).getByRole('button', { name: 'Log out' }));
		expect(await screen.findByRole('dialog', { name: 'Sign in' })).toBeTruthy();
		expect(childShown()).toBe(false);
		expect(toastError).toHaveBeenCalledWith(expect.stringContaining('navigation aborted'));
		toastError.mockRestore();
	});
});

// M6 §10: Global settings' groups are a sub-list under "Global settings", only while on that page.
describe('settings shell, Global settings groups', () => {
	const groups = [
		{ id: 'server', label: 'Server' },
		{ id: 'look-motion', label: 'Look & motion' }
	];
	const subList = () => screen.queryByRole('list', { name: 'Global settings groups' });

	it('on Global settings the groups are listed under it, linking to their sections', async () => {
		at('/settings/global');
		globalNav.set({ groups, active: 'look-motion' });
		renderShell();
		const list = subList()!;
		expect(list).toBeTruthy();
		expect(list.closest('li')!.querySelector('a.side-item')!.textContent?.trim()).toBe('Global settings');
		const links = within(list).getAllByRole('link');
		expect(links.map((a) => [a.textContent?.trim(), a.getAttribute('href')])).toEqual([
			['Server', '/settings/global#server'],
			['Look & motion', '/settings/global#look-motion']
		]);
		expect(links.map((a) => a.getAttribute('aria-current'))).toEqual([null, 'location']);
		globalNav.update((s) => ({ ...s, active: 'server' }));
		await flush();
		expect(links.map((a) => a.getAttribute('aria-current'))).toEqual(['location', null]);
	});

	it('on any other settings page there is no sub-list', () => {
		at('/settings/dashboards');
		globalNav.set({ groups, active: 'look-motion' });
		renderShell();
		expect(subList()).toBeNull();
	});

	it('a group link moves to its section: highlighted, heading focused, address hash updated', async () => {
		at('/settings/global');
		globalNav.set({ groups, active: 'look-motion' });
		renderShell();
		const section = document.createElement('section');
		section.id = 'server';
		section.innerHTML = '<h3 tabindex="-1" data-group-heading>Server</h3>';
		document.body.appendChild(section);
		try {
			await fireEvent.click(within(subList()!).getByRole('link', { name: 'Server' }));
			expect(get(globalNav).active).toBe('server');
			expect(document.activeElement).toBe(section.querySelector('h3'));
			const { replaceState } = await import('$app/navigation');
			expect(replaceState).toHaveBeenCalledWith('#server', {});
		} finally {
			section.remove();
		}
	});
});
