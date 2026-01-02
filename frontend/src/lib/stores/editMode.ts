import { writable } from 'svelte/store';

// Global edit mode state
export const editMode = writable(false);

export function toggleEditMode() {
  editMode.update(v => !v);
}

export function enableEditMode() {
  editMode.set(true);
}

export function disableEditMode() {
  editMode.set(false);
}
