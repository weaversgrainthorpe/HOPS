import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

// /settings/global (M5 §9): the global settings, on their own page. The shell only shows a page
// once signed in (with no pending password change), so the page loads its settings when it opens.
vi.mock('$app/navigation', () => ({ goto: vi.fn(async () => {}), beforeNavigate: vi.fn(), afterNavigate: vi.fn() }));
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
import Page from './+page.svelte';

const listSettings = api.listSettings as unknown as ReturnType<typeof vi.fn>;
const save = saveGlobalSetting as unknown as ReturnType<typeof vi.fn>;

const LOG = { key: 'log.level', value: 'info', default: 'info', type: 'log_level', enum: ['debug', 'info'], description: 'Log level', restartRequired: false };
const PORT = { key: 'server.port', value: '8080', default: '8080', type: 'int', min: 1, max: 65535, description: 'Port', restartRequired: true };

beforeEach(() => {
	vi.clearAllMocks();
	listSettings.mockResolvedValue({ settings: [LOG, PORT] });
});

describe('/settings/global', () => {
	it('loads the settings once and shows them grouped', async () => {
		render(Page);
		expect(screen.getByRole('heading', { name: 'Global settings', level: 2 })).toBeTruthy();
		expect(await screen.findByRole('heading', { name: 'Logging', level: 3 })).toBeTruthy();
		expect(screen.getByRole('heading', { name: 'Server', level: 3 })).toBeTruthy();
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
