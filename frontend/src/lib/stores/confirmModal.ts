import { writable, get } from 'svelte/store';

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  confirmStyle?: 'danger' | 'primary' | 'warning';
  /**
   * Three-button variant: a second action between Cancel and Confirm (e.g.
   * Save / Discard / Keep editing). Only used through confirmChoice().
   */
  alternateText?: string;
  alternateStyle?: 'danger' | 'primary' | 'warning';
}

/** What the user picked: the confirm button, the alternate button, or cancel (also Escape/backdrop). */
export type ConfirmChoice = 'confirm' | 'alternate' | 'cancel';

interface ConfirmState {
  isOpen: boolean;
  options: ConfirmOptions | null;
  resolve: ((value: ConfirmChoice) => void) | null;
}

const initialState: ConfirmState = {
  isOpen: false,
  options: null,
  resolve: null
};

export const confirmModalState = writable<ConfirmState>(initialState);

/**
 * Open the confirm modal and resolve with the user's choice. A modal that is
 * already open is answered "cancel" first, so no caller is left waiting
 * forever on a promise that can no longer resolve.
 */
export function confirmChoice(options: ConfirmOptions): Promise<ConfirmChoice> {
  const prev = get(confirmModalState);
  if (prev.resolve) prev.resolve('cancel');
  return new Promise((resolve) => {
    confirmModalState.set({
      isOpen: true,
      options,
      resolve
    });
  });
}

/** Two-button confirm: true when confirmed. */
export function confirm(options: ConfirmOptions): Promise<boolean> {
  // The two-button form never shows an alternate button.
  const { alternateText: _a, alternateStyle: _s, ...two } = options;
  return confirmChoice(two).then((c) => c === 'confirm');
}

/** Close the modal: true = confirm, false = cancel, 'alternate' = the third button. */
export function closeConfirmModal(result: boolean | 'alternate') {
  const state = get(confirmModalState);
  confirmModalState.set(initialState);
  if (state.resolve) {
    state.resolve(result === 'alternate' ? 'alternate' : result ? 'confirm' : 'cancel');
  }
}
