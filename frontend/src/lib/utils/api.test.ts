import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getCSRFToken, withCSRFHeader } from './api';

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
