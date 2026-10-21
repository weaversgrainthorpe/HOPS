import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/svelte';

// /settings is the one admin home (spec §4D): logged out it asks for the password in place
// (the same LoginDialog as the pencil) instead of redirecting; Cancel goes back where you came
// from (or "/"); signed in it has every admin section, with MigrationFailed / notices on top.
const nav = vi.hoisted(() => ({ after: [] as Array<(n: unknown) => void> }));
vi.mock('$app/navigation', () => ({
	goto: vi.fn(async () => {}),
	beforeNavigate: vi.fn(),
	afterNavigate: vi.fn((cb: (n: unknown) => void) => nav.after.push(cb))
}));
vi.mock('$lib/utils/api', async () => ({
	...(await vi.importActual<object>('$lib/utils/api')),
	login: vi.fn(),
	logout: vi.fn(async () => {}),
	resetConfig: vi.fn(async () => ({})),
	listSettings: vi.fn(async () => ({
		settings: [{ key: 'log.level', value: 'info', default: 'info', type: 'log_level', enum: ['debug', 'info'], description: 'Log level', restartRequired: false }]
	})),
	getConfig: vi.fn(() => new Promise(() => {})),
	listBackups: vi.fn(async () => ({ backups: [] })),
	getBackendVersion: vi.fn(async () => ({ version: 'test' }))
}));

import * as api from '$lib/utils/api';
import { goto } from '$app/navigation';
import { toast } from '$lib/stores/toast';
import { isAuthenticated, authChecked, mustChangePassword, clearMustChangePassword } from '$lib/stores/auth';
import { config, migrationFailure } from '$lib/stores/config';
import { confirmModalState, closeConfirmModal } from '$lib/stores/confirmModal';
import { begin, apply, resetEditSessionForTests, dirty } from '$lib/stores/editSession';
import { updateNode } from '$lib/editor/treeOps';
import Page from './+page.svelte';
import type { Config } from '$lib/types';
import type { LayoutNode } from '$lib/types/layout';

const gotoMock = goto as unknown as ReturnType<typeof vi.fn>;
const apiLogin = api.login as unknown as ReturnType<typeof vi.fn>;
const listSettings = api.listSettings as unknown as ReturnType<typeof vi.fn>;
const flush = () => new Promise((r) => setTimeout(r, 0));

