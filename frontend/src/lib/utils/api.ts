import type { Config, DashboardSettings } from '$lib/types';
import type { LayoutDoc, LayoutDashboard } from '$lib/types/layout';
import type { ImportResult } from './importResult';
import { LAYOUT_VERSION } from '$lib/layout/geometry';
import { checkUploadSize, uploadErrorMessage, sendUpload } from './uploadLimits';

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

/** 409 from a revision-checked save: the dashboard changed elsewhere. */
export class ConflictError extends Error {
  dashboardId: string;
  currentRevision: number;
  constructor(dashboardId: string, currentRevision: number, message?: string) {
    super(message || 'This dashboard was changed somewhere else, so your last change was not saved.');
    this.name = 'ConflictError';
    this.dashboardId = dashboardId;
    this.currentRevision = currentRevision;
  }
}

/** 503 migration_failed: the stored config could not be migrated to v3. */
export class MigrationFailedError extends Error {
  detail: string;
  constructor(detail: string) {
    super(detail || 'Configuration migration failed');
    this.name = 'MigrationFailedError';
    this.detail = detail;
  }
}

/** Fallback text for a 409 layout_version_mismatch whose body has no detail. */
const LAYOUT_VERSION_REFUSED = 'HOPS was updated since this page was loaded, so this change was not saved. Reload the page, then make the change again.';

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
    let parsedBody: Record<string, unknown> | null = null;
    try {
      const text = await response.text();
      if (text) {
        try {
          const parsed = JSON.parse(text);
          if (parsed && typeof parsed === 'object') parsedBody = parsed;
          if (parsed && typeof parsed.error === 'string') serverMsg = parsed.error;
        } catch { /* not JSON — leave serverMsg empty */ }
      }
    } catch { /* body unreadable */ }
    if (response.status === 409 && parsedBody?.error === 'conflict') {
      throw new ConflictError(
        String(parsedBody.dashboardId ?? ''),
        Number(parsedBody.currentRevision ?? 0),
        typeof parsedBody.detail === 'string' ? parsedBody.detail : undefined
      );
    }
    // M5 §2a: a placement-carrying write at another layoutVersion (this page predates the server's
    // layout) is refused; never a revision conflict, and always says to reload.
    if (response.status === 409 && parsedBody?.error === 'layout_version_mismatch') {
      throw new Error(typeof parsedBody.detail === 'string' && parsedBody.detail ? parsedBody.detail : LAYOUT_VERSION_REFUSED);
    }
    // path_taken (and other 409s with a sentence): show the server's detail.
    if (response.status === 409 && typeof parsedBody?.detail === 'string' && parsedBody.detail) {
      throw new Error(parsedBody.detail);
    }
    if (response.status === 503 && parsedBody?.error === 'migration_failed') {
      throw new MigrationFailedError(typeof parsedBody.detail === 'string' ? parsedBody.detail : '');
    }
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

/** An HTTP error answer, carrying its status (the status probe tells a down proxy from a backend error). */
export class HttpStatusError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'HttpStatusError';
  }
}

/**
 * GET /api/version, the backend status probe. A network failure rejects with fetch's TypeError; an
 * error answer rejects with HttpStatusError (its status says whether a proxy found the backend down).
 */
export async function getBackendVersion(): Promise<{ version?: string }> {
  const response = await fetch(`${API_BASE}/version`, { credentials: 'same-origin' });
  if (!response.ok) throw new HttpStatusError(`The server answered ${response.status}`, response.status);
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {}; // not JSON: no version, shown as degraded
  }
}

/**
 * GET /api/config: the stored v3 document. Anything that is not a schema-3
 * document with a dashboards list is a visible error, never shown as an
 * empty or partial dashboard set.
 */
