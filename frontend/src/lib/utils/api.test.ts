import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getCSRFToken, withCSRFHeader, checkAuth, getConfig, getConfigFor, getDashboard, setSessionExpiredHandler } from './api';
import { KEPT_HEADER, isKept } from './swCache';

describe('getCSRFToken', () => {
	beforeEach(() => {
		// Clear cookies between tests
		document.cookie.split(';').forEach((c) => {
			const eqPos = c.indexOf('=');
			const name = eqPos > -1 ? c.substr(0, eqPos).trim() : c.trim();
			document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
		});
	});

	it('returns empty string when no CSRF cookie is set', () => {
		expect(getCSRFToken()).toBe('');
	});

	it('reads the hops_csrf cookie value', () => {
		document.cookie = 'hops_csrf=test-token-12345';
		expect(getCSRFToken()).toBe('test-token-12345');
	});

	it('handles cookies with other values present', () => {
		document.cookie = 'unrelated=foo';
		document.cookie = 'hops_csrf=mytoken';
		document.cookie = 'another=bar';
		expect(getCSRFToken()).toBe('mytoken');
	});

	it('decodes URL-encoded values', () => {
		document.cookie = 'hops_csrf=' + encodeURIComponent('token+with/special=chars');
		expect(getCSRFToken()).toBe('token+with/special=chars');
	});

	it('returns empty string when only other cookies are set', () => {
		document.cookie = 'session=abc123';
		expect(getCSRFToken()).toBe('');
	});
});

describe('withCSRFHeader', () => {
	beforeEach(() => {
		document.cookie = 'hops_csrf=csrf-test-token';
	});

	afterEach(() => {
		document.cookie = 'hops_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
	});

	it('adds X-CSRF-Token header for POST', () => {
		const headers = withCSRFHeader({}, 'POST');
		expect(headers['X-CSRF-Token']).toBe('csrf-test-token');
	});

	it('adds X-CSRF-Token header for PUT', () => {
		const headers = withCSRFHeader({}, 'PUT');
		expect(headers['X-CSRF-Token']).toBe('csrf-test-token');
	});

	it('adds X-CSRF-Token header for DELETE', () => {
		const headers = withCSRFHeader({}, 'DELETE');
		expect(headers['X-CSRF-Token']).toBe('csrf-test-token');
	});

	it('adds X-CSRF-Token header for PATCH', () => {
		const headers = withCSRFHeader({}, 'PATCH');
		expect(headers['X-CSRF-Token']).toBe('csrf-test-token');
	});

	it('handles lowercase method names', () => {
		const headers = withCSRFHeader({}, 'post');
		expect(headers['X-CSRF-Token']).toBe('csrf-test-token');
	});

	it('does NOT add header for GET requests', () => {
		const headers = withCSRFHeader({}, 'GET');
		expect(headers['X-CSRF-Token']).toBeUndefined();
	});

	it('does NOT add header for HEAD requests', () => {
		const headers = withCSRFHeader({}, 'HEAD');
		expect(headers['X-CSRF-Token']).toBeUndefined();
	});

	it('does NOT add header when no method specified', () => {
		const headers = withCSRFHeader({});
		expect(headers['X-CSRF-Token']).toBeUndefined();
	});

	it('preserves existing headers', () => {
		const headers = withCSRFHeader({ 'Content-Type': 'application/json' }, 'POST');
		expect(headers['Content-Type']).toBe('application/json');
		expect(headers['X-CSRF-Token']).toBe('csrf-test-token');
	});

	it('does not mutate the input headers object', () => {
		const input = { 'Content-Type': 'application/json' };
		withCSRFHeader(input, 'POST');
		expect(input).not.toHaveProperty('X-CSRF-Token');
	});

	it('skips header when CSRF cookie is missing', () => {
		document.cookie = 'hops_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
		const headers = withCSRFHeader({}, 'POST');
		expect(headers['X-CSRF-Token']).toBeUndefined();
	});
});

describe('checkAuth', () => {
	afterEach(() => vi.unstubAllGlobals());
	const answer = (status: number, body: unknown) =>
		vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })));

	it("can't reach the server: unknown, not signed out", async () => {
		vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
		expect(await checkAuth()).toEqual({ authenticated: false, mustChangePassword: false, unknown: true });
	});
	it.each([502, 503, 504])('a proxy with the backend down (%i): unknown', async (status) => {
		answer(status, {});
		expect(await checkAuth()).toEqual({ authenticated: false, mustChangePassword: false, unknown: true });
	});
	it("HOPS's own 500: its sentence, and not called unreachable", async () => {
		answer(500, { error: 'Signed in, but the server could not issue a CSRF token.' });
		expect(await checkAuth()).toEqual({
			authenticated: false, mustChangePassword: false, failure: 'Signed in, but the server could not issue a CSRF token.'
		});
	});
	it.each([403, 404, 429])("a proxy's %i with no sentence of its own: reached, and failed", async (status) => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>nope</html>', { status })));
		const r = await checkAuth();
		expect(r.unknown).toBeUndefined();
		expect(r.failure).toBe(`The server answered ${status}.`);
	});
	it('a 200 that is not the answer (a redirect to a login page): a failure, not a network fault', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>Sign in to the proxy</html>', { status: 200 })));
		const r = await checkAuth();
		expect(r.unknown).toBeUndefined();
		expect(r.authenticated).toBe(false);
		expect(r.failure).toContain('proxy');
	});
	it('a 200 that is JSON without the answer, or empty: the same', async () => {
		answer(200, { ok: true });
		expect((await checkAuth()).failure).toBeTruthy();
		vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })));
		expect((await checkAuth()).failure).toBeTruthy();
	});
	it('the server says signed out: signed out', async () => {
		answer(200, { authenticated: false });
		expect(await checkAuth()).toEqual({ authenticated: false, mustChangePassword: false });
	});
	it('a real 401: signed out, and the session-expired handler hears', async () => {
		const expired = vi.fn();
		setSessionExpiredHandler(expired);
		answer(401, { error: 'unauthorized' });
		expect(await checkAuth()).toEqual({ authenticated: false, mustChangePassword: false });
		expect(expired).toHaveBeenCalledTimes(1);
	});
	it('signed in', async () => {
		answer(200, { authenticated: true, mustChangePassword: true });
		expect(await checkAuth()).toEqual({ authenticated: true, mustChangePassword: true });
	});
});

describe('kept answers from the service worker', () => {
	afterEach(() => vi.unstubAllGlobals());
	const serve = (body: unknown, kept: boolean) =>
		vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: kept ? { [KEPT_HEADER]: '1' } : {} })));
	const dash = { id: 'a', name: 'A', tabs: [] };
	const doc = { schemaVersion: 3, layoutVersion: 2, dashboards: [dash] };

	it('every config read says so', async () => {
		serve(doc, true);
		expect(isKept(await getConfig())).toBe(true);
		expect(isKept((await getConfigFor('a')).config)).toBe(true);
		serve({ dashboard: dash, revision: 1, configRevision: 'r' }, true);
		expect(isKept(await getDashboard('a'))).toBe(true);
	});
	it("the server's own answers are not kept", async () => {
		serve(doc, false);
		expect(isKept(await getConfig())).toBe(false);
		expect(isKept((await getConfigFor('a')).config)).toBe(false);
	});
});
