import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';

const getBackendVersion = vi.fn();
vi.mock('$lib/utils/api', async () => ({
	HttpStatusError: (await vi.importActual<typeof import('$lib/utils/api')>('$lib/utils/api')).HttpStatusError,
	getBackendVersion: (...a: unknown[]) => getBackendVersion(...a)
}));

import BackendStatus from './BackendStatus.svelte';
import { backendStatus } from '$lib/stores/backendStatus';

async function settle() {
	await new Promise((r) => setTimeout(r, 0));
}

describe('BackendStatus header dot', () => {
	beforeEach(() => {
		backendStatus.reset();
		getBackendVersion.mockReset();
	});

	it('is a green dot with version and round-trip time in an accessible tooltip when online', async () => {
		getBackendVersion.mockResolvedValue({ version: '3.0.0' });
		render(BackendStatus);
		await settle();
		const dot = screen.getByRole('button', { name: /backend online/i });
		expect(dot.getAttribute('data-status')).toBe('online');
		expect(screen.queryByText(/Backend: Online/)).toBeNull();
		await fireEvent.focus(dot);
		const tip = screen.getByRole('tooltip');
		expect(tip.textContent).toMatch(/v3\.0\.0/);
		expect(tip.textContent).toMatch(/\d+ ?ms/);
		expect(dot.getAttribute('aria-describedby')).toBe(tip.id);
	});

	it('is red and says so when offline, with a Retry in the tooltip', async () => {
		getBackendVersion.mockRejectedValue(new TypeError('Failed to fetch')); // unreachable
		render(BackendStatus);
		await settle();
		const dot = screen.getByRole('button', { name: /backend offline/i });
		expect(dot.getAttribute('data-status')).toBe('offline');
		await fireEvent.click(dot);
		expect(screen.getByRole('tooltip').textContent).toMatch(/unreachable/i);
		getBackendVersion.mockResolvedValue({ version: '3.0.0' });
		await fireEvent.click(screen.getByRole('button', { name: /retry/i }));
		await settle();
		expect(screen.getByRole('button', { name: /backend online/i })).toBeTruthy();
	});

	it('reached but answering with an error is degraded (amber "!"), not offline', async () => {
		getBackendVersion.mockRejectedValue(new Error('Server error (500)'));
		render(BackendStatus);
		await settle();
		const dot = screen.getByRole('button', { name: /backend degraded/i });
		expect(dot.getAttribute('data-status')).toBe('error');
		expect(dot.querySelector('svg[data-glyph="degraded"]')).toBeTruthy();
		await fireEvent.click(dot);
		expect(screen.getByRole('tooltip').textContent).toMatch(/answered with an error/i);
		expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy();
	});

	it('each state has its own glyph, not only a colour', async () => {
		getBackendVersion.mockResolvedValue({ version: '3.0.0' });
		render(BackendStatus);
		await settle();
		expect(screen.getByRole('button', { name: /backend online/i }).querySelector('svg[data-glyph="online"]')).toBeTruthy();
		getBackendVersion.mockRejectedValue(new TypeError('Failed to fetch'));
		await backendStatus.check();
		await settle();
		expect(screen.getByRole('button', { name: /backend offline/i }).querySelector('svg[data-glyph="offline"]')).toBeTruthy();
	});

	it('tap toggles the tooltip and Escape closes it', async () => {
		getBackendVersion.mockResolvedValue({ version: '3.0.0' });
		render(BackendStatus);
		await settle();
		const dot = screen.getByRole('button', { name: /backend online/i });
		expect(screen.queryByRole('tooltip')).toBeNull();
		await fireEvent.click(dot);
		expect(screen.getByRole('tooltip')).toBeTruthy();
		await fireEvent.keyDown(dot, { key: 'Escape' });
		expect(screen.queryByRole('tooltip')).toBeNull();
	});
});
