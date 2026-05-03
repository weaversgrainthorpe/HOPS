import type { Config } from '$lib/types';

const API_BASE = import.meta.env.VITE_API_BASE || '/api';

// Methods that require a CSRF token (state-changing operations)
const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Reads the CSRF token from the hops_csrf cookie. The backend sets this
 * cookie on login and on /api/auth/check; the frontend echoes it back in
 * the X-CSRF-Token header for mutation requests (double-submit pattern).
 */
export function getCSRFToken(): string {
  if (typeof document === 'undefined') return '';
  const match = document.cookie.match(/(?:^|;\s*)hops_csrf=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

/**
 * Adds the X-CSRF-Token header to a header object if the request method
 * is a mutation (POST/PUT/PATCH/DELETE) and a token is available.
 */
export function withCSRFHeader(headers: Record<string, string>, method?: string): Record<string, string> {
  if (method && MUTATION_METHODS.has(method.toUpperCase())) {
    const token = getCSRFToken();
    if (token) {
      return { ...headers, 'X-CSRF-Token': token };
    }
  }
  return headers;
}

// Helper to make API requests. Session auth is handled via HttpOnly cookies,
// CSRF protection via the double-submit cookie pattern.
async function fetchAPI(endpoint: string, options: RequestInit = {}) {
  const baseHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };
  const headers = withCSRFHeader(baseHeaders, options.method);

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
    credentials: 'same-origin',
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('SESSION_EXPIRED');
    }
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

// Public API calls

export async function getBackendVersion(): Promise<{ version: string }> {
  return fetchAPI('/version');
}

export async function getConfig(): Promise<Config> {
  return fetchAPI('/config');
}

export async function getStatus(entryId: string) {
  return fetchAPI(`/status/${entryId}`);
}

// Auth API calls

export interface AuthStatus {
  authenticated: boolean;
  mustChangePassword: boolean;
}

export async function checkAuth(): Promise<AuthStatus> {
  try {
    const resp = await fetchAPI('/auth/check');
    return {
      authenticated: resp.authenticated === true,
      mustChangePassword: resp.mustChangePassword === true,
    };
  } catch {
    return { authenticated: false, mustChangePassword: false };
  }
}

export async function login(username: string, password: string): Promise<{ mustChangePassword: boolean }> {
  const resp = await fetchAPI('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  return { mustChangePassword: resp.mustChangePassword === true };
}

export async function logout(): Promise<void> {
  await fetchAPI('/auth/logout', { method: 'POST' });
}

export async function changePassword(oldPassword: string, newPassword: string): Promise<void> {
  await fetchAPI('/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ oldPassword, newPassword }),
  });
}

// Admin API calls

export async function updateConfig(config: Config): Promise<void> {
  await fetchAPI('/config', {
    method: 'PUT',
    body: JSON.stringify(config),
  });
}

export async function exportConfig(format: 'json' | 'yaml' = 'json', dashboardId?: string): Promise<Blob> {
  let url = `${API_BASE}/config/export?format=${format}`;
  if (dashboardId) {
    url += `&dashboardId=${encodeURIComponent(dashboardId)}`;
  }

  const response = await fetch(url, {
    credentials: 'same-origin',
  });

  if (!response.ok) {
    throw new Error(`Export failed: ${response.statusText}`);
  }

  return response.blob();
}

export async function importConfig(file: File, options?: { autoMatchIcons?: boolean }): Promise<{ success: boolean; message: string }> {
  const formData = new FormData();
  formData.append('file', file);
  if (options?.autoMatchIcons) {
    formData.append('autoMatchIcons', 'true');
  }

  const response = await fetch(`${API_BASE}/config/import`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: withCSRFHeader({}, 'POST'),
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `Import failed: ${response.statusText}`);
  }

  return response.json();
}

// Icon API calls

export interface IconCategory {
  id: string;
  name: string;
  icon: string;
  order: number;
  isPreset: boolean;
  createdAt: string;
}

export interface Icon {
  id: string;
  name: string;
  icon: string;
  categoryId: string;
  color?: string;
  imageUrl?: string;
  isPreset: boolean;
  createdAt: string;
}

export async function getIconCategories(): Promise<IconCategory[]> {
  return fetchAPI('/icon-categories');
}

