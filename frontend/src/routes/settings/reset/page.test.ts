import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

// /settings/reset (M5 §9): Factory reset lives on its own page, never next to everyday settings.
vi.mock('$app/navigation', () => ({ goto: vi.fn(async () => {}), beforeNavigate: vi.fn(), afterNavigate: vi.fn() }));
vi.mock('$lib/utils/api', async () => ({
	...(await vi.importActual<object>('$lib/utils/api')),
	resetConfig: vi.fn(async () => ({})),
	getConfig: vi.fn(() => new Promise(() => {}))
}));

import * as api from '$lib/utils/api';
import { toast } from '$lib/stores/toast';
import { confirmModalState, closeConfirmModal } from '$lib/stores/confirmModal';
import Page from './+page.svelte';

const flush = () => new Promise((r) => setTimeout(r, 0));

function watchToasts() {
	const seen: string[] = [];
	let before: Set<string> | null = null; // toasts left over from earlier tests don't count
	const unsub = toast.subscribe((l) => {
		before ??= new Set(l.map((t) => t.id));
		l.filter((t) => !before!.has(t.id)).forEach((t) => seen.push(`${t.type}:${t.message}`));
	});
	return { seen, unsub };
}

beforeEach(() => vi.clearAllMocks());

describe('/settings/reset', () => {
	it('has the Factory reset heading, what it does, and the one danger button', () => {
		render(Page);
		expect(screen.getByRole('heading', { name: 'Factory reset', level: 2 })).toBeTruthy();
		expect(screen.getByText(/Delete every dashboard and start again/)).toBeTruthy();
		const buttons = screen.getAllByRole('button');
		expect(buttons).toHaveLength(1);
		expect(screen.getByRole('button', { name: 'Factory reset' })).toBe(buttons[0]);
	});

	it('is an emergency-stop button drawn with CSS/SVG only (M6 §7.11)', () => {
		const { container } = render(Page);
		const btn = screen.getByRole('button', { name: 'Factory reset' });
		expect(btn.classList.contains('estop')).toBe(true);
		expect(btn.querySelector('.estop-housing')).toBeTruthy();
		expect(btn.querySelector('.estop-cap')).toBeTruthy();
		expect(container.querySelector('img')).toBeNull();
		// Keyboard: pressing shows it pressed in, releasing lets it back out.
		fireEvent.keyDown(btn, { key: 'Enter' });
		expect(btn.classList.contains('pressing')).toBe(true);
		fireEvent.keyUp(btn, { key: 'Enter' });
		expect(btn.classList.contains('pressing')).toBe(false);
	});

	it('the confirmation describes the v3 content, and Cancel resets nothing', async () => {
		render(Page);
		await fireEvent.click(screen.getByRole('button', { name: 'Factory reset' }));
		await vi.waitFor(() => expect(get(confirmModalState).isOpen).toBe(true));
		const msg = get(confirmModalState).options?.message ?? '';
		expect(msg).toMatch(/dashboards, tabs, folders and tiles/);
		expect(msg).not.toMatch(/groups|entries/i);
		closeConfirmModal(false);
		await flush();
		expect(api.resetConfig).not.toHaveBeenCalled();
	});

	it('refused by the server: the error says why', async () => {
		(api.resetConfig as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('database is locked'));
		const { seen, unsub } = watchToasts();
		render(Page);
		await fireEvent.click(screen.getByRole('button', { name: 'Factory reset' }));
		await vi.waitFor(() => expect(get(confirmModalState).isOpen).toBe(true));
		closeConfirmModal(true);
		await waitFor(() => expect(seen.some((t) => t.startsWith('error:') && t.includes('database is locked'))).toBe(true));
		unsub();
		expect(seen.some((t) => t.startsWith('success:'))).toBe(false);
	});

	it('done but the reload failed: says exactly that, not "reset failed"', async () => {
		(api.getConfig as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('server unreachable'));
		const { seen, unsub } = watchToasts();
		render(Page);
		await fireEvent.click(screen.getByRole('button', { name: 'Factory reset' }));
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
