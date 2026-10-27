import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isValidUrl, safeOpenUrl, safeFrameUrl, tileUrlProblem } from './url';
import { openSshInPlace } from './ssh';

describe('isValidUrl', () => {
	it('accepts standard https URLs', () => {
		expect(isValidUrl('https://example.com')).toBe(true);
		expect(isValidUrl('https://example.com/path?q=1')).toBe(true);
	});

	it('accepts http URLs', () => {
		expect(isValidUrl('http://example.com')).toBe(true);
	});

	it('accepts other safe protocols', () => {
		expect(isValidUrl('ftp://example.com')).toBe(true);
		expect(isValidUrl('ssh://server')).toBe(true);
		expect(isValidUrl('mailto:user@example.com')).toBe(true);
	});

	it('accepts protocol-relative URLs', () => {
		expect(isValidUrl('//example.com')).toBe(true);
	});

	it('accepts relative paths', () => {
		expect(isValidUrl('/admin')).toBe(true);
		expect(isValidUrl('/path/to/resource')).toBe(true);
	});

	it('accepts bare hostnames', () => {
		expect(isValidUrl('example.com')).toBe(true);
		expect(isValidUrl('subdomain.example.com:8080')).toBe(true);
	});

	it('rejects empty input', () => {
		expect(isValidUrl('')).toBe(false);
		expect(isValidUrl('   ')).toBe(false);
	});

	it('rejects non-string input', () => {
		expect(isValidUrl(null as unknown as string)).toBe(false);
		expect(isValidUrl(undefined as unknown as string)).toBe(false);
	});

	it('blocks javascript: URLs (XSS vector)', () => {
		expect(isValidUrl('javascript:alert(1)')).toBe(false);
		expect(isValidUrl('JavaScript:alert(1)')).toBe(false);
		expect(isValidUrl('  javascript:alert(1)')).toBe(false);
	});

	it('blocks data: URLs (can carry executable content)', () => {
		expect(isValidUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
	});

	it('blocks vbscript: URLs', () => {
		expect(isValidUrl('vbscript:msgbox(1)')).toBe(false);
	});

	it('rejects malformed URLs', () => {
		expect(isValidUrl('https://[not-valid')).toBe(false);
	});
});

describe('safeOpenUrl', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it('opens valid URL in new tab with security flags', () => {
		const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

		const result = safeOpenUrl('https://example.com');

		expect(result).toBe(true);
		expect(openSpy).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener,noreferrer');
	});

	it('normalizes bare hostnames to https', () => {
		const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

		safeOpenUrl('example.com');

		expect(openSpy).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener,noreferrer');
	});

	it('navigates same tab when target is _self', () => {
		// jsdom doesn't allow setting window.location.href directly in newer versions,
		// so we just verify the function returns success without throwing.
		// (The implementation calls window.location.href = ...)
		try {
			const result = safeOpenUrl('https://example.com', '_self');
			expect(result).toBe(true);
		} catch (e) {
			// jsdom may throw on navigation; that's fine — the important thing is
			// that we got past validation. Re-throw if it's not a navigation error.
			if (!(e instanceof Error) || !e.message.includes('navigation')) {
				throw e;
			}
		}
	});

	it('refuses to open invalid URLs', () => {
		const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

		const result = safeOpenUrl('javascript:alert(1)');

		expect(result).toBe(false);
		expect(openSpy).not.toHaveBeenCalled();
	});

	it('refuses empty URLs', () => {
		const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

		expect(safeOpenUrl('')).toBe(false);
		expect(openSpy).not.toHaveBeenCalled();
	});
});

// Pentest L1: every open helper refuses javascript: and data:; the iframe and
// popup helper allows only http(s).
describe('open helpers refuse unsafe schemes (L1)', () => {
	const unsafe = ['javascript:alert(document.domain)', ' JaVaScRiPt:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:x'];

	it('safeFrameUrl allows only http(s)', () => {
		expect(safeFrameUrl('https://nas.lan/x')).toBe('https://nas.lan/x');
		expect(safeFrameUrl('http://10.0.0.1:8080')).toBe('http://10.0.0.1:8080');
		expect(safeFrameUrl('nas.lan')).toBe('https://nas.lan');
		expect(safeFrameUrl('/local')).toBe('/local');
		for (const u of [...unsafe, 'ssh://me@nas', 'ftp://files', 'mailto:a@b.c', 'file:///etc/passwd', '', null, undefined]) {
			expect(safeFrameUrl(u as string), String(u)).toBeNull();
		}
	});

	it('safeOpenUrl never opens javascript: or data:', () => {
		const open = vi.spyOn(window, 'open').mockImplementation(() => null);
		for (const u of unsafe) expect(safeOpenUrl(u, '_blank')).toBe(false);
		expect(open).not.toHaveBeenCalled();
		open.mockRestore();
	});

	it('openSshInPlace opens only a valid ssh:// address', () => {
		expect(openSshInPlace('javascript:alert(1)')).toBe(false);
		expect(openSshInPlace('data:text/html,x')).toBe(false);
		expect(openSshInPlace('https://x')).toBe(false);
	});

	it('tileUrlProblem names blank and unsafe addresses', () => {
		expect(tileUrlProblem('https://x')).toBeNull();
		expect(tileUrlProblem('')).toBe('blank');
		expect(tileUrlProblem('  ')).toBe('blank');
		for (const u of unsafe) expect(tileUrlProblem(u)).toBe('unsafe');
	});
});