export async function getConfig(): Promise<Config> {
  const resp = await fetchAPI('/config');
  if (!resp || typeof resp !== 'object' || resp.schemaVersion !== 3 || !Array.isArray(resp.dashboards)) {
    throw new Error('The server sent a configuration this version of HOPS cannot read (expected schema 3 dashboards). Reload the page; if it persists, check the server.');
  }
  const out: Config = { schemaVersion: 3, dashboards: resp.dashboards };
  // The layout version (M5 §2a) is passed through as sent: the editor refuses to save into a
  // document at another version, so it must never be dropped (or invented) here.
  if (resp.layoutVersion !== undefined) out.layoutVersion = resp.layoutVersion;
  if (Array.isArray(resp.migrationNotices)) out.migrationNotices = resp.migrationNotices;
  if (resp.notices !== undefined) {
    // A notice this build cannot read is dropped from the list but counted, so the banner
    // says so; it never fails the whole load (the dashboards still show).
    const list: unknown[] = Array.isArray(resp.notices) ? resp.notices : [resp.notices];
    const good = list.filter(
      (n): n is { id: string; text: string } =>
        !!n && typeof (n as { id?: unknown }).id === 'string' && typeof (n as { text?: unknown }).text === 'string'
    );
    out.notices = good.map((n) => {
      const raw = n as { level?: unknown; sticky?: unknown };
      return {
        id: n.id,
        text: n.text,
        ...(raw.level === 'warning' ? { level: 'warning' as const } : {}),
        ...(raw.sticky === true ? { sticky: true } : {})
      };
    });
    const bad = list.length - good.length;
    if (!Array.isArray(resp.notices) || bad > 0) {
      out.noticesUnreadable = Array.isArray(resp.notices) ? bad : 1;
      console.error('GET /api/config: unreadable notices', resp.notices);
    }
  }
  return out;
}

