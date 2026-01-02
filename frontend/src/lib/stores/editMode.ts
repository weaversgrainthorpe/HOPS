import { writable, get } from 'svelte/store';
import { isAuthenticated } from './auth';

// Global edit mode state
export const editMode = writable(false);

export function toggleEditMode() {
  // Only allow toggle if authenticated
  if (!get(isAuthenticated)) {
    console.warn('Edit mode requires authentication');
    editMode.set(false);
    return false;
  }
  editMode.update(v => !v);
  return true;
}

export function enableEditMode() {
  // Only allow enabling if authenticated
  if (!get(isAuthenticated)) {
    console.warn('Edit mode requires authentication');
    editMode.set(false);
    return false;
  }
  editMode.set(true);
  return true;
}

export function disableEditMode() {
  editMode.set(false);
  return true;
}

// Automatically disable edit mode when user logs out
isAuthenticated.subscribe(authenticated => {
  if (!authenticated) {
    editMode.set(false);
  }
});
