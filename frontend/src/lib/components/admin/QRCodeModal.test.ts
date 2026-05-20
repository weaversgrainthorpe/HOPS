import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import QRCodeModal from './QRCodeModal.svelte';
import { toast } from '$lib/stores/toast';

const dashboard = {
	id: 'sample',
	name: 'Sample',
	path: '/sample-1'
};

describe('QRCodeModal', () => {
	beforeEach(() => {
		toast.clear();
	});

	it('renders the dashboard name', async () => {
		render(QRCodeModal, { props: { dashboard, onClose: () => {} } });
		expect(screen.getByText('Sample')).toBeInTheDocument();
	});

	it('renders the full URL using window.location.origin', async () => {
		render(QRCodeModal, { props: { dashboard, onClose: () => {} } });

		// The URL is rendered once the QR code generates (in a <code> element)
		await waitFor(() => {
			expect(screen.getByText(/\/sample-1$/)).toBeInTheDocument();
		});

		// jsdom defaults window.location.origin to http://localhost:3000
		// (or similar) — just verify it includes the dashboard path
		const url = screen.getByText(/\/sample-1$/);
		expect(url.textContent).toMatch(/^https?:\/\/.+\/sample-1$/);
	});

	it('renders an SVG QR code after generation', async () => {
		render(QRCodeModal, {
			props: { dashboard, onClose: () => {} }
		});

		// QR generation is async; wait for the SVG to appear. The Modal
		// component portals its content to document.body, so the QR frame
		// is queried from the document rather than the render container.
		await waitFor(
			() => {
				const svg = document.querySelector('.qr-frame svg');
				expect(svg).not.toBeNull();
			},
			{ timeout: 2000 }
		);
	});

	it('shows the scan hint text', async () => {
		render(QRCodeModal, { props: { dashboard, onClose: () => {} } });

		await waitFor(() => {
			expect(screen.getByText(/scan with a phone camera/i)).toBeInTheDocument();
		});
	});

	it('exposes a copy button with an aria-label', async () => {
		render(QRCodeModal, { props: { dashboard, onClose: () => {} } });

		await waitFor(() => {
			expect(screen.getByLabelText(/copy url/i)).toBeInTheDocument();
		});
	});

	it('copies URL to clipboard when copy button is clicked', async () => {
		const writeText = vi.fn().mockResolvedValue(undefined);
		Object.defineProperty(navigator, 'clipboard', {
			value: { writeText },
			configurable: true
		});

		render(QRCodeModal, { props: { dashboard, onClose: () => {} } });

		const copyBtn = await waitFor(() => screen.getByLabelText(/copy url/i));
		await fireEvent.click(copyBtn);

		expect(writeText).toHaveBeenCalledWith(
			expect.stringContaining('/sample-1')
		);
	});

	it('shows success toast after copy', async () => {
		Object.defineProperty(navigator, 'clipboard', {
			value: { writeText: vi.fn().mockResolvedValue(undefined) },
			configurable: true
		});

		render(QRCodeModal, { props: { dashboard, onClose: () => {} } });

		const copyBtn = await waitFor(() => screen.getByLabelText(/copy url/i));
		await fireEvent.click(copyBtn);

		await waitFor(() => {
			expect(toast.subscribe).toBeDefined(); // sanity
		});
		// Pull current toast state
		let toasts: Array<{ type: string }> = [];
		const unsub = toast.subscribe((t) => {
			toasts = t;
		});
		unsub();
		expect(toasts.some((t) => t.type === 'success')).toBe(true);
	});

	it('shows error toast when clipboard fails', async () => {
		Object.defineProperty(navigator, 'clipboard', {
			value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
			configurable: true
		});

		render(QRCodeModal, { props: { dashboard, onClose: () => {} } });

		const copyBtn = await waitFor(() => screen.getByLabelText(/copy url/i));
		await fireEvent.click(copyBtn);

		await waitFor(() => {
			let toasts: Array<{ type: string }> = [];
			const unsub = toast.subscribe((t) => {
				toasts = t;
			});
			unsub();
			expect(toasts.some((t) => t.type === 'error')).toBe(true);
		});
	});

	it('calls onClose when the close button is clicked', async () => {
		const onClose = vi.fn();
		render(QRCodeModal, { props: { dashboard, onClose } });

		// Wait for the modal to fully render then click "Close"
		const closeBtn = await waitFor(() => screen.getByText('Close'));
		await fireEvent.click(closeBtn);

		expect(onClose).toHaveBeenCalled();
	});
});
