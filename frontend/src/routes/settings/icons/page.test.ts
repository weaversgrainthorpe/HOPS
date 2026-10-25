import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/svelte';

// /settings/icons: the uploaded icons with where each is used, upload, rename/recategorise,
// delete (warning first when in use) and the user's categories. Every failure is visible.
const api = vi.hoisted(() => ({
	getIcons: vi.fn(),
	getIconCategories: vi.fn(),
	getIconUsage: vi.fn(),
	uploadIcon: vi.fn(),
	updateIcon: vi.fn(),
	deleteIcon: vi.fn(),
	createIconCategory: vi.fn(),
	updateIconCategory: vi.fn(),
	deleteIconCategory: vi.fn()
}));
vi.mock('$lib/utils/api', async () => ({
	...(await vi.importActual<object>('$lib/utils/api')),
	...api
}));
const confirmMock = vi.hoisted(() => vi.fn());
vi.mock('$lib/stores/confirmModal', async () => ({
	...(await vi.importActual<object>('$lib/stores/confirmModal')),
	confirm: confirmMock
}));

const bundled = vi.hoisted(() => ({ names: ['mdi:one', 'mdi:two'] }));
vi.mock('@iconify/svelte', async () => ({
	...(await vi.importActual<object>('@iconify/svelte')),
	listIcons: () => bundled.names
}));

import Page from './+page.svelte';
import { resetIconLibrary } from '$lib/icons/iconLibrary';
import { IconInUseError, CategoryNotEmptyError } from '$lib/utils/api';

const cats = [
	{ id: 'uploads', name: 'Uploads', icon: 'mdi:cloud-upload-outline', order: -1, isPreset: true, createdAt: '' },
	{ id: 'containers', name: 'Containers', icon: 'mdi:docker', order: 0, isPreset: true, createdAt: '' },
	{ id: 'mine', name: 'Mine', icon: 'mdi:folder', order: 20, isPreset: false, createdAt: '' },
	{ id: 'spare', name: 'Spare', icon: 'mdi:folder', order: 21, isPreset: false, createdAt: '' }
];
const icons = [
	{ id: 'ia', name: 'Alpha <b>bold</b>', icon: '', categoryId: 'mine', imageUrl: '/icons/a.png', isPreset: false, createdAt: '' },
	{ id: 'ib', name: 'Bravo', icon: '', categoryId: 'containers', imageUrl: '/icons/b.png', isPreset: false, createdAt: '' },
	{ id: 'dock', name: 'Docker', icon: '', categoryId: 'containers', imageUrl: '/api/icons/dashboard/docker.svg', isPreset: true, createdAt: '' }
];
const usage = {
	fetchedAt: 'now',
	icons: {
		ia: [
			{ kind: 'tile', name: 'Plex', dashboard: 'Home', dashboardId: 'd1', tab: 'Main' },
			{ kind: 'tile', name: 'Emby', dashboard: 'Media', dashboardId: 'd2', tab: 'Tab' },
			{ kind: 'tile', name: 'Jelly', dashboard: 'Home', dashboardId: 'd1', tab: 'Main', folder: 'Box' }
		],
		ib: []
	}
};

const card = (name: string) => screen.getByText(name, { selector: '.name' }).closest('li') as HTMLElement;

beforeEach(() => {
	resetIconLibrary();
	for (const f of Object.values(api)) f.mockReset();
	confirmMock.mockReset();
	api.getIcons.mockResolvedValue(structuredClone(icons));
	api.getIconCategories.mockResolvedValue(structuredClone(cats));
	api.getIconUsage.mockResolvedValue(structuredClone(usage));
	confirmMock.mockResolvedValue(true);
	bundled.names = ['mdi:one', 'mdi:two'];
});