function doc(extra: Partial<Config> = {}): Config {
	return {
		schemaVersion: 3,
		dashboards: [{
			id: 'd', name: 'D', path: '/d', revision: 1,
			tabs: [{ id: 't', name: 'T', root: { columns: 12, children: [
				{ kind: 'tile', id: 'a', name: 'a', url: 'http://x', placement: { x: 0, y: 0, w: 1, h: 1 } } as unknown as LayoutNode
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

beforeEach(() => {
	vi.clearAllMocks();
	nav.after.length = 0;
	resetEditSessionForTests();
	config.set(doc());
	migrationFailure.set(null);
	mustChangePassword.set(false);
	authChecked.set(true);
	isAuthenticated.set(true);
});

describe('/settings logged out', () => {
	beforeEach(() => isAuthenticated.set(false));

	it('opens the sign-in dialog in place; no redirect, nothing loaded', async () => {
		render(Page);
		expect(await screen.findByRole('dialog', { name: 'Sign in' })).toBeTruthy();
		expect(screen.getByRole('dialog', { name: 'Sign in' }).textContent).toContain('Sign in to open Settings.');
		await flush();
		expect(gotoMock).not.toHaveBeenCalled();
		expect(listSettings).not.toHaveBeenCalled();
		expect(screen.queryByRole('heading', { name: 'Dashboards' })).toBeNull();
	});

	it('Cancel with no previous page goes to /', async () => {
		render(Page);
		await fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
		expect(gotoMock).toHaveBeenCalledWith('/');
		expect(listSettings).not.toHaveBeenCalled();
	});

	it('Cancel goes back to the page you came from', async () => {
		render(Page);
		for (const cb of nav.after) cb({ from: { url: new URL('http://localhost/d?x=1') }, to: { url: new URL('http://localhost/settings') } });
		await fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
		expect(gotoMock).toHaveBeenCalledWith('/d?x=1');
	});

	it('Cancel after a redirect from an admin page goes to /, not back into the redirect (no loop)', async () => {
		render(Page);
		for (const cb of nav.after) cb({ from: { url: new URL('http://localhost/admin/discovery') }, to: { url: new URL('http://localhost/settings') } });
		await fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
		expect(gotoMock).toHaveBeenCalledWith('/');
		expect(gotoMock).not.toHaveBeenCalledWith('/admin/discovery');
	});

	it('a failed migration, logged out: the notice says to sign in here (no link to this same page)', async () => {
		migrationFailure.set('could not migrate');
		render(Page);
		const notice = screen.getByRole('alert');
		expect(notice.textContent).toContain('Sign in, then open Backups on this page.');
		expect(within(notice).queryByRole('link')).toBeNull();
	});

	it('a successful sign-in shows Settings in place', async () => {
		apiLogin.mockResolvedValue({ mustChangePassword: false });
		render(Page);
		await screen.findByRole('dialog', { name: 'Sign in' });
		await signIn();
		await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Sign in' })).toBeNull());
		await waitFor(() => expect(listSettings).toHaveBeenCalledTimes(1));
		expect(screen.getByRole('heading', { name: 'Dashboards', level: 2 })).toBeTruthy();
		expect(gotoMock).not.toHaveBeenCalled();
	});

	it('a sign-in that must change the password loads nothing until the password is changed', async () => {
		apiLogin.mockResolvedValue({ mustChangePassword: true });
		render(Page);
		await screen.findByRole('dialog', { name: 'Sign in' });
		await signIn();
		await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Sign in' })).toBeNull());
		await flush();
		expect(listSettings).not.toHaveBeenCalled();
		clearMustChangePassword();
		await waitFor(() => expect(listSettings).toHaveBeenCalledTimes(1));
	});

	it('a failed migration is shown on top even before signing in', async () => {
		migrationFailure.set('could not migrate');
		render(Page);
		expect(screen.getByRole('heading', { name: /couldn't migrate your configuration/ })).toBeTruthy();
		expect(await screen.findByRole('dialog', { name: 'Sign in' })).toBeTruthy();
	});
});

describe('/settings signed in: the admin home', () => {
	it('has the sections in order: Dashboards, Global settings, Discovery, Backups, Password, Factory reset, Log out', async () => {
		render(Page);
		await waitFor(() => expect(listSettings).toHaveBeenCalled());
		const h2 = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent?.trim());
		expect(h2).toEqual(['Dashboards', 'Global settings', 'Discovery', 'Backups', 'Password', 'Factory reset', 'Log out']);
		expect(screen.getByRole('link', { name: /Open Discovery/ }).getAttribute('href')).toBe('/admin/discovery');
		expect(screen.getByRole('button', { name: /New Dashboard/ })).toBeTruthy();
		expect(screen.queryByRole('dialog', { name: 'Sign in' })).toBeNull();
	});

	it('the server notices sit at the top, above the sections', async () => {
		config.set(doc({ notices: [{ id: 'n1', text: 'Status checks now follow the most specific setting' }] } as Partial<Config>));
		render(Page);
		const notice = await screen.findByText(/Status checks now follow/);
		const dashboards = screen.getByRole('heading', { name: 'Dashboards', level: 2 });
		expect(notice.compareDocumentPosition(dashboards) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
	});

	it('a failed migration: MigrationFailed on top with Open Backups; no empty dashboard list', async () => {
		migrationFailure.set('could not migrate');
		config.set(null);
		render(Page);
		const notice = screen.getByRole('alert');
		expect(within(notice).getByRole('heading', { name: /couldn't migrate your configuration/ })).toBeTruthy();
		await fireEvent.click(within(notice).getByRole('button', { name: 'Open Backups' }));
		expect(await screen.findByRole('dialog', { name: /Backup/ })).toBeTruthy();
		expect(screen.queryByRole('button', { name: /New Dashboard/ })).toBeNull();
	});

	it('Log out signs out and goes to /', async () => {
		render(Page);
		await fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
		await waitFor(() => expect(api.logout).toHaveBeenCalled());
		expect(get(isAuthenticated)).toBe(false);
		await waitFor(() => expect(gotoMock).toHaveBeenCalledWith('/'));
		expect(screen.queryByRole('dialog', { name: 'Sign in' })).toBeNull();
	});

	it('Log out with unsaved edit-session changes: Keep editing cancels it and the page stays signed in', async () => {
		begin('d');
		apply('rename', (d) => updateNode(d, 'a', { name: 'mine' } as Partial<LayoutNode>));
		render(Page);
		await fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
		await flush();
		expect(get(confirmModalState).isOpen).toBe(true);
		closeConfirmModal(false); // Keep editing
		await flush();
		expect(api.logout).not.toHaveBeenCalled();
		expect(get(isAuthenticated)).toBe(true);
		expect(get(dirty)).toBe(true);
		expect(gotoMock).not.toHaveBeenCalled();
		expect(screen.getByRole('button', { name: 'Log out' })).toBeInTheDocument();
	});

	it('the session ending closes Backups and Change Password: nothing admin stays on screen', async () => {
		render(Page);
		await fireEvent.click(screen.getByRole('button', { name: /Open Backups/ }));
		expect(await screen.findByRole('dialog', { name: /Backup/ })).toBeTruthy();
		isAuthenticated.set(false);
		await waitFor(() => expect(screen.queryByRole('dialog', { name: /Backup/ })).toBeNull());
		expect(await screen.findByRole('dialog', { name: 'Sign in' })).toBeTruthy();
		// Signing back in does not reopen it.
		isAuthenticated.set(true);
		await flush();
		expect(screen.queryByRole('dialog', { name: /Backup/ })).toBeNull();

		await fireEvent.click(screen.getByRole('button', { name: /Change Password/i }));
		expect(await screen.findByRole('dialog', { name: 'Change Password' })).toBeTruthy();
		isAuthenticated.set(false);
		await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Change Password' })).toBeNull());
	});

	it('Log out hides the admin content at once, while leaving (no signed-out admin shell)', async () => {
		gotoMock.mockImplementationOnce(() => new Promise(() => {}));
		render(Page);
		await fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
		await waitFor(() => expect(gotoMock).toHaveBeenCalledWith('/'));
		expect(get(isAuthenticated)).toBe(false);
		expect(screen.queryByRole('heading', { name: 'Dashboards' })).toBeNull();
		expect(screen.queryByRole('heading', { name: 'Global settings' })).toBeNull();
		expect(screen.queryByRole('dialog', { name: 'Sign in' })).toBeNull();
	});

	it('Log out whose navigation fails: the reason is shown and the page asks to sign in (never stuck)', async () => {
		const toastError = vi.spyOn(toast, 'error');
		gotoMock.mockImplementationOnce(async () => { throw new Error('navigation aborted'); });
		render(Page);
		await fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
		expect(await screen.findByRole('dialog', { name: 'Sign in' })).toBeTruthy();
		expect(screen.queryByRole('heading', { name: 'Global settings' })).toBeNull();
		expect(toastError).toHaveBeenCalledWith(expect.stringContaining('navigation aborted'));
		toastError.mockRestore();
	});

	it('Factory Reset: the confirmation describes the v3 content, and Cancel resets nothing', async () => {
		render(Page);
		await fireEvent.click(screen.getByRole('button', { name: /Factory Reset/ }));
		await vi.waitFor(() => expect(get(confirmModalState).isOpen).toBe(true));
		const msg = get(confirmModalState).options?.message ?? '';
		expect(msg).toMatch(/dashboards, tabs, folders and tiles/);
		expect(msg).not.toMatch(/groups|entries/i);
		closeConfirmModal(false);
		await flush();
		expect(api.resetConfig).not.toHaveBeenCalled();
	});

	it('Factory Reset refused by the server: the error says why', async () => {
		(api.resetConfig as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('database is locked'));
		const seen: string[] = [];
		let before: Set<string> | null = null; // toasts left over from earlier tests don't count
		const unsub = toast.subscribe((l) => {
			before ??= new Set(l.map((t) => t.id));
			l.filter((t) => !before!.has(t.id)).forEach((t) => seen.push(`${t.type}:${t.message}`));
		});
		render(Page);
		await fireEvent.click(screen.getByRole('button', { name: /Factory Reset/ }));
		await vi.waitFor(() => expect(get(confirmModalState).isOpen).toBe(true));
		closeConfirmModal(true);
		await waitFor(() => expect(seen.some((t) => t.startsWith('error:') && t.includes('database is locked'))).toBe(true));
		unsub();
		expect(seen.some((t) => t.startsWith('success:'))).toBe(false);
	});

	it('Factory Reset done but the reload failed: says exactly that, not "reset failed"', async () => {
		(api.getConfig as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('server unreachable'));
		const seen: string[] = [];
		let before: Set<string> | null = null; // toasts left over from earlier tests don't count
		const unsub = toast.subscribe((l) => {
			before ??= new Set(l.map((t) => t.id));
			l.filter((t) => !before!.has(t.id)).forEach((t) => seen.push(`${t.type}:${t.message}`));
		});
		render(Page);
		await fireEvent.click(screen.getByRole('button', { name: /Factory Reset/ }));
		await vi.waitFor(() => expect(get(confirmModalState).isOpen).toBe(true));
		closeConfirmModal(true);
		await waitFor(() => expect(api.resetConfig).toHaveBeenCalled());
		await waitFor(() => expect(seen.some((t) => t.startsWith('error:') && t.includes('server unreachable'))).toBe(true));
		unsub();
		const err = seen.find((t) => t.startsWith('error:') && t.includes('server unreachable'))!;
		expect(err).toMatch(/reset was done/i);
		expect(err).not.toMatch(/reset failed/i);
		expect(seen.some((t) => t.startsWith('success:'))).toBe(false);
	});
});

