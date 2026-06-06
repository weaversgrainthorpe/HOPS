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

// Session-expired callback. fetchAPI fires this BEFORE throwing
// SESSION_EXPIRED so the app can react globally (clear auth state,
// toast, redirect to login) without every per-page try/catch having
// to remember to special-case the magic error string. Registered
// once in the auth store at module load.
let sessionExpiredHandler: (() => void) | null = null;
let sessionExpiredFiring = false; // re-entrancy guard

export function setSessionExpiredHandler(fn: () => void) {
  sessionExpiredHandler = fn;
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
      // Fire the registered global handler (clears auth state, toasts,
      // redirects to login) at most once per cascade — many in-flight
      // fetches can all 401 simultaneously when a session expires; we
      // only want one toast + one navigation.
      if (sessionExpiredHandler && !sessionExpiredFiring) {
        sessionExpiredFiring = true;
        try {
          sessionExpiredHandler();
        } finally {
          // Reset on next tick so a future fresh-session 401 still fires.
          setTimeout(() => { sessionExpiredFiring = false; }, 1000);
        }
      }
      throw new Error('SESSION_EXPIRED');
    }
    // Try to surface the server's own error message — HOPS handlers
    // write `{"error": "..."}` JSON on failure. Falls back to a
    // friendly status-class message so users never see raw HTTP
    // text like "API error: 500 Internal Server Error".
    let serverMsg = '';
    try {
      const text = await response.text();
      if (text) {
        try {
          const parsed = JSON.parse(text);
          if (parsed && typeof parsed.error === 'string') serverMsg = parsed.error;
        } catch { /* not JSON — leave serverMsg empty */ }
      }
    } catch { /* body unreadable */ }
    if (serverMsg) throw new Error(serverMsg);
    if (response.status === 403) throw new Error("You don't have permission to do that.");
    if (response.status === 404) throw new Error("Couldn't find what you were looking for.");
    if (response.status === 409) throw new Error("That conflicts with the server's current state — try refreshing.");
    if (response.status === 413) throw new Error("That upload is too big.");
    if (response.status === 429) throw new Error("Too many requests — slow down and try again in a moment.");
    if (response.status >= 500) throw new Error("HOPS hit an error — check the server logs for details.");
    throw new Error("Something went wrong with that request. Try again.");
  }

  // 204 No Content — no body to parse.
  if (response.status === 204) return null;
  // Read the body as text first, then attempt JSON parse. Content-Type
  // is unreliable in HOPS because some handlers write the status line
  // before writeJSON sets the header, so Content-Type ends up sniffed
  // as text/plain even though the body is JSON. Try-parse is safer.
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
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

export class LoginError extends Error {
  constructor(public reason: 'unauthorized' | 'network' | 'rate-limited' | 'unknown', message: string) {
    super(message);
    this.name = 'LoginError';
  }
}

export async function login(username: string, password: string): Promise<{ mustChangePassword: boolean }> {
  // Don't go through fetchAPI — a 401 here means "wrong password", not
  // "session expired", and we don't want the global session-expired
  // handler to fire on every failed login attempt.
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
      credentials: 'same-origin',
    });
  } catch {
    throw new LoginError('network', "Couldn't reach the HOPS server. Check that it's running and your network is up.");
  }
  if (response.status === 401) {
    throw new LoginError('unauthorized', 'Sign-in failed — check your username and password.');
  }
  if (response.status === 429) {
    throw new LoginError('rate-limited', 'Too many sign-in attempts. Wait a minute and try again.');
  }
  if (!response.ok) {
    throw new LoginError('unknown', `Sign-in failed (${response.status}). Check the server logs.`);
  }
  const resp = await response.json();
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

