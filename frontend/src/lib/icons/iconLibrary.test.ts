import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';

const api = vi.hoisted(() => ({ getIcons: vi.fn(), getIconCategories: vi.fn() }));
vi.mock('$lib/utils/api', async () => ({ ...(await vi.importActual<object>('$lib/utils/api')), ...api }));

import { iconLibrary, loadIconLibrary, resetIconLibrary } from './iconLibrary';

const icon = (name: string) => ({ id: name, name, icon: '', categoryId: 'uploads', imageUrl: `/icons/${name}.png`, isPreset: false, createdAt: '' });

beforeEach(() => {
	resetIconLibrary();
	api.getIcons.mockReset();
	api.getIconCategories.mockReset();
	api.getIconCategories.mockResolvedValue([]);
});

describe('iconLibrary', () => {
	it('a reload asked for during a load runs again after it, so data from before a write never wins', async () => {
		let release!: () => void;
		api.getIcons
			.mockImplementationOnce(() => new Promise((r) => (release = () => r([icon('before')]))))
			.mockResolvedValueOnce([icon('before'), icon('after')]);
		const first = loadIconLibrary();
		// A write happened; the page asks for a reload while the first load is still out.
		const second = loadIconLibrary();
		release();
		await first;
		await second;
		expect(api.getIcons).toHaveBeenCalledTimes(2);
		expect(get(iconLibrary).icons.map((i) => i.name)).toEqual(['before', 'after']);
		expect(get(iconLibrary).state).toBe('ok');
	});

	it('several reloads during one load run it again only once', async () => {
		let release!: () => void;
		api.getIcons.mockImplementationOnce(() => new Promise((r) => (release = () => r([])))).mockResolvedValue([icon('x')]);
		const p = loadIconLibrary();
		void loadIconLibrary();
		void loadIconLibrary();
		release();
		await p;
		expect(api.getIcons).toHaveBeenCalledTimes(2);
	});

	it('a failed load is a state with its message, keeping the last good lists', async () => {
		api.getIcons.mockResolvedValueOnce([icon('kept')]).mockRejectedValueOnce(new Error('offline'));
		await loadIconLibrary();
		await loadIconLibrary();
		const s = get(iconLibrary);
		expect(s.state).toBe('failed');
		expect(s.error).toBe('offline');
		expect(s.icons.map((i) => i.name)).toEqual(['kept']);
	});
});
