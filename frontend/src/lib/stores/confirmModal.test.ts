import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { confirmModalState, confirm, closeConfirmModal } from './confirmModal';

describe('confirmModal store', () => {
	beforeEach(() => {
		// Reset by closing any open modal (resolves the promise to false)
		const state = get(confirmModalState);
		if (state.isOpen) {
			closeConfirmModal(false);
		}
	});

	it('starts closed', () => {
		expect(get(confirmModalState).isOpen).toBe(false);
	});

	it('confirm() opens the modal with options', () => {
		// Don't await — confirm returns a promise that resolves when closed
		confirm({ title: 'Delete', message: 'Are you sure?' });

		const state = get(confirmModalState);
		expect(state.isOpen).toBe(true);
		expect(state.options?.title).toBe('Delete');
		expect(state.options?.message).toBe('Are you sure?');
	});

	it('resolves with true when confirmed', async () => {
		const promise = confirm({ title: 'X', message: 'X' });
		closeConfirmModal(true);
		await expect(promise).resolves.toBe(true);
	});

	it('resolves with false when canceled', async () => {
		const promise = confirm({ title: 'X', message: 'X' });
		closeConfirmModal(false);
		await expect(promise).resolves.toBe(false);
	});

	it('closes the modal after closeConfirmModal', () => {
		confirm({ title: 'X', message: 'X' });
		closeConfirmModal(true);
		expect(get(confirmModalState).isOpen).toBe(false);
	});

	it('preserves custom button labels', () => {
		confirm({
			title: 'Delete',
			message: 'Confirm?',
			confirmText: 'Yes, delete it',
			cancelText: 'Keep it'
		});

		const state = get(confirmModalState);
		expect(state.options?.confirmText).toBe('Yes, delete it');
		expect(state.options?.cancelText).toBe('Keep it');
	});

	it('preserves confirmStyle', () => {
		confirm({ title: 'X', message: 'X', confirmStyle: 'danger' });
		expect(get(confirmModalState).options?.confirmStyle).toBe('danger');
	});

	it('opening a new modal replaces the previous state', () => {
		confirm({ title: 'first', message: 'first message' });
		confirm({ title: 'second', message: 'second message' });

		const state = get(confirmModalState);
		expect(state.options?.title).toBe('second');
	});
});
