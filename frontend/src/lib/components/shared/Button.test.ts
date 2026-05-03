import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { createRawSnippet } from 'svelte';
import Button from './Button.svelte';

// Helper to create a Snippet from a string for testing children
function textSnippet(text: string) {
	return createRawSnippet(() => ({
		render: () => `<span>${text}</span>`
	}));
}

describe('Button component', () => {
	it('renders the children content', () => {
		render(Button, { props: { children: textSnippet('Click me') } });
		expect(screen.getByRole('button')).toHaveTextContent('Click me');
	});

	it('defaults to primary variant', () => {
		const { container } = render(Button, { props: { children: textSnippet('Btn') } });
		expect(container.querySelector('button')).toHaveClass('btn-primary');
	});

	it('applies the requested variant class', () => {
		const { container } = render(Button, {
			props: { variant: 'danger', children: textSnippet('Delete') }
		});
		expect(container.querySelector('button')).toHaveClass('btn-danger');
	});

	it('applies the requested size class', () => {
		const { container } = render(Button, {
			props: { size: 'large', children: textSnippet('Big') }
		});
		expect(container.querySelector('button')).toHaveClass('btn-large');
	});

	it('applies full-width modifier', () => {
		const { container } = render(Button, {
			props: { fullWidth: true, children: textSnippet('Wide') }
		});
		expect(container.querySelector('button')).toHaveClass('full-width');
	});

	it('disabled prop disables the button', () => {
		render(Button, { props: { disabled: true, children: textSnippet('No') } });
		expect(screen.getByRole('button')).toBeDisabled();
	});

	it('loading prop disables the button', () => {
		render(Button, { props: { loading: true, children: textSnippet('Wait') } });
		expect(screen.getByRole('button')).toBeDisabled();
	});

	it('loading prop adds loading class', () => {
		const { container } = render(Button, {
			props: { loading: true, children: textSnippet('Wait') }
		});
		expect(container.querySelector('button')).toHaveClass('loading');
	});

	it('fires onclick when clicked', async () => {
		const handler = vi.fn();
		render(Button, { props: { onclick: handler, children: textSnippet('Click') } });

		await fireEvent.click(screen.getByRole('button'));
		expect(handler).toHaveBeenCalledOnce();
	});

	it('does not fire onclick when disabled (using realistic user interaction)', async () => {
		const user = userEvent.setup();
		const handler = vi.fn();
		render(Button, {
			props: { onclick: handler, disabled: true, children: textSnippet('Click') }
		});

		// userEvent respects the `disabled` attribute (unlike fireEvent.click)
		await user.click(screen.getByRole('button'));
		expect(handler).not.toHaveBeenCalled();
	});

	it('renders with submit type when specified', () => {
		render(Button, { props: { type: 'submit', children: textSnippet('Submit') } });
		expect(screen.getByRole('button')).toHaveAttribute('type', 'submit');
	});

	it('defaults to button type', () => {
		render(Button, { props: { children: textSnippet('Btn') } });
		expect(screen.getByRole('button')).toHaveAttribute('type', 'button');
	});

	it('applies custom class alongside built-in classes', () => {
		const { container } = render(Button, {
			props: { class: 'my-custom', children: textSnippet('X') }
		});
		const btn = container.querySelector('button');
		expect(btn).toHaveClass('btn-primary');
		expect(btn).toHaveClass('my-custom');
	});
});
