import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';

vi.mock('$app/navigation', () => ({ goto: vi.fn(async () => {}), beforeNavigate: vi.fn() }));

import Navbar from './Navbar.svelte';
import Layout from '../../routes/+layout.svelte';

function setWidth(w: number) {
	Object.defineProperty(window, 'innerWidth', { configurable: true, value: w });
	window.dispatchEvent(new Event('resize'));
}

describe('Navbar search button', () => {
	afterEach(() => setWidth(1024));

	for (const w of [1440, 768, 480, 360]) {
		it(`renders a labelled Search button at ${w}px`, () => {
			setWidth(w);
			render(Navbar, { onSearch: () => {} });
			const b = screen.getByRole('button', { name: 'Search' });
			expect(b.getAttribute('title')).toBe('Search (/)');
			expect(b.querySelector('svg')).not.toBeNull();
		});
	}

	it('click calls onSearch', async () => {
		const onSearch = vi.fn();
		render(Navbar, { onSearch });
		await fireEvent.click(screen.getByRole('button', { name: 'Search' }));
		expect(onSearch).toHaveBeenCalledTimes(1);
	});

	it('in the app layout, clicking it opens the search modal', async () => {
		render(Layout, { children: (() => {}) as any });
		expect(screen.queryByRole('dialog')).toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: 'Search' }));
		expect(screen.getByRole('dialog')).toBeTruthy();
	});
});
