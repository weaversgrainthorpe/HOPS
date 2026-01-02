import { writable } from 'svelte/store';
import { login as apiLogin, logout as apiLogout, getSessionToken } from '$lib/utils/api';

// Auth state
export const isAuthenticated = writable(false);
export const isLoggingIn = writable(false);

// Check if user has a valid session on app load
export function initAuth() {
  const token = getSessionToken();
  isAuthenticated.set(!!token);
}

// Login
export async function login(username: string, password: string) {
  isLoggingIn.set(true);

  try {
    await apiLogin(username, password);
    isAuthenticated.set(true);
    return true;
  } catch (error) {
    console.error('Login failed:', error);
    return false;
  } finally {
    isLoggingIn.set(false);
  }
}

// Logout
export async function logout() {
  try {
    await apiLogout();
  } catch (error) {
    console.error('Logout error:', error);
  } finally {
    isAuthenticated.set(false);
  }
}