/** POST /api/notices/{id}/dismiss: the dismissal is stored, so the notice stays gone. */
export async function dismissNotice(id: string): Promise<void> {
  await fetchAPI(`/notices/${encodeURIComponent(id)}/dismiss`, { method: 'POST' });
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

/**
 * The fresh document every successful dashboard write returns (`layout`, the
 * committed document as GET /api/config serves it). A response without one is
 * passed on without it so the caller marks the held document stale rather
 * than trusting it.
 */
export interface FreshLayout {
  layout?: LayoutDoc;
}

function freshOf(resp: { layout?: unknown } | null | undefined): FreshLayout {
  const l = resp?.layout as LayoutDoc | undefined;
  return l && typeof l === 'object' && Array.isArray(l.dashboards) ? { layout: l } : {};
}

/** `warning`: the pre-update backup failed but the write went through. */
function warningOf(resp: { warning?: unknown } | null | undefined): { warning?: string } {
  return resp && typeof resp.warning === 'string' && resp.warning ? { warning: resp.warning } : {};
}

/** Create a dashboard: POST /api/dashboards {name, path} (409 path_taken when the path is used). */
export async function createDashboard(
  name: string,
  path: string
): Promise<{ id: string; revision: number; warning?: string } & FreshLayout> {
  const resp = await fetchAPI('/dashboards', { method: 'POST', body: JSON.stringify({ name, path }) });
  if (!resp || typeof resp.id !== 'string' || !resp.id || typeof resp.revision !== 'number') {
    throw new Error('The server did not confirm the new dashboard.');
  }
  return { id: resp.id, revision: resp.revision, ...warningOf(resp), ...freshOf(resp) };
}

/** Reorder the dashboards: PUT /api/dashboards/order {order: [every id once]}. */
export async function reorderDashboards(order: string[]): Promise<{ warning?: string } & FreshLayout> {
  const resp = await fetchAPI('/dashboards/order', { method: 'PUT', body: JSON.stringify({ order }) });
  return { ...warningOf(resp), ...freshOf(resp) };
}

/**
 * Revision-checked save of one v3 dashboard (an edit session's draft):
 * PUT /api/dashboards/{id} with `{schema: 3, dashboard, revision}`. A 409
 * surfaces as ConflictError and a 503 as MigrationFailedError (fetchAPI); a
 * 400 carries the server's message. The response's fresh layout is returned
 * when present; a response without one is passed on without it so the caller
 * can mark the held layout stale rather than trust it.
 */
export async function saveDashboardV3(
  id: string,
  dashboard: LayoutDashboard,
  revision: number
): Promise<{ revision: number; warning?: string } & FreshLayout> {
  const resp = await fetchAPI(`/dashboards/${encodeURIComponent(id)}`, {
    method: 'PUT',
    // layoutVersion: the layout form this page's placements are in. The server refuses a write at
    // another version (M5 §2a), so a page loaded before a layout change can never store an old form.
    body: JSON.stringify({ schema: 3, dashboard, revision, layoutVersion: LAYOUT_VERSION }),
  });
  if (!resp || typeof resp.revision !== 'number') {
    throw new Error('The server did not confirm the new dashboard revision.');
  }
  return { revision: resp.revision, ...warningOf(resp), ...freshOf(resp) };
}

export interface TransferRequest {
  mode: 'move' | 'copy';
  sourceId: string;
  sourceRevision: number;
  nodeIds: string[];
  targetId: string;
  targetRevision: number;
  target: { tabId: string; folderId?: string };
}

/**
 * Move or copy tiles/folders from one dashboard to ANOTHER in one server
 * transaction: POST /api/dashboards/transfer. Both revisions are checked (a
 * 409 surfaces as ConflictError); the server places the items at free cells
 * of the target container. Returns both new revisions and, when present, the
 * fresh layout.
 */
export async function transferNodes(
  req: TransferRequest
): Promise<{ sourceRevision: number; targetRevision: number; warning?: string } & FreshLayout> {
  const body: TransferRequest = { ...req, target: { tabId: req.target.tabId } };
  if (req.target.folderId) body.target.folderId = req.target.folderId;
  // layoutVersion: see saveDashboardV3 (M5 §2a).
  const resp = await fetchAPI('/dashboards/transfer', {
    method: 'POST',
    body: JSON.stringify({ ...body, layoutVersion: LAYOUT_VERSION }),
  });
  if (!resp || typeof resp.sourceRevision !== 'number' || typeof resp.targetRevision !== 'number') {
    throw new Error('The server did not confirm the new dashboard revisions.');
  }
  return { sourceRevision: resp.sourceRevision, targetRevision: resp.targetRevision, ...warningOf(resp), ...freshOf(resp) };
}

/**
 * Revision-checked delete of one dashboard: DELETE
 * /api/dashboards/{id}?revision=n. Returns the fresh document.
 */
export async function deleteDashboard(
  id: string,
  revision: number
): Promise<{ warning?: string } & FreshLayout> {
  const resp = await fetchAPI(
    `/dashboards/${encodeURIComponent(id)}?revision=${encodeURIComponent(String(revision))}`,
    { method: 'DELETE' }
  );
  return { ...warningOf(resp), ...freshOf(resp) };
}

/** Resolved per-dashboard settings (what actually applies). */
export interface EffectiveDashboardSettings {
  statusChecksEnabled: boolean;
  statusCheckIntervalMinutes: number;
  statusCheckTimeoutSeconds: number;
  editIdleTimeoutMinutes: number;
  animatedFolderBackgrounds: boolean;
}

export interface DashboardSettingsResponse {
  overrides: DashboardSettings;
  effective: EffectiveDashboardSettings;
  revision: number;
}

/** GET /api/dashboards/{id}/settings: overrides (null = inherit) + effective values. */
export async function getDashboardSettings(id: string): Promise<DashboardSettingsResponse> {
  const resp = await fetchAPI(`/dashboards/${encodeURIComponent(id)}/settings`);
  if (!resp || typeof resp.overrides !== 'object' || typeof resp.effective !== 'object' || typeof resp.revision !== 'number') {
    throw new Error('The server returned an unexpected settings response.');
  }
  return resp as DashboardSettingsResponse;
}

/**
 * PUT /api/dashboards/{id}/settings. Merge semantics: absent key = unchanged,
 * explicit null = reset to inherit.
 */
export async function saveDashboardSettings(
  id: string,
  overrides: Partial<Record<keyof DashboardSettings, string | number | boolean | null>>,
  revision: number
): Promise<{ revision: number } & FreshLayout> {
  const resp = await fetchAPI(`/dashboards/${encodeURIComponent(id)}/settings`, {
    method: 'PUT',
    body: JSON.stringify({ overrides, revision }),
  });
  if (!resp || typeof resp.revision !== 'number') {
    throw new Error('The server did not confirm the new settings revision.');
  }
  return { revision: resp.revision, ...freshOf(resp) };
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

export async function importConfig(file: File, options?: { autoMatchIcons?: boolean }): Promise<ImportResult> {
  // M5 §10: a file over the import limit is refused before it is sent, naming the limit and its size.
  const refusal = await checkUploadSize('import', file);
  if (refusal) throw new Error(refusal);
  const formData = new FormData();
  formData.append('file', file);
  if (options?.autoMatchIcons) {
    formData.append('autoMatchIcons', 'true');
  }

  const response = await sendUpload(`${API_BASE}/config/import`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: withCSRFHeader({}, 'POST'),
    body: formData,
  });

  if (!response.ok) {
    throw new Error(await uploadErrorMessage(response, 'Import failed'));
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
  const refusal = await checkUploadSize('icon', file);
  if (refusal) throw new Error(refusal);
  const formData = new FormData();
  formData.append('file', file);

  const response = await sendUpload(`${API_BASE}/icons/upload`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: withCSRFHeader({}, 'POST'),
    body: formData,
  });

  if (!response.ok) {
    throw new Error(await uploadErrorMessage(response, 'Upload failed'));
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
  const refusal = await checkUploadSize('background', file);
  if (refusal) throw new Error(refusal);
  const formData = new FormData();
  formData.append('file', file);
  formData.append('category', category);

  const response = await sendUpload(`${API_BASE}/backgrounds`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: withCSRFHeader({}, 'POST'),
    body: formData,
  });

  if (!response.ok) {
    throw new Error(await uploadErrorMessage(response, 'Upload failed'));
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

export async function resetConfig(): Promise<unknown> {
  return fetchAPI('/config/reset', { method: 'POST' });
}

// Backup API calls

export interface BackupInfo {
  name: string;
  path: string;
  size: number;
  createdAt: string;
  /** Never deleted automatically (before an upgrade, manual, uploaded): "kept until you delete it". */
  protected?: boolean;
}

/** The retention settings (M6 §11) as the server applies them. */
export interface BackupRetention {
  keepCount: number;
  keepDays: number;
  maxCount: number;
}

/** One backup "Clean up now" would delete, and why. */
export interface CleanupDeletion {
  name: string;
  createdAt: string;
  size: number;
  reason: string;
  overCeiling: boolean;
}

/** A backup failure the admin must see (GET /api/backups `problems`); stays until fixed. */
export interface BackupProblem {
  kind: 'backup-failed' | 'rotation-failed' | 'restore-failed' | string;
  trigger?: string;
  at: string;
  reason: string;
}

export interface BackupList {
  backups: BackupInfo[];
  problems: BackupProblem[];
  retention?: BackupRetention;
  /** A restore is staged but not yet applied (HOPS hasn't restarted). */
  pendingRestore?: boolean;
}

export async function listBackups(): Promise<BackupList> {
  const resp = await fetchAPI('/backups');
  if (!resp || !Array.isArray(resp.backups)) {
    throw new Error('The server sent a backup list this version of HOPS cannot read.');
  }
  return {
    backups: resp.backups,
    problems: Array.isArray(resp.problems) ? resp.problems : [],
    ...(resp.retention && typeof resp.retention.keepCount === 'number' ? { retention: resp.retention } : {}),
    ...(resp.pendingRestore === true ? { pendingRestore: true } : {})
  };
}

/** Discard a staged restore that hasn't been applied yet (nothing is restored). */
export async function discardPendingRestore(): Promise<void> {
  await fetchAPI('/backups/pending-restore', { method: 'DELETE' });
}

/** Where a backup downloads from (GET, admin session cookie). */
export function backupDownloadUrl(name: string): string {
  return `${API_BASE}/backups/${encodeURIComponent(name)}`;
}

/** What "Clean up now" would delete, and why (nothing is deleted). */
export async function previewBackupCleanup(): Promise<CleanupDeletion[]> {
  const resp = await fetchAPI('/backups/cleanup');
  if (!resp || !Array.isArray(resp.deletions)) throw new Error('The server sent a cleanup preview this version of HOPS cannot read.');
  return resp.deletions;
}

/**
 * Delete the confirmed backups (the server deletes only those its rules still delete). A partial
 * failure is thrown with the server's reason, never reported as done.
 */
export async function confirmBackupCleanup(names: string[]): Promise<string[]> {
  const resp = await fetchAPI('/backups/cleanup', { method: 'POST', body: JSON.stringify({ names }) });
  if (!resp || !Array.isArray(resp.deleted)) throw new Error('The server did not confirm the cleanup.');
  if (typeof resp.error === 'string' && resp.error) {
    throw new Error(`${resp.error} (${resp.deleted.length} deleted)`);
  }
  return resp.deleted;
}

/**
 * Upload a backup file: stored as a new "…_uploaded" backup, never restored automatically. It
 * shares the import size limit, refused before sending when over it.
 */
export async function uploadBackup(file: File): Promise<{ name: string; message: string }> {
  const refusal = await checkUploadSize('import', file);
  if (refusal) throw new Error(refusal);
  const formData = new FormData();
  formData.append('file', file);
  const response = await sendUpload(`${API_BASE}/backups/upload`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: withCSRFHeader({}, 'POST'),
    body: formData,
  });
  if (!response.ok) {
    throw new Error(await uploadErrorMessage(response, 'Upload failed'));
  }
  const resp = await response.json();
  if (!resp || typeof resp.name !== 'string') throw new Error('The server did not confirm the upload.');
  return { name: resp.name, message: typeof resp.message === 'string' ? resp.message : 'Backup uploaded' };
}

export async function createBackup(reason?: string): Promise<{ success: boolean; path: string; message: string }> {
  return fetchAPI('/backups', {
    method: 'POST',
    body: JSON.stringify({ reason: reason || 'manual' }),
  });
}

export async function restoreBackup(backupName: string): Promise<{ success: boolean; message: string; restarting?: boolean }> {
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
// type ("int", "bool", "log_level", "cidr_list", "duration_seconds", ...), default,
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
  /** The out-of-range value that was stored, when the server clamped it on load (M5 §10). */
  adjustedFrom?: string;
}

export async function listSettings(): Promise<{ settings: SettingDef[] }> {
  return fetchAPI('/settings');
}

export async function updateSetting(key: string, value: string | number): Promise<void> {
  // Coerce to string at the boundary. Svelte's `bind:value` on
  // <input type="number"> writes a JS number (or null) into the bound
  // store regardless of TypeScript annotations, so without this guard
  // numeric settings serialise as {"value":28} (JSON number) and the
  // server's `Value string` decoder rejects them with "Invalid JSON body".
  // String(null) becomes "null" which fails server-side validation with
  // a real "not an integer" message instead of the cryptic decode error.
  await fetchAPI(`/settings/${encodeURIComponent(key)}`, {
    method: 'PUT',
    body: JSON.stringify({ value: String(value) }),
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
  | 'ai' | 'network' | 'automation' | 'media' | 'downloads' | 'storage'
  | 'surveillance' | 'monitoring' | 'virtualization' | 'photos'
  | 'documents' | 'code' | 'auth' | 'notifications' | 'iot' | 'other';

// CATEGORY_LIST mirrors the backend catalogue order + display name + icon.
// Alphabetical by label so the dropdown is scan-able. Used by the curate
// table's per-row category picker and the promote modal's group preview.
export const CATEGORY_LIST: { slug: DiscoveryCategory; label: string; icon: string }[] = [
  { slug: 'ai',             label: 'AI',             icon: 'mdi:robot' },
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

// PromoteTarget describes where promoted tiles should land: a dashboard and
// tab (existing or new; a new dashboard implies a new tab) and optionally an
// existing folder (any depth) of an existing tab that takes every tile.
// Without a folder the server puts the tiles in one folder per category at
// the tab's root (reusing a root folder with that category's name).
export interface PromoteTarget {
  dashboardId?: string;
  newDashboard?: { name: string; path?: string };
  tabId?: string;
  newTab?: { name: string };
  folderId?: string;
}

export async function promoteScan(
  scanId: string,
  target: PromoteTarget,
  resultIds: string[]
): Promise<{ promoted: number; dashboardPath?: string; warning?: string } & FreshLayout> {
  const resp = await fetchAPI(`/discovery/scans/${encodeURIComponent(scanId)}/promote`, {
    method: 'POST',
    body: JSON.stringify({ target, resultIds }),
  });
  if (!resp || typeof resp.promoted !== 'number') {
    throw new Error('The server did not confirm the promotion.');
  }
  return {
    promoted: resp.promoted,
    ...(typeof resp.dashboardPath === 'string' ? { dashboardPath: resp.dashboardPath } : {}),
    ...warningOf(resp),
    ...freshOf(resp)
  };
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
