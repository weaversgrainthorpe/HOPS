import { describe, it, expect, vi, afterEach } from 'vitest';
import { bytesToMBText, formatMB, parseMBInput, uploadTooLargeMessage, checkUploadSize, uploadErrorMessage, MB } from './uploadLimits';

// M5 §10: upload limits are shown and typed in MB, and an oversize file is refused with a
// message naming the limit and the file's size.

afterEach(() => vi.unstubAllGlobals());

describe('MB conversion', () => {
	it('shows bytes as MB without needless decimals', () => {
		expect(bytesToMBText(String(50 * MB))).toBe('50');
		expect(bytesToMBText(String(1.5 * MB))).toBe('1.5');
		expect(bytesToMBText('5000000')).toBe('4.77');
		expect(formatMB(2 * MB)).toBe('2 MB');
		expect(formatMB(1.5 * MB)).toBe('1.5 MB');
	});

	it('parses MB input into bytes within the bounds', () => {
		const bounds = { min: MB, max: 200 * MB };
		expect(parseMBInput('50', bounds)).toEqual({ ok: true, bytes: 50 * MB });
		expect(parseMBInput(' 1.5 ', bounds)).toEqual({ ok: true, bytes: 1.5 * MB });
		expect(parseMBInput('1', bounds)).toEqual({ ok: true, bytes: MB });
	});

	it('refuses a value below 1 MB, empty or invalid', () => {
		const bounds = { min: MB, max: 200 * MB };
		for (const bad of ['0.5', '0', '-3', '', '   ', 'abc', '1e', 'NaN']) {
			const r = parseMBInput(bad, bounds);
			expect(r.ok, bad).toBe(false);
			if (!r.ok) expect(r.error, bad).toBe('Must be at least 1 MB');
		}
	});

	it('refuses a value above the ceiling, naming it', () => {
		const r = parseMBInput('250', { min: MB, max: 200 * MB });
		expect(r).toEqual({ ok: false, error: 'Can be at most 200 MB' });
	});
});

describe('oversize uploads', () => {
	it('the message names the size and the limit', () => {
		const m = uploadTooLargeMessage('icon', 3 * MB, 2 * MB);
		expect(m).toContain('3 MB');
		expect(m).toContain('2 MB');
		expect(m).toContain('largest icon file');
	});

	it('checkUploadSize refuses a file over the current limit and passes one under it', async () => {
		const fetchMock = vi.fn(async () => new Response(JSON.stringify({ import: 50 * MB, background: 25 * MB, icon: 2 * MB }), { status: 200 }));
		vi.stubGlobal('fetch', fetchMock);
		const big = { size: 3 * MB } as File;
		const small = { size: MB } as File;
		expect(await checkUploadSize('icon', big)).toMatch(/3 MB.*2 MB/);
		expect(await checkUploadSize('icon', small)).toBeNull();
		expect(await checkUploadSize('background', big)).toBeNull();
	});

	it('checkUploadSize lets the server decide when the limits cannot be read', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
		expect(await checkUploadSize('icon', { size: 100 * MB } as File)).toBeNull();
	});

	it('uploadErrorMessage shows the server sentence, not raw JSON', async () => {
		const r = new Response(JSON.stringify({ error: 'This file is 3 MB, but the largest icon file allowed is 2 MB.', status: 413 }), { status: 413 });
		expect(await uploadErrorMessage(r, 'Upload failed')).toBe('This file is 3 MB, but the largest icon file allowed is 2 MB.');
		expect(await uploadErrorMessage(new Response('', { status: 413 }), 'Upload failed')).toBe('That file is bigger than the upload limit.');
		expect(await uploadErrorMessage(new Response('boom', { status: 500 }), 'Upload failed')).toBe('Upload failed: boom');
	});
});
