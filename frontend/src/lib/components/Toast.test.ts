import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import Toast from './Toast.svelte';
import { toast } from '$lib/stores/toast';
import { tick } from 'svelte';

describe('Toast component', () => {
	beforeEach(() => {
		toast.clear();
	});

	it('renders nothing when there are no toasts', () => {
		const { container } = render(Toast);
		// The toast-container only renders when toasts.length > 0
		expect(container.querySelector('.toast-container')).toBeNull();
	});

	it('renders a toast added to the store', async () => {
		render(Toast);
		toast.success('Hello world');
		await tick();

		expect(screen.getByText('Hello world')).toBeInTheDocument();
	});

	it('renders multiple toasts', async () => {
		render(Toast);
		toast.info('first');
		toast.info('second');
		toast.info('third');
		await tick();

		expect(screen.getByText('first')).toBeInTheDocument();
		expect(screen.getByText('second')).toBeInTheDocument();
		expect(screen.getByText('third')).toBeInTheDocument();
	});

	it('applies type-specific class', async () => {
		const { container } = render(Toast);
		toast.error('boom');
		await tick();

		const toastEl = container.querySelector('.toast');
		expect(toastEl).toHaveClass('toast-error');
	});

	it('uses role="alert" for screen readers', async () => {
		render(Toast);
		toast.warning('careful');
		await tick();

		expect(screen.getByRole('alert')).toBeInTheDocument();
	});

	it('dismisses a toast when close button is clicked', async () => {
		render(Toast);
		toast.info('dismiss me');
		await tick();

		expect(screen.getByText('dismiss me')).toBeInTheDocument();

		const closeBtn = screen.getByLabelText('Dismiss');
		await fireEvent.click(closeBtn);
		await tick();

		expect(screen.queryByText('dismiss me')).toBeNull();
	});

	it('only dismisses the toast that was clicked', async () => {
		render(Toast);
		toast.info('keep');
		toast.info('drop');
		await tick();

		// Find the close button that's a sibling of the "drop" message
		const dropMessage = screen.getByText('drop');
		const dropToast = dropMessage.closest('.toast');
		const closeBtn = dropToast?.querySelector('.toast-close') as HTMLButtonElement;

		await fireEvent.click(closeBtn);
		await tick();

		expect(screen.getByText('keep')).toBeInTheDocument();
		expect(screen.queryByText('drop')).toBeNull();
	});
});
