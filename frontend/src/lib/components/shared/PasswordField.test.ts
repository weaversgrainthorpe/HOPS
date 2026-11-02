import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import PasswordField from './PasswordField.svelte';

const base = { id: 'pw', value: 'secret', autocomplete: 'current-password' as const };

function input(container: HTMLElement): HTMLInputElement {
	return container.querySelector('input#pw') as HTMLInputElement;
}

describe('PasswordField', () => {
	it('starts hidden', () => {
		const { container } = render(PasswordField, { props: base });
		expect(input(container).type).toBe('password');
		expect(screen.getByRole('button', { name: 'Show password' })).toBeInTheDocument();
	});

	it('shows and hides what was typed, keeping the value', async () => {
		const user = userEvent.setup();
		const { container } = render(PasswordField, { props: base });
		await user.click(screen.getByRole('button', { name: 'Show password' }));
		expect(input(container).type).toBe('text');
		expect(input(container).value).toBe('secret');
		await user.click(screen.getByRole('button', { name: 'Hide password' }));
		expect(input(container).type).toBe('password');
		expect(input(container).value).toBe('secret');
	});

	it('does not submit the form it sits in', () => {
		render(PasswordField, { props: base });
		expect(screen.getByRole('button', { name: 'Show password' })).toHaveAttribute('type', 'button');
	});

	it('keeps a shown password away from the spell checker', () => {
		const { container } = render(PasswordField, { props: base });
		expect(input(container)).toHaveAttribute('spellcheck', 'false');
	});

	it('goes back to hidden when the field is disabled by a submit', async () => {
		const user = userEvent.setup();
		const { container, rerender } = render(PasswordField, { props: base });
		await user.click(screen.getByRole('button', { name: 'Show password' }));
		expect(input(container).type).toBe('text');
		await rerender({ ...base, disabled: true });
		expect(input(container).type).toBe('password');
		expect(screen.getByRole('button', { name: 'Show password' })).toBeDisabled();
	});
});