// updateConfig PUTs the config and returns any warnings the server
// attached (e.g. "pre-update backup failed: ... — config saved anyway").
// Callers should surface non-empty warnings to the user so silent
// degradation of the safety-net is visible.
export async function updateConfig(config: Config): Promise<{ warning?: string }> {
  const resp = await fetchAPI('/config', {
    method: 'PUT',
    body: JSON.stringify(config),
  });
  return resp ?? {};
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

// Admin settings — runtime-configurable values backed by the app_settings
// table. The list is authoritative on the backend: each entry includes its
// type ("int", "log_level", "cidr_list", "duration_seconds", ...), default,
// min/max/enum bounds, and a restartRequired flag for the UI to display.

export interface SettingDef {
  key: string;
  type: string;
  value: string;
  default: string;
  restartRequired: boolean;
  description: string;
  min?: number;
  max?: number;
  enum?: string[];
}

export async function listSettings(): Promise<{ settings: SettingDef[] }> {
  return fetchAPI('/settings');
}

export async function updateSetting(key: string, value: string): Promise<void> {
  await fetchAPI(`/settings/${encodeURIComponent(key)}`, {
    method: 'PUT',
    body: JSON.stringify({ value }),
  });
}

// Network discovery — Phase 1.

export type ScanState =
  | 'pending' | 'running' | 'complete'
  | 'cancelled' | 'failed' | 'promoted';
export type ScanIntensity = 'passive' | 'light' | 'full';
export type CurateState = 'pending' | 'selected' | 'ignored' | 'promoted';

export interface DiscoveryScan {
  id: string;
  createdAt: string;
  createdBy?: number;
  cidr: string;
  intensity: ScanIntensity;
  state: ScanState;
  progressTotal: number;
  progressDone: number;
  startedAt?: string;
  finishedAt?: string;
  errorMessage?: string;
  label?: string;
  internalDomain?: string;
}

// Category slugs match the backend categoryCatalogue in
// backend/internal/discovery/categories.go. Keep in sync — server-side
// validation rejects anything not in this set.
export type DiscoveryCategory =
  | 'network' | 'automation' | 'media' | 'downloads' | 'storage'
  | 'surveillance' | 'monitoring' | 'virtualization' | 'photos'
  | 'documents' | 'code' | 'auth' | 'notifications' | 'iot' | 'other';

// CATEGORY_LIST mirrors the backend catalogue order + display name + icon.
// Alphabetical by label so the dropdown is scan-able. Used by the curate
// table's per-row category picker and the promote modal's group preview.
export const CATEGORY_LIST: { slug: DiscoveryCategory; label: string; icon: string }[] = [
  { slug: 'auth',           label: 'Authentication', icon: 'mdi:lock' },
  { slug: 'code',           label: 'Code',           icon: 'mdi:source-branch' },
  { slug: 'documents',      label: 'Documents',      icon: 'mdi:file-document' },
  { slug: 'downloads',      label: 'Downloads',      icon: 'mdi:download' },
  { slug: 'iot',            label: 'IoT',            icon: 'mdi:chip' },
  { slug: 'media',          label: 'Media',          icon: 'mdi:play-circle' },
  { slug: 'monitoring',     label: 'Monitoring',     icon: 'mdi:monitor-dashboard' },
  { slug: 'network',        label: 'Network',        icon: 'mdi:lan' },
  { slug: 'notifications',  label: 'Notifications',  icon: 'mdi:bell' },
  { slug: 'other',          label: 'Other',          icon: 'mdi:application' },
  { slug: 'photos',         label: 'Photos',         icon: 'mdi:image-multiple' },
  { slug: 'automation',     label: 'Smart Home',     icon: 'mdi:home-automation' },
  { slug: 'storage',        label: 'Storage',        icon: 'mdi:nas' },
  { slug: 'surveillance',   label: 'Surveillance',   icon: 'mdi:cctv' },
  { slug: 'virtualization', label: 'Virtualization', icon: 'mdi:server' },
];

export function categoryLabel(slug: string): string {
  return CATEGORY_LIST.find((c) => c.slug === slug)?.label ?? 'Other';
}
export function categoryIcon(slug: string): string {
  return CATEGORY_LIST.find((c) => c.slug === slug)?.icon ?? 'mdi:application';
}

export interface DiscoveryResult {
  id: string;
  scanId: string;
  host: string;
  hostname?: string;
  port: number;
  detectorId: string;
  confidence: 'high' | 'medium' | 'low';
  category: DiscoveryCategory;
  suggestedName: string;
  suggestedIcon?: string;
  suggestedUrl: string;
  suggestedDesc?: string;
  rawFingerprint?: Record<string, unknown>;
  curateState: CurateState;
  curateOverrides?: Record<string, unknown>;
  createdAt: string;
}

export async function listScans(): Promise<{ scans: DiscoveryScan[] }> {
  return fetchAPI('/discovery/scans');
}

export async function createScan(input: {
  cidr: string;
  intensity?: ScanIntensity;
  label?: string;
  internalDomain?: string;
}): Promise<DiscoveryScan> {
  return fetchAPI('/discovery/scans', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function getScan(id: string, resultsSince?: string): Promise<{
  scan: DiscoveryScan;
  results: DiscoveryResult[];
  recentHosts?: string[];
  phase?: string;
  warnings?: string[];
}> {
  // Pass resultsSince as a cursor so the server only returns rows
  // newer than what we've already loaded. The first call passes
  // nothing and gets the full set; subsequent polls during a running
  // scan get only the delta.
  const q = resultsSince ? `?resultsSince=${encodeURIComponent(resultsSince)}` : '';
  return fetchAPI(`/discovery/scans/${encodeURIComponent(id)}${q}`);
}

export async function cancelScan(id: string): Promise<void> {
  await fetchAPI(`/discovery/scans/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
}

export async function deleteScan(id: string): Promise<void> {
  await fetchAPI(`/discovery/scans/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function updateScanResult(
  scanId: string,
  resultId: string,
  patch: {
    curateState?: CurateState;
    overrides?: Record<string, unknown>;
    category?: DiscoveryCategory;
  }
): Promise<void> {
  await fetchAPI(
    `/discovery/scans/${encodeURIComponent(scanId)}/results/${encodeURIComponent(resultId)}`,
    { method: 'PATCH', body: JSON.stringify(patch) }
  );
}

// PromoteTarget describes where promoted tiles should land. The admin
// picks dashboard + tab; the server distributes tiles across groups by
// their category (one group per unique category, find-or-create by
// category display name). New-dashboard implies new-tab.
export interface PromoteTarget {
  dashboardId?: string;
  newDashboard?: { name: string; path?: string };
  tabId?: string;
  newTab?: { name: string };
}

export async function promoteScan(
  scanId: string,
  target: PromoteTarget,
  resultIds: string[]
): Promise<{ promoted: number; dashboardPath?: string }> {
  return fetchAPI(`/discovery/scans/${encodeURIComponent(scanId)}/promote`, {
    method: 'POST',
    body: JSON.stringify({ target, resultIds }),
  });
}

export async function suggestDiscoveryCIDR(): Promise<{ cidr: string }> {
  return fetchAPI('/discovery/suggest-cidr');
}

// ---- Phase 4: admin-defined detectors ----

export interface DiscoveryDetector {
  id: string;
  name: string;
  icon: string;
  category: DiscoveryCategory;
  description: string;
  ports: number[];
  paths: string[];
  urlPath: string;
  bodyContains: string[];
  titleContains: string[];
  headerKeys: string[];
  // Shodan-style signed-int32 MurmurHash3 hashes of the favicon. Most
  // stable signature type — survives version bumps where titles/body
  // change. Matched after body/title/header signals.
  faviconHashes: number[];
  confidence: 'high' | 'medium';
  enabled: boolean;
  source: 'bundled' | 'user';
  // True for bundled rows whose fields reflect a saved override (the
  // admin customized this detector). UI shows a "modified" badge and
  // a Reset button. Always false for `user` rows.
  overridden?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface DiscoveryDetectorInput {
  name: string;
  icon?: string;
  category?: DiscoveryCategory;
  description?: string;
  ports: number[];
  paths?: string[];
  urlPath?: string;
  bodyContains?: string[];
  titleContains?: string[];
  headerKeys?: string[];
  faviconHashes?: number[];
  confidence?: 'high' | 'medium';
  enabled?: boolean;
}

export async function listDetectors(): Promise<{ detectors: DiscoveryDetector[] }> {
  return fetchAPI('/discovery/detectors');
}

export async function getDetector(id: string): Promise<DiscoveryDetector> {
  return fetchAPI(`/discovery/detectors/${encodeURIComponent(id)}`);
}

export async function createDetector(input: DiscoveryDetectorInput): Promise<DiscoveryDetector> {
  return fetchAPI('/discovery/detectors', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateDetector(
  id: string,
  input: DiscoveryDetectorInput
): Promise<DiscoveryDetector> {
  return fetchAPI(`/discovery/detectors/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export async function deleteDetector(id: string): Promise<void> {
  await fetchAPI(`/discovery/detectors/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// resetAllOverrides removes every customization of a bundled detector,
// restoring the shipped defaults on the next scan. Returns the number
// of overrides removed. User-defined detectors are untouched.
export async function resetAllOverrides(): Promise<{ resetCount: number }> {
  return fetchAPI('/discovery/detectors/reset-bundled', { method: 'POST' });
}

export interface DetectionSummaryEntry {
  detectorId: string;
  count: number;
  distinctHosts: number;
  lastSeen: string;
}

// getDiagnostics returns the deduplicated list of HTTP services across
// every past scan that no specific detector matched (promotion
// candidates) plus a summary of how many results each detector has
// produced across all scans (helps the admin see which detectors are
// active even when nothing is unidentified).
export async function getDiagnostics(): Promise<{
  unidentified: DiscoveryResult[];
  summary: DetectionSummaryEntry[];
}> {
  return fetchAPI('/discovery/diagnostics');
}
