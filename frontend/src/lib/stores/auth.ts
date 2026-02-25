import { writable } from 'svelte/store';
import { login as apiLogin, logout as apiLogout, getSessionToken as apiGetSessionToken } from '$lib/utils/api';
import { toast } from './toast';
import { logError } from '$lib/utils/errors';

// Re-export getSessionToken for components that need it
export const getSessionToken = apiGetSessionToken;

// Auth state
export const isAuthenticated = writable(false);
export const isLoggingIn = writable(false);

// Check if user has a valid session on app load
export function initAuth() {
  const token = apiGetSessionToken();
  isAuthenticated.set(!!token);
}

// Login
export async function login(username: string, password: string) {
  isLoggingIn.set(true);

  try {
    await apiLogin(username, password);
    isAuthenticated.set(true);
    toast.success('Logged in successfully');
    return true;
  } catch (error) {
    logError('Login', error);
    toast.error('Invalid username or password');
    return false;
  } finally {
    isLoggingIn.set(false);
  }
}

// Logout
export async function logout() {
  try {
    await apiLogout();
    toast.info('Logged out');
  } catch (error) {
    logError('Logout', error);
  } finally {
    isAuthenticated.set(false);
    // Edit mode will automatically disable via its subscription to isAuthenticated
  }
}
