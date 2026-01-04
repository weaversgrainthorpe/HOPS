import { writable, get } from 'svelte/store';

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  confirmStyle?: 'danger' | 'primary' | 'warning';
}

interface ConfirmState {
  isOpen: boolean;
  options: ConfirmOptions | null;
  resolve: ((value: boolean) => void) | null;
}

const initialState: ConfirmState = {
  isOpen: false,
  options: null,
  resolve: null
};

export const confirmModalState = writable<ConfirmState>(initialState);

export function confirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    confirmModalState.set({
      isOpen: true,
      options,
      resolve
    });
  });
}

export function closeConfirmModal(result: boolean) {
  const state = get(confirmModalState);
  if (state.resolve) {
    state.resolve(result);
  }
  confirmModalState.set(initialState);
}
