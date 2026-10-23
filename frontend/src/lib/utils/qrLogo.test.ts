import { describe, it, expect } from 'vitest';
import QRCode from 'qrcode';
import { buildQrSvg, QR_ERROR_CORRECTION, LOGO_FRACTION, BACKING_FRACTION } from './qrLogo';

// M5 §12: the dashboard QR code carries a small HOPS bunny in its centre, on a white rounded
// square, inside the generated SVG (so the download has it), at error-correction level H.

const URL_ = 'http://172.16.0.50:8080/d/home-lab';

function parse(svg: string): Document {
	return new DOMParser().parseFromString(svg, 'image/svg+xml');
}

function viewBoxSize(doc: Document): number {
	const vb = doc.documentElement.getAttribute('viewBox')!.split(/\s+/).map(Number);
	expect(vb[0]).toBe(0);
	expect(vb[1]).toBe(0);
	expect(vb[2]).toBe(vb[3]);
	return vb[2];
}

describe('buildQrSvg', () => {
	it('uses error-correction level H', async () => {
		expect(QR_ERROR_CORRECTION).toBe('H');
		const svg = await buildQrSvg(URL_);
		// Its modules are exactly the level-H code for the URL (and not the level-M one).
		const h = await QRCode.toString(URL_, { type: 'svg', width: 320, margin: 1, errorCorrectionLevel: 'H' });
		const m = await QRCode.toString(URL_, { type: 'svg', width: 320, margin: 1, errorCorrectionLevel: 'M' });
		const modules = (s: string) => parse(s).querySelector('path[stroke]')!.getAttribute('d');
		expect(modules(svg)).toBe(modules(h));
		expect(modules(svg)).not.toBe(modules(m));
	});

	it('centres the bunny, no wider than 20% of the code, on a white rounded backing behind it', async () => {
		const doc = parse(await buildQrSvg(URL_));
		const n = viewBoxSize(doc);
		const logo = doc.querySelector('svg[data-qr-logo]')!;
		const backing = doc.querySelector('rect[data-qr-backing]')!;
		expect(logo, 'the logo is inside the QR SVG').not.toBeNull();
		expect(backing, 'the backing is inside the QR SVG').not.toBeNull();

		const box = (el: Element) => ['x', 'y', 'width', 'height'].map((a) => Number(el.getAttribute(a)));
		const [lx, ly, lw, lh] = box(logo);
		const [bx, by, bw, bh] = box(backing);
		// Centred.
		expect(lx + lw / 2).toBeCloseTo(n / 2, 6);
		expect(ly + lh / 2).toBeCloseTo(n / 2, 6);
		expect(bx + bw / 2).toBeCloseTo(n / 2, 6);
		expect(by + bh / 2).toBeCloseTo(n / 2, 6);
		// Small: the logo ≤ 20% of the width, and the backing (all it hides) ≤ 20% too, so at most 4% of the area.
		expect(lw).toBeLessThanOrEqual(0.2 * n);
		expect(lh).toBe(lw);
		expect(bw).toBeLessThanOrEqual(0.2 * n + 1e-9);
		expect(bw * bh).toBeLessThanOrEqual(0.04 * n * n + 1e-9);
		expect(LOGO_FRACTION).toBeLessThan(BACKING_FRACTION);
		// The backing is white, rounded, and leaves a quiet margin round the logo.
		expect(backing.getAttribute('fill')).toBe('#ffffff');
		expect(Number(backing.getAttribute('rx'))).toBeGreaterThan(0);
		expect(lx).toBeGreaterThan(bx);
		expect(lx + lw).toBeLessThan(bx + bw);
		// Behind it: the backing comes before the logo in document order (painted first),
		// and both come after the modules.
		const all = Array.from(doc.querySelectorAll('*'));
		const modules = doc.querySelector('path[stroke]')!;
		expect(all.indexOf(modules)).toBeLessThan(all.indexOf(backing));
		expect(all.indexOf(backing)).toBeLessThan(all.indexOf(logo));
	});

	it('the logo is the HOPS bunny, still (no animation), with ids that cannot clash with the page', async () => {
		const svg = await buildQrSvg(URL_);
		const doc = parse(svg);
		const logo = doc.querySelector('svg[data-qr-logo]')!;
		expect(logo.getAttribute('viewBox')).toBe('0 0 200 200');
		expect(logo.querySelector('#hopsqr-bunnyGradient')).not.toBeNull();
		expect(svg).not.toMatch(/url\(#bunnyGradient\)/);
		expect(svg).not.toMatch(/<animate/);
		expect(doc.querySelector('parsererror')).toBeNull();
	});
});
