import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

// /settings/global (M5 §9): the global settings, on their own page. The shell only shows a page
// once signed in (with no pending password change), so the page loads its settings when it opens.
vi.mock('$app/navigation', () => ({ goto: vi.fn(async () => {}), replaceState: vi.fn(), beforeNavigate: vi.fn(), afterNavigate: vi.fn() }));
vi.mock('$lib/utils/api', async () => ({
	...(await vi.importActual<object>('$lib/utils/api')),
	listSettings: vi.fn(),
	getConfig: vi.fn(() => new Promise(() => {}))
}));
vi.mock('$lib/stores/config', async () => ({
	...(await vi.importActual<object>('$lib/stores/config')),
	saveGlobalSetting: vi.fn(async () => {})
}));

import * as api from '$lib/utils/api';
import { saveGlobalSetting } from '$lib/stores/config';
import { get } from 'svelte/store';
import { replaceState } from '$app/navigation';
import { globalNav, resetGlobalNavForTests } from '$lib/settings/globalNav';
import Page from './+page.svelte';

const listSettings = api.listSettings as unknown as ReturnType<typeof vi.fn>;
const save = saveGlobalSetting as unknown as ReturnType<typeof vi.fn>;

const LOG = { key: 'log.level', value: 'info', default: 'info', type: 'log_level', enum: ['debug', 'info'], description: 'Log level', restartRequired: false };
const PORT = { key: 'server.port', value: '8080', default: '8080', type: 'int', min: 1, max: 65535, description: 'Port', restartRequired: true };

beforeEach(() => {
	vi.clearAllMocks();
	resetGlobalNavForTests();
	listSettings.mockResolvedValue({ settings: [LOG, PORT] });
});

