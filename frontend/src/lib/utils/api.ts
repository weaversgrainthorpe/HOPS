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

export async function importConfig(file: File): Promise<{ success: boolean; message: string }> {
  const token = getSessionToken();
  const formData = new FormData();
  formData.append('file', file);

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