describe('/settings/icons', () => {
	it('lists only uploads, names as text, with where each is used', async () => {
		render(Page);
		expect(screen.getByRole('heading', { name: 'Icons', level: 2 })).toBeTruthy();
		const grid = await screen.findByRole('list', { name: 'Uploaded icons' });
		expect(within(grid).getAllByRole('listitem')).toHaveLength(2);
		expect(grid.querySelector('b')).toBeNull();
		const a = card('Alpha <b>bold</b>');
		expect(a.textContent).toContain('Used by 3 tiles on Home, Media');
		expect(a.textContent).toContain('Mine');
		expect(card('Bravo').textContent).toContain('Not used');
		expect(screen.queryByText('Docker')).toBeNull();
	});

	it('search filters by name and says when nothing matches', async () => {
		render(Page);
		await screen.findByRole('list', { name: 'Uploaded icons' });
		await fireEvent.input(screen.getByLabelText('Search icons'), { target: { value: 'brav' } });
		expect(within(screen.getByRole('list', { name: 'Uploaded icons' })).getAllByRole('listitem')).toHaveLength(1);
		expect(screen.getByText('Showing 1 of 2')).toBeTruthy();
		await fireEvent.input(screen.getByLabelText('Search icons'), { target: { value: 'zzz' } });
		expect(screen.getByText('No uploaded icons match "zzz".')).toBeTruthy();
	});

	it('a failed load is a visible error, never "no icons"', async () => {
		api.getIcons.mockRejectedValue(new Error('HOPS hit an error'));
		render(Page);
		const alert = await screen.findByRole('alert');
		expect(alert.textContent).toContain("Couldn't load the icons: HOPS hit an error");
		expect(screen.queryByText(/No uploaded icons yet/)).toBeNull();
	});

	it('a failed usage check is visible and icons say "unknown", never "Not used"', async () => {
		api.getIconUsage.mockRejectedValue(new Error('layout unreadable'));
		render(Page);
		const alert = await screen.findByRole('alert');
		expect(alert.textContent).toContain("Couldn't work out where the icons are used: layout unreadable");
		await screen.findByRole('list', { name: 'Uploaded icons' });
		expect(card('Bravo').textContent).toContain('Where used: unknown');
		expect(screen.queryByText('Not used')).toBeNull();
	});

	it('deleting an unused icon asks once, then deletes without force', async () => {
		api.deleteIcon.mockResolvedValue(undefined);
		render(Page);
		await screen.findByRole('list', { name: 'Uploaded icons' });
		await fireEvent.click(screen.getByRole('button', { name: 'Delete Bravo' }));
		await waitFor(() => expect(api.deleteIcon).toHaveBeenCalledWith('ib', { force: false }));
		expect(confirmMock.mock.calls[0][0].message).toContain("isn't used");
	});

	it('deleting an icon in use lists the places first; Delete anyway forces', async () => {
		api.deleteIcon.mockResolvedValue(undefined);
		render(Page);
		await screen.findByRole('list', { name: 'Uploaded icons' });
		await fireEvent.click(screen.getByRole('button', { name: 'Delete Alpha <b>bold</b>' }));
		const dlg = await screen.findByRole('dialog', { name: /This icon is in use/ });
		const places = within(dlg).getByRole('list', { name: 'Where it is used' });
		expect(within(places).getAllByRole('listitem').map((l) => l.textContent)).toEqual([
			'Tile "Plex" on Home › Main',
			'Tile "Emby" on Media › Tab',
			'Tile "Jelly" on Home › Main, in folder "Box"'
		]);
		expect(api.deleteIcon).not.toHaveBeenCalled();
		expect(confirmMock).not.toHaveBeenCalled();
		await fireEvent.click(within(dlg).getByRole('button', { name: 'Delete anyway' }));
		await waitFor(() => expect(api.deleteIcon).toHaveBeenCalledWith('ia', { force: true }));
	});

	it('an icon put in use since the page loaded shows the server’s list instead of deleting', async () => {
		api.deleteIcon.mockRejectedValueOnce(
			new IconInUseError('in use', [{ kind: 'folder', name: 'New', dashboard: 'Home', dashboardId: 'd1', tab: 'Main' }])
		);
		render(Page);
		await screen.findByRole('list', { name: 'Uploaded icons' });
		await fireEvent.click(screen.getByRole('button', { name: 'Delete Bravo' }));
		const dlg = await screen.findByRole('dialog', { name: /This icon is in use/ });
		expect(dlg.textContent).toContain('Folder "New" on Home › Main');
		expect(dlg.textContent).toContain('since this page loaded');
	});

	it('a failed delete is a visible error', async () => {
		api.deleteIcon.mockRejectedValue(new Error('disk full'));
		const { toast } = await import('$lib/stores/toast');
		const spy = vi.spyOn(toast, 'error');
		render(Page);
		await screen.findByRole('list', { name: 'Uploaded icons' });
		await fireEvent.click(screen.getByRole('button', { name: 'Delete Bravo' }));
		await waitFor(() => expect(spy).toHaveBeenCalledWith(`Couldn't delete "Bravo": disk full`));
	});

	it('uploads several files into the chosen category and reports each one', async () => {
		api.uploadIcon.mockImplementation(async (f: File) => {
			if (f.name === 'broken.png') throw new Error('Could not decode the image file.');
			return { id: 'x', url: '/icons/x.png', name: f.name.replace(/\.png$/, ''), categoryId: 'mine' };
		});
		render(Page);
		await screen.findByRole('list', { name: 'Uploaded icons' });
		await fireEvent.change(screen.getByLabelText('Upload into'), { target: { value: 'mine' } });
		const files = [
			new File(['a'], 'one.png', { type: 'image/png' }),
			new File(['b'], 'broken.png', { type: 'image/png' }),
			new File(['c'], 'notes.txt', { type: 'text/plain' })
		];
		const input = screen.getByLabelText('Choose icon images to upload') as HTMLInputElement;
		Object.defineProperty(input, 'files', { value: files, configurable: true });
		await fireEvent.change(input);
		await waitFor(() => expect(screen.getByText('Uploaded 1 icon; 2 failed.')).toBeTruthy());
		expect(api.uploadIcon).toHaveBeenCalledTimes(2);
		expect(api.uploadIcon.mock.calls[0][1]).toEqual({ categoryId: 'mine', name: 'one' });
		const box = screen.getByText('Uploaded 1 icon; 2 failed.').closest('div') as HTMLElement;
		expect(box.getAttribute('role')).toBe('alert');
		expect(box.textContent).toContain('broken.png: failed: Could not decode the image file.');
		expect(box.textContent).toContain('notes.txt: failed: Not an image');
		// The library is reloaded after a successful upload.
		await waitFor(() => expect(api.getIcons).toHaveBeenCalledTimes(2));
	});

	it('rename and recategorise save only what changed', async () => {
		api.updateIcon.mockResolvedValue(undefined);
		render(Page);
		await screen.findByRole('list', { name: 'Uploaded icons' });
		await fireEvent.click(screen.getByRole('button', { name: 'Edit Bravo' }));
		const dlg = await screen.findByRole('dialog', { name: /Edit icon/ });
		await fireEvent.input(within(dlg).getByLabelText('Name'), { target: { value: '  Bravo 2 ' } });
		await fireEvent.change(within(dlg).getByLabelText('Category'), { target: { value: 'spare' } });
		await fireEvent.click(within(dlg).getByRole('button', { name: 'Save' }));
		await waitFor(() => expect(api.updateIcon).toHaveBeenCalledWith('ib', { name: 'Bravo 2', categoryId: 'spare' }));
	});

	it('an empty name is refused before saving', async () => {
		render(Page);
		await screen.findByRole('list', { name: 'Uploaded icons' });
		await fireEvent.click(screen.getByRole('button', { name: 'Edit Bravo' }));
		const dlg = await screen.findByRole('dialog', { name: /Edit icon/ });
		await fireEvent.input(within(dlg).getByLabelText('Name'), { target: { value: '   ' } });
		await fireEvent.click(within(dlg).getByRole('button', { name: 'Save' }));
		expect(within(dlg).getByRole('alert').textContent).toMatch(/can't be empty/);
		expect(api.updateIcon).not.toHaveBeenCalled();
	});

	it('categories: counts, add, rename, and delete with reassignment', async () => {
		api.createIconCategory.mockResolvedValue(undefined);
		api.updateIconCategory.mockResolvedValue(undefined);
		api.deleteIconCategory.mockResolvedValue(undefined);
		render(Page);
		const list = await screen.findByRole('list', { name: 'Your categories' });
		const rows = within(list).getAllByRole('listitem');
		expect(rows.map((r) => r.querySelector('.cat-name')?.textContent)).toEqual(['Mine', 'Spare']);
		expect(rows[0].textContent).toContain('1 icon');
		expect(rows[1].textContent).toContain('0 icons');

		await fireEvent.input(screen.getByLabelText('New category name'), { target: { value: 'Fresh' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Add category' }));
		await waitFor(() => expect(api.createIconCategory).toHaveBeenCalled());
		expect(api.createIconCategory.mock.calls[0][0]).toMatchObject({ name: 'Fresh', icon: 'mdi:folder-outline', order: 22 });

		await fireEvent.click(screen.getByRole('button', { name: 'Rename Spare' }));
		await fireEvent.input(screen.getByLabelText('New name for Spare'), { target: { value: 'Extra' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
		await waitFor(() => expect(api.updateIconCategory).toHaveBeenCalledWith('spare', { name: 'Extra' }));

		await fireEvent.click(screen.getByRole('button', { name: 'Delete category Mine' }));
		const dlg = await screen.findByRole('dialog', { name: /Delete category/ });
		expect(dlg.textContent).toContain('"Mine" has 1 icon');
		await fireEvent.change(within(dlg).getByLabelText('Move its icons to'), { target: { value: 'spare' } });
		await fireEvent.click(within(dlg).getByRole('button', { name: 'Move icons and delete' }));
		await waitFor(() => expect(api.deleteIconCategory).toHaveBeenCalledWith('mine', { moveTo: 'spare' }));
	});

	it('an empty category is deleted after a plain confirmation; a duplicate name is refused', async () => {
		api.deleteIconCategory.mockResolvedValue(undefined);
		render(Page);
		await screen.findByRole('list', { name: 'Your categories' });
		await fireEvent.click(screen.getByRole('button', { name: 'Delete category Spare' }));
		await waitFor(() => expect(api.deleteIconCategory).toHaveBeenCalledWith('spare', {}));
		await fireEvent.input(screen.getByLabelText('New category name'), { target: { value: 'containers' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Add category' }));
		expect((await screen.findByText(/There is already a category called "containers"/)).getAttribute('role')).toBe('alert');
		expect(api.createIconCategory).not.toHaveBeenCalled();
	});

	it('a category that gained icons since loading asks where they go', async () => {
		api.deleteIconCategory.mockRejectedValueOnce(new CategoryNotEmptyError('has icons', 4));
		render(Page);
		await screen.findByRole('list', { name: 'Your categories' });
		await fireEvent.click(screen.getByRole('button', { name: 'Delete category Spare' }));
		const dlg = await screen.findByRole('dialog', { name: /Delete category/ });
		expect(dlg.textContent).toContain('"Spare" has 4 icons');
	});

	it('uploads go to the built-in Uploads category by default', async () => {
		api.uploadIcon.mockResolvedValue({ id: 'x', url: '/icons/x.png', name: 'one', categoryId: 'uploads' });
		render(Page);
		await screen.findByRole('list', { name: 'Uploaded icons' });
		expect((screen.getByLabelText('Upload into') as HTMLSelectElement).value).toBe('uploads');
		const input = screen.getByLabelText('Choose icon images to upload') as HTMLInputElement;
		Object.defineProperty(input, 'files', { value: [new File(['a'], 'one.png', { type: 'image/png' })], configurable: true });
		await fireEvent.change(input);
		await waitFor(() => expect(api.uploadIcon).toHaveBeenCalled());
		expect(api.uploadIcon.mock.calls[0][1]).toEqual({ categoryId: 'uploads', name: 'one' });
	});

	it('deleting a category offers Uploads for its icons first', async () => {
		render(Page);
		await screen.findByRole('list', { name: 'Your categories' });
		await fireEvent.click(screen.getByRole('button', { name: 'Delete category Mine' }));
		const dlg = await screen.findByRole('dialog', { name: /Delete category/ });
		expect((within(dlg).getByLabelText('Move its icons to') as HTMLSelectElement).value).toBe('uploads');
	});

	it('a failed usage refresh marks every "where used" as possibly out of date', async () => {
		api.getIconUsage.mockResolvedValueOnce(structuredClone(usage)).mockRejectedValueOnce(new Error('timed out'));
		api.getIcons
			.mockResolvedValueOnce(structuredClone(icons))
			.mockResolvedValue([...structuredClone(icons), { id: 'ic', name: 'Charlie', icon: '', categoryId: 'uploads', imageUrl: '/icons/c.png', isPreset: false, createdAt: '' }]);
		api.uploadIcon.mockResolvedValue({ id: 'ic', url: '/icons/c.png', name: 'Charlie', categoryId: 'uploads' });
		render(Page);
		await screen.findByRole('list', { name: 'Uploaded icons' });
		expect(card('Bravo').textContent).toContain('Not used');
		// An upload reloads the icons and the usage; the usage refresh fails.
		const input = screen.getByLabelText('Choose icon images to upload') as HTMLInputElement;
		Object.defineProperty(input, 'files', { value: [new File(['c'], 'Charlie.png', { type: 'image/png' })], configurable: true });
		await fireEvent.change(input);
		const alert = await screen.findByText(/Couldn't work out where the icons are used: timed out/);
		expect(alert.textContent).toContain('may be out of date');
		await waitFor(() => expect(card('Bravo').textContent).toContain('Not used (may be out of date)'));
		expect(card('Alpha <b>bold</b>').textContent).toContain('Used by 3 tiles on Home, Media (may be out of date)');
		// The new icon was never checked: unknown, not "Not used".
		expect(card('Charlie').textContent).toContain('Where used: unknown');
	});

	it('the offline note links to Global settings › Uploads', async () => {
		render(Page);
		await screen.findByRole('list', { name: 'Uploaded icons' });
		const link = screen.getByRole('link', { name: 'Global settings › Uploads' });
		expect(link.getAttribute('href')).toBe('/settings/global#uploads');
		const note = document.querySelector('.offline-note')?.textContent?.replace(/\s+/g, ' ');
		expect(note).toMatch(/2 interface icons and 1 dashboard-icons are bundled with HOPS/);
		expect(screen.queryByRole('alert')).toBeNull();
	});

	it('an offline set that did not load is said, not shown as "0 icons bundled"', async () => {
		bundled.names = [];
		render(Page);
		await screen.findByRole('list', { name: 'Uploaded icons' });
		expect(screen.getByRole('alert').textContent).toContain('The offline icon set is not loaded');
	});
});
