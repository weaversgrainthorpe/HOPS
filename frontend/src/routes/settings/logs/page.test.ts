import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

// /settings/logs: the recent log lines, honest about what's missing.
const getLogs = vi.hoisted(() => vi.fn());
vi.mock('$lib/utils/api', async () => ({
	...(await vi.importActual<object>('$lib/utils/api')),
	getLogs
}));

import Page from './+page.svelte';

const base = {
	startedAt: '2026-10-25T09:00:00Z',
	fetchedAt: '2026-10-25T10:00:00Z',
	capacity: 2000,
	dropped: 0,
	buffered: 2,
	matching: 2,
	level: 'info',
	records: [
		{ time: '2026-10-25T09:00:01Z', level: 'info', message: 'HOPS started', attrs: [] },
		{ time: '2026-10-25T09:00:02Z', level: 'error', message: '<b>not html</b>', attrs: [{ key: 'error', value: 'x' }] }
	]
};

beforeEach(() => {
	getLogs.mockReset();
	getLogs.mockResolvedValue(structuredClone(base));
});
afterEach(() => vi.useRealTimers());

describe('/settings/logs', () => {
	it('shows the lines (as text), newest last, with the since line and the level notice', async () => {
		render(Page);
		expect(screen.getByRole('heading', { name: 'Logs', level: 2 })).toBeTruthy();
		const log = await screen.findByRole('log');
		const items = log.querySelectorAll('li');
		expect(items).toHaveLength(2);
		expect(items[1].textContent).toContain('<b>not html</b>');
		expect(log.querySelector('b')).toBeNull();
		expect(items[1].classList.contains('lvl-error')).toBe(true);
		expect(screen.getByText(/^Showing lines since HOPS started at/)).toBeTruthy();
		expect(screen.getByText(/Log level is Info, so debug lines aren't recorded/)).toBeTruthy();
		expect(screen.getByRole('link', { name: 'Global settings › Server' }).getAttribute('href')).toBe('/settings/global#server');
		expect(getLogs).toHaveBeenCalledWith({ limit: 500, level: 'debug' });
	});

	it('the line count and level filter refetch with their values', async () => {
		render(Page);
		await screen.findByRole('log');
		await fireEvent.change(screen.getByLabelText('Lines'), { target: { value: '100' } });
		await waitFor(() => expect(getLogs).toHaveBeenLastCalledWith({ limit: 100, level: 'debug' }));
		await fireEvent.change(screen.getByLabelText('Level'), { target: { value: 'warn' } });
		await waitFor(() => expect(getLogs).toHaveBeenLastCalledWith({ limit: 100, level: 'warn' }));
		await fireEvent.change(screen.getByLabelText('Lines'), { target: { value: 'all' } });
		await waitFor(() => expect(getLogs).toHaveBeenLastCalledWith({ limit: 'all', level: 'warn' }));
	});

	it('a failed fetch is a visible error, never an empty list', async () => {
		getLogs.mockRejectedValue(new Error('HOPS hit an error'));
		render(Page);
		const alert = await screen.findByRole('alert');
		expect(alert.textContent).toContain("Couldn't load the log lines: HOPS hit an error");
		expect(screen.queryByText(/No log lines recorded yet/)).toBeNull();
		expect(screen.queryByRole('log')).toBeNull();
	});

	it('a failed refresh keeps the earlier lines but marks them out of date', async () => {
		render(Page);
		await screen.findByRole('log');
		getLogs.mockRejectedValueOnce(new Error('offline'));
		await fireEvent.click(screen.getByRole('button', { name: /Refresh/ }));
		expect((await screen.findByRole('alert')).textContent).toContain('offline');
		expect(screen.getByText(/were loaded at .+ and may be out of date/)).toBeTruthy();
		// A good refresh clears it.
		await fireEvent.click(screen.getByRole('button', { name: /Refresh/ }));
		await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
	});

	it('an empty buffer says so', async () => {
		getLogs.mockResolvedValue({ ...structuredClone(base), buffered: 0, matching: 0, records: [] });
		render(Page);
		expect(await screen.findByText(/^No log lines recorded yet since/)).toBeTruthy();
	});

	it('the dropped notice', async () => {
		getLogs.mockResolvedValue({ ...structuredClone(base), dropped: 12 });
		render(Page);
		expect(await screen.findByText('12 older lines were dropped to stay within the last 2000.')).toBeTruthy();
	});

	it('auto-refresh polls every 5 s while on, and stops when the page is hidden', async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		render(Page);
		await screen.findByRole('log');
		const before = getLogs.mock.calls.length;
		await fireEvent.click(screen.getByRole('checkbox', { name: /Auto-refresh/ }));
		await vi.advanceTimersByTimeAsync(5_000);
		await waitFor(() => expect(getLogs.mock.calls.length).toBe(before + 1));
		Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
		document.dispatchEvent(new Event('visibilitychange'));
		const hiddenAt = getLogs.mock.calls.length;
		await vi.advanceTimersByTimeAsync(15_000);
		expect(getLogs.mock.calls.length).toBe(hiddenAt);
		Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
		document.dispatchEvent(new Event('visibilitychange'));
		await waitFor(() => expect(getLogs.mock.calls.length).toBe(hiddenAt + 1)); // refreshes on return
	});

	it('Download makes a .txt file', async () => {
		const create = vi.fn(() => 'blob:x');
		const revoke = vi.fn();
		Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
		const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
		render(Page);
		await screen.findByRole('log');
		await fireEvent.click(screen.getByRole('button', { name: /Download/ }));
		expect(create).toHaveBeenCalledTimes(1);
		const blob = (create.mock.calls[0] as unknown as [Blob])[0];
		expect(blob.type).toContain('text/plain');
		expect(await blob.text()).toContain('HOPS started');
		expect(click).toHaveBeenCalled();
		click.mockRestore();
	});

	it('a filter change during a fetch is queued, never dropped; until it lands the page says it is updating', async () => {
		render(Page);
		await screen.findByRole('log');
		let release!: (v: unknown) => void;
		getLogs.mockImplementationOnce(() => new Promise((res) => (release = res)));
		await fireEvent.click(screen.getByRole('button', { name: /Refresh/ })); // slow fetch in flight
		await fireEvent.change(screen.getByLabelText('Level'), { target: { value: 'error' } });
		expect(screen.getByText(/Updating to match the filter/)).toBeTruthy();
		const warnOnly = { ...structuredClone(base), matching: 1, records: [base.records[1]] };
		getLogs.mockResolvedValueOnce(warnOnly);
		release(structuredClone(base)); // the old (unfiltered) answer arrives first
		await waitFor(() => expect(getLogs).toHaveBeenLastCalledWith({ limit: 500, level: 'error' }));
		await waitFor(() => expect(screen.getByRole('log').querySelectorAll('li')).toHaveLength(1));
		expect(screen.queryByText(/Updating to match the filter/)).toBeNull();
		expect(screen.getByRole('log').querySelector('li.lvl-info')).toBeNull();
	});
});
