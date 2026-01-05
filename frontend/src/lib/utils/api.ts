import type { Config } from '$lib/types';

const API_BASE = import.meta.env.VITE_API_BASE || '/api';

// Store session token
let sessionToken: string | null = null;

export function setSessionToken(token: string | null) {
  sessionToken = token;
  if (token) {
    localStorage.setItem('hops_session', token);
  } else {
    localStorage.removeItem('hops_session');
  }
}

export function getSessionToken(): string | null {
  if (!sessionToken && typeof localStorage !== 'undefined') {
    sessionToken = localStorage.getItem('hops_session');
  }
  return sessionToken;
}

// Helper to make authenticated requests
async function fetchAPI(endpoint: string, options: RequestInit = {}) {
  const token = getSessionToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
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

export async function login(username: string, password: string): Promise<{ sessionId: string }> {
  const response = await fetchAPI('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });

  setSessionToken(response.sessionId);
  return response;
}

export async function logout(): Promise<void> {
  await fetchAPI('/auth/logout', { method: 'POST' });
  setSessionToken(null);
}

export async function changePassword(oldPassword: string, newPassword: string): Promise<void> {
  await fetchAPI('/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ oldPassword, newPassword }),
  });
}

// Admin API calls

export async function updateConfig(config: Config): Promise<void> {
  await fetchAPI('/config/update', {
    method: 'PUT',
    body: JSON.stringify(config),
  });
}

export async function exportConfig(format: 'json' | 'yaml' = 'json'): Promise<Blob> {
  const token = getSessionToken();
  const response = await fetch(`${API_BASE}/config/export?format=${format}`, {
    headers: token ? { 'Authorization': `Bearer ${token}` } : {},
  });

  if (!response.ok) {
    throw new Error(`Export failed: ${response.statusText}`);
  }

  return response.blob();
}

export async function importConfig(file: File, options?: { autoMatchIcons?: boolean }): Promise<{ success: boolean; message: string }> {
  const token = getSessionToken();
  const formData = new FormData();
  formData.append('file', file);
  if (options?.autoMatchIcons) {
    formData.append('autoMatchIcons', 'true');
  }

  const response = await fetch(`${API_BASE}/config/import`, {
    method: 'POST',
    headers: token ? { 'Authorization': `Bearer ${token}` } : {},
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

  const token = getSessionToken();
  const response = await fetch('/api/icons/upload', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`
    },
    body: formData
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
  const token = getSessionToken();
  const formData = new FormData();
  formData.append('file', file);
  formData.append('category', category);

  const response = await fetch(`${API_BASE}/backgrounds`, {
    method: 'POST',
    headers: token ? { 'Authorization': `Bearer ${token}` } : {},
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

export async function createBackgroundCategory(category: BackgroundCategory): Promise<void> {
  await fetchAPI('/backgrounds/categories', {
    method: 'POST',
    body: JSON.stringify(category),
  });
}