describe('/settings/global', () => {
	it('loads the settings once and shows them grouped', async () => {
		render(Page);
		expect(screen.getByRole('heading', { name: 'Global settings', level: 2 })).toBeTruthy();
		// M6 §10: log level and port are both in "Server".
		expect(await screen.findByRole('heading', { name: 'Server', level: 3 })).toBeTruthy();
		expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(1);
		expect(listSettings).toHaveBeenCalledTimes(1);
		expect((screen.getByLabelText(/Level/) as HTMLSelectElement).value).toBe('info');
	});

	it('a failed load says so (never an empty page as if there were no settings)', async () => {
		listSettings.mockRejectedValueOnce(new Error('server unreachable'));
		render(Page);
		expect(await screen.findByText(/Failed to load settings: server unreachable/)).toBeTruthy();
		expect(screen.queryByRole('heading', { level: 3 })).toBeNull();
	});

	it('Save writes the draft; a restart-required save raises the restart banner', async () => {
		render(Page);
		const port = (await screen.findByLabelText(/Port/)) as HTMLInputElement;
		await fireEvent.input(port, { target: { value: '9090' } });
		const row = port.closest('.row') as HTMLElement;
		await fireEvent.click(Array.from(row.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Save')!);
		await waitFor(() => expect(save).toHaveBeenCalled());
		expect(save.mock.calls[0][0]).toBe('server.port');
		expect(String(save.mock.calls[0][1])).toBe('9090');
		expect(await screen.findByText(/need.? a HOPS restart/)).toBeTruthy();
		// Saved: the row is no longer "unsaved" (a number input's value is stored as its text).
		const saveBtn = Array.from(row.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Save') as HTMLButtonElement;
		await waitFor(() => expect(saveBtn.disabled).toBe(true));
		expect(row.classList.contains('dirty')).toBe(false);
	});

	it('a cleared number is refused on the row ("Enter a number") and never sent', async () => {
		render(Page);
		const port = (await screen.findByLabelText(/Port/)) as HTMLInputElement;
		await fireEvent.input(port, { target: { value: '' } });
		const row = port.closest('.row') as HTMLElement;
		await fireEvent.click(Array.from(row.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Save')!);
		await waitFor(() => expect(row.textContent).toContain('Enter a number'));
		expect(save).not.toHaveBeenCalled();
	});

	it('a refused save shows the reason on the row', async () => {
		save.mockRejectedValueOnce(new Error('out of range'));
		render(Page);
		const port = (await screen.findByLabelText(/Port/)) as HTMLInputElement;
		await fireEvent.input(port, { target: { value: '9' } });
		const row = port.closest('.row') as HTMLElement;
		await fireEvent.click(Array.from(row.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Save')!);
		await waitFor(() => expect(row.textContent).toContain('out of range'));
	});
});

describe('/settings/global upload limits (M5 §10)', () => {
	const MB = 1048576;
	const IMPORT = { key: 'upload.max_bytes_import', value: String(50 * MB), default: String(50 * MB), type: 'bytes', min: MB, max: 200 * MB, description: 'Imports bigger than this are refused.', restartRequired: false };
	const ICON = { key: 'upload.max_bytes_icon', value: String(10 * MB), default: String(2 * MB), type: 'bytes', min: MB, max: 10 * MB, description: 'Icon uploads bigger than this are refused.', restartRequired: false, adjustedFrom: String(1024 * MB) };

	beforeEach(() => listSettings.mockResolvedValue({ settings: [IMPORT, ICON] }));

	it('labels each limit plainly and shows it in MB, with no "min"', async () => {
		render(Page);
		const imp = (await screen.findByLabelText(/Largest file you can import/)) as HTMLInputElement;
		expect(imp.value).toBe('50');
		expect(screen.getByLabelText(/Largest icon file/)).toBeTruthy();
		const row = imp.closest('.row') as HTMLElement;
		expect(row.textContent).toContain('MB');
		expect(row.textContent).not.toMatch(/\bmin\b/i);
		expect(row.textContent).not.toContain('52428800');
	});

	it('Save converts MB to bytes', async () => {
		render(Page);
		const imp = (await screen.findByLabelText(/Largest file you can import/)) as HTMLInputElement;
		await fireEvent.input(imp, { target: { value: '75' } });
		const row = imp.closest('.row') as HTMLElement;
		await fireEvent.click(Array.from(row.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Save')!);
		await waitFor(() => expect(save).toHaveBeenCalledWith('upload.max_bytes_import', String(75 * MB)));
	});

	for (const bad of ['0.5', '', 'abc']) {
		it(`refuses ${JSON.stringify(bad)} with "Must be at least 1 MB" and does not save`, async () => {
			render(Page);
			const imp = (await screen.findByLabelText(/Largest file you can import/)) as HTMLInputElement;
			await fireEvent.input(imp, { target: { value: bad } });
			const row = imp.closest('.row') as HTMLElement;
			await fireEvent.click(Array.from(row.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Save')!);
			await waitFor(() => expect(row.textContent).toContain('Must be at least 1 MB'));
			expect(save).not.toHaveBeenCalled();
		});
	}

	it('a value clamped on load shows "Lowered from X MB to the new maximum Y MB"', async () => {
		render(Page);
		expect(await screen.findAllByText(/Lowered from 1024 MB to the new maximum 10 MB/)).not.toHaveLength(0);
		const icon = screen.getByLabelText(/Largest icon file/) as HTMLInputElement;
		expect(icon.value).toBe('10');
		// Saving the setting is how the admin acknowledges it, so Save is available.
		const row = icon.closest('.row') as HTMLElement;
		const saveBtn = Array.from(row.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Save') as HTMLButtonElement;
		expect(saveBtn.disabled).toBe(false);
		await fireEvent.click(saveBtn);
		await waitFor(() => expect(save).toHaveBeenCalledWith('upload.max_bytes_icon', String(10 * MB)));
		await waitFor(() => expect(screen.queryByText(/Lowered from/)).toBeNull());
	});
});

describe('/settings/global Animations (M6 §7.13, Ruling 5)', () => {
	const ANIM = {
		key: 'display.animations', value: 'on', default: 'on', type: 'enum', enum: ['on', 'off', 'always'],
		description: 'Animations in the editor.', restartRequired: false
	};
	const NOTE = 'Your device asks for reduced motion — animations are off on this device';
	const realMatchMedia = window.matchMedia;
	function reducedMotion(reduce: boolean) {
		window.matchMedia = ((q: string) => ({
			matches: reduce && /prefers-reduced-motion:\s*reduce/.test(q), media: q, onchange: null,
			addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {},
			dispatchEvent: () => false
		})) as unknown as typeof window.matchMedia;
	}
	beforeEach(() => listSettings.mockResolvedValue({ settings: [ANIM] }));
	afterEach(() => { window.matchMedia = realMatchMedia; });

	it('shows "Animations" under Look & motion as On / Off / Always, On by default, and saves a choice', async () => {
		reducedMotion(false);
		render(Page);
		expect(await screen.findByRole('heading', { name: 'Look & motion', level: 3 })).toBeTruthy();
		const sel = screen.getByLabelText(/^Animations/) as HTMLSelectElement;
		expect(sel.tagName).toBe('SELECT');
		expect(Array.from(sel.options).map((o) => [o.value, o.textContent?.trim()])).toEqual([
			['on', 'On'], ['off', 'Off'], ['always', 'Always']
		]);
		expect(sel.value).toBe('on');
		expect(screen.queryByText(NOTE)).toBeNull(); // the device does not ask for reduced motion
		await fireEvent.change(sel, { target: { value: 'always' } });
		const row = sel.closest('.row') as HTMLElement;
		await fireEvent.click(Array.from(row.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Save')!);
		await waitFor(() => expect(save).toHaveBeenCalledWith('display.animations', 'always'));
	});

	it('On while the device asks for reduced motion: a visible note says animations are off here (never silent)', async () => {
		reducedMotion(true);
		render(Page);
		const sel = (await screen.findByLabelText(/^Animations/)) as HTMLSelectElement;
		const note = await screen.findByText(NOTE);
		expect(note.closest('.row')).toBe(sel.closest('.row'));
		// Always plays anyway, and Off plays nothing on any device: no note for either.
		await fireEvent.change(sel, { target: { value: 'always' } });
		await waitFor(() => expect(screen.queryByText(NOTE)).toBeNull());
		await fireEvent.change(sel, { target: { value: 'off' } });
		expect(screen.queryByText(NOTE)).toBeNull();
		await fireEvent.change(sel, { target: { value: 'on' } });
		expect(await screen.findByText(NOTE)).toBeTruthy();
	});
});

// M6 §10: the settings in logical groups (one table), each a section the sidebar / chips jump to.
describe('/settings/global groups (M6 §10)', () => {
	const ANIM = { key: 'display.animations', value: 'off', default: 'on', type: 'enum', enum: ['on', 'off', 'always'], description: 'Animations.', restartRequired: false };
	const IDLE = { key: 'editmode.idle_timeout_minutes', value: '15', default: '15', type: 'duration_minutes', min: 0, max: 1440, description: 'Idle.', restartRequired: false };
	const NEW = { key: 'brand.new_thing', value: '3', default: '3', type: 'int', min: 1, max: 9, description: 'A setting the table does not know yet.', restartRequired: false };

	it('shows the groups in table order as sections with their hash ids; an unknown key is in "Other", last, and editable', async () => {
		listSettings.mockResolvedValue({ settings: [NEW, PORT, IDLE, ANIM, LOG] });
		render(Page);
		await screen.findByRole('heading', { name: 'Other', level: 3 });
		const headings = screen.getAllByRole('heading', { level: 3 });
		expect(headings.map((h) => h.textContent?.trim())).toEqual(['Server', 'Editing', 'Look & motion', 'Other']);
		expect(headings.map((h) => h.closest('section')?.id)).toEqual(['server', 'editing', 'look-motion', 'other']);
		// Within a group, the table's order: port before log level.
		const server = headings[0].closest('section')!;
		expect(Array.from(server.querySelectorAll('.meta-key')).map((c) => c.textContent)).toEqual(['server.port', 'log.level']);
		// The unknown setting is never hidden, and saves like any other.
		const other = headings[3].closest('section')!;
		const input = other.querySelector('input') as HTMLInputElement;
		await fireEvent.input(input, { target: { value: '5' } });
		await fireEvent.click(Array.from(other.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Save')!);
		await waitFor(() => expect(save).toHaveBeenCalled());
		expect(save.mock.calls[0][0]).toBe('brand.new_thing');
		expect(String(save.mock.calls[0][1])).toBe('5');
	});

	it('tells the sidebar its groups and the saved Animations choice; leaving the page clears them', async () => {
		listSettings.mockResolvedValue({ settings: [PORT, ANIM] });
		const { unmount } = render(Page);
		await screen.findByRole('heading', { name: 'Look & motion', level: 3 });
		await waitFor(() => expect(get(globalNav).groups).toEqual([
			{ id: 'server', label: 'Server' },
			{ id: 'look-motion', label: 'Look & motion' }
		]));
		expect(get(globalNav).active).toBe('server');
		expect(get(globalNav).animations).toBe('off');
		unmount();
		expect(get(globalNav).groups).toEqual([]);
	});

	it('has a chip row of the groups (shown on phones); a chip moves to its group', async () => {
		listSettings.mockResolvedValue({ settings: [PORT, ANIM] });
		render(Page);
		const chips = await screen.findByRole('navigation', { name: 'Setting groups' });
		const links = Array.from(chips.querySelectorAll('a'));
		expect(links.map((a) => [a.textContent?.trim(), a.getAttribute('href')])).toEqual([
			['Server', '/settings/global#server'],
			['Look & motion', '/settings/global#look-motion']
		]);
		expect(links[0].getAttribute('aria-current')).toBe('location');
		await fireEvent.click(links[1]);
		expect(get(globalNav).active).toBe('look-motion');
		await waitFor(() => expect(links[1].getAttribute('aria-current')).toBe('location'));
		expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Look & motion', level: 3 }));
		expect(replaceState).toHaveBeenCalledWith('#look-motion', {});
	});

	it('a failed load lists no groups (never a sidebar of groups with nothing behind them)', async () => {
		listSettings.mockRejectedValueOnce(new Error('down'));
		render(Page);
		await screen.findByText(/Failed to load settings: down/);
		expect(screen.queryByRole('navigation', { name: 'Setting groups' })).toBeNull();
		expect(get(globalNav).groups).toEqual([]);
	});
});