export async function getIcons(categoryId?: string): Promise<Icon[]> {
  const query = categoryId ? `?category=${categoryId}` : '';
  return fetchAPI(`/icons${query}`);
}

export async function createIcon(icon: Omit<Icon, 'isPreset' | 'createdAt'>): Promise<void> {
  await fetchAPI('/icons', {
    method: 'POST',
    body: JSON.stringify(icon),
  });
}

export async function updateIcon(id: string, icon: Partial<Omit<Icon, 'id' | 'isPreset' | 'createdAt'>>): Promise<void> {
  await fetchAPI(`/icons/${id}`, {
    method: 'PUT',
    body: JSON.stringify(icon),
  });
}

export async function deleteIcon(id: string): Promise<void> {
  await fetchAPI(`/icons/${id}`, {
    method: 'DELETE',
  });
}

export async function uploadIconImage(file: File): Promise<{ url: string; id: string }> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${API_BASE}/icons/upload`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: withCSRFHeader({}, 'POST'),
    body: formData,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || 'Upload failed');
  }

  return response.json();
}

export async function createIconCategory(category: Omit<IconCategory, 'isPreset' | 'createdAt'>): Promise<void> {
  await fetchAPI('/icon-categories', {
    method: 'POST',
    body: JSON.stringify(category),
  });
}

export async function updateIconCategory(id: string, category: Partial<Omit<IconCategory, 'id' | 'isPreset' | 'createdAt'>>): Promise<void> {
  await fetchAPI(`/icon-categories/${id}`, {
    method: 'PUT',
    body: JSON.stringify(category),
  });
}

export async function deleteIconCategory(id: string): Promise<void> {
  await fetchAPI(`/icon-categories/${id}`, {
    method: 'DELETE',
  });
}

// Background API calls

export interface BackgroundImage {
  id: string;
  name: string;
  url: string;
  category: string;
  source: 'preset' | 'uploaded';
}

export interface BackgroundCategory {
  id: string;
  name: string;
  icon: string;
}

export interface BackgroundsResponse {
  categories: BackgroundCategory[];
  images: BackgroundImage[];
}

export async function getBackgrounds(): Promise<BackgroundsResponse> {
  return fetchAPI('/backgrounds');
}

export async function uploadBackground(file: File, category: string): Promise<BackgroundImage> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('category', category);

  const response = await fetch(`${API_BASE}/backgrounds`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: withCSRFHeader({}, 'POST'),
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `Upload failed: ${response.statusText}`);
  }

  return response.json();
}

export async function deleteBackground(id: string): Promise<void> {
  await fetchAPI(`/backgrounds/${id}`, {
    method: 'DELETE',
  });
}

export async function updateBackground(id: string, updates: { name?: string; category?: string }): Promise<void> {
  await fetchAPI(`/backgrounds/${id}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
}

export async function createBackgroundCategory(category: BackgroundCategory): Promise<void> {
  await fetchAPI('/backgrounds/categories', {
    method: 'POST',
    body: JSON.stringify(category),
  });
}

export async function updateBackgroundCategory(id: string, updates: { name?: string; icon?: string }): Promise<void> {
  await fetchAPI(`/backgrounds/categories/${id}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
}

export async function deleteBackgroundCategory(id: string): Promise<void> {
  await fetchAPI(`/backgrounds/categories/${id}`, {
    method: 'DELETE',
  });
}

// Config reset

export async function resetConfig(): Promise<Config> {
  return fetchAPI('/config/reset', { method: 'POST' });
}

// Backup API calls

export interface BackupInfo {
  name: string;
  path: string;
  size: number;
  createdAt: string;
}

export async function listBackups(): Promise<{ backups: BackupInfo[] }> {
  return fetchAPI('/backups');
}

export async function createBackup(reason?: string): Promise<{ success: boolean; path: string; message: string }> {
  return fetchAPI('/backups', {
    method: 'POST',
    body: JSON.stringify({ reason: reason || 'manual' }),
  });
}

export async function restoreBackup(backupName: string): Promise<{ success: boolean; message: string }> {
  return fetchAPI(`/backups/${encodeURIComponent(backupName)}`, {
    method: 'POST',
  });
}

export async function deleteBackup(backupName: string): Promise<void> {
  await fetchAPI(`/backups/${encodeURIComponent(backupName)}`, {
    method: 'DELETE',
  });
}
