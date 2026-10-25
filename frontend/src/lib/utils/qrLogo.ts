import QRCode from 'qrcode';
// The HOPS logo, bundled into the app at build time (works offline; no request).
import { HOPS_DARK_BLUE } from '$lib/stores/theme';
import logoSource from '../../../static/logo.svg?raw';

// M5 §12: dashboard QR codes carry a small HOPS bunny in their centre. Level H recovers ~30% of
// the code; the bunny's dark backing hides at most 20% x 20% of the width (4% of the area), so
// the code still scans. The bunny is part of the SVG itself, so the download has it too.

export const QR_ERROR_CORRECTION = 'H' as const;
/** The backing's colour: HOPS's dark brand blue from the theme (the default --bg-secondary). The
 *  bunny's near-white fills have well over 4.5:1 contrast on it (checked in the unit test). */
export const BACKING_COLOUR: string = HOPS_DARK_BLUE;
/** The dark rounded backing's side, as a fraction of the code's full width. */
export const BACKING_FRACTION = 0.2;
/** The bunny's side, as a fraction of the code's full width (the rest is a quiet margin). */
export const LOGO_FRACTION = 0.16;

const ID_PREFIX = 'hopsqr-';

/** The logo's inner markup: still (no animation), comments dropped, ids prefixed so they cannot
 *  clash with another inline SVG on the page. */
function logoInner(): { viewBox: string; inner: string } {
	const open = logoSource.match(/<svg\b[^>]*>/);
	const viewBox = open?.[0].match(/viewBox="([^"]+)"/)?.[1];
	const start = open ? (open.index ?? 0) + open[0].length : -1;
	const end = logoSource.lastIndexOf('</svg>');
	if (!open || !viewBox || end < start) throw new Error('The HOPS logo could not be read');
	const inner = logoSource
		.slice(start, end)
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/<animate\w*\b[^>]*\/>/g, '')
		.replace(/\bid="([^"]+)"/g, `id="${ID_PREFIX}$1"`)
		.replace(/url\(#([^)]+)\)/g, `url(#${ID_PREFIX}$1)`);
	return { viewBox, inner };
}

/** Adds the bunny, on its dark rounded backing, to the centre of a QR code SVG from `qrcode`. */
export function withCentreLogo(qrSvg: string): string {
	const vb = qrSvg.match(/<svg\b[^>]*\bviewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/);
	const close = qrSvg.lastIndexOf('</svg>');
	if (!vb || vb[1] !== vb[2] || close < 0) throw new Error('Unexpected QR code SVG');
	const n = Number(vb[1]);
	const b = n * BACKING_FRACTION;
	const l = n * LOGO_FRACTION;
	const { viewBox, inner } = logoInner();
	const backing =
		`<rect data-qr-backing="" x="${(n - b) / 2}" y="${(n - b) / 2}" width="${b}" height="${b}" ` +
		`rx="${b * 0.2}" fill="${BACKING_COLOUR}" shape-rendering="geometricPrecision"/>`;
	const logo =
		`<svg data-qr-logo="" x="${(n - l) / 2}" y="${(n - l) / 2}" width="${l}" height="${l}" ` +
		`viewBox="${viewBox}" fill="none" shape-rendering="geometricPrecision">${inner}</svg>`;
	return qrSvg.slice(0, close) + backing + logo + qrSvg.slice(close);
}

/** The QR code SVG for `url`: level H, with the HOPS bunny in its centre. */
export async function buildQrSvg(url: string): Promise<string> {
	const svg = await QRCode.toString(url, {
		type: 'svg',
		width: 320,
		margin: 1,
		errorCorrectionLevel: QR_ERROR_CORRECTION
	});
	return withCentreLogo(svg);
}

function escapeXml(s: string): string {
	return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
}

/**
 * A downloadable copy of a QR code SVG labelled with its dashboard's name above it, on white, so a
 * printed code says what it opens. The code itself (with its bunny) is unchanged; the name is text,
 * escaped, and shrinks to fit the code's width when long.
 */
export function withNameLabel(qrSvg: string, name: string): string {
	const open = qrSvg.match(/<svg\b[^>]*>/);
	const vb = open?.[0].match(/\bviewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/);
	const pxW = Number(open?.[0].match(/\bwidth="(\d+(?:\.\d+)?)"/)?.[1] ?? 320);
	if (!open || !vb || vb[1] !== vb[2]) throw new Error('Unexpected QR code SVG');
	const n = Number(vb[1]);
	const label = n * 0.2; // the band above the code
	// About 0.55em per character in a sans-serif; never larger than the band allows.
	const fontSize = Math.min(label * 0.6, (n * 0.92) / Math.max(1, name.length * 0.55));
	const total = n + label;
	const inner =
		open[0]
			.replace(/\s(width|height|x|y)="[^"]*"/g, '')
			.replace(/^<svg\b/, `<svg data-qr-code="" x="0" y="${label}" width="${n}" height="${n}"`) +
		qrSvg.slice(open[0].length);
	return (
		`<svg xmlns="http://www.w3.org/2000/svg" width="${pxW}" height="${(pxW * total) / n}" viewBox="0 0 ${n} ${total}">` +
		`<rect data-qr-label-bg="" x="0" y="0" width="${n}" height="${total}" fill="#ffffff"/>` +
		`<text data-qr-name="" x="${n / 2}" y="${label * 0.68}" text-anchor="middle" font-size="${fontSize}" ` +
		`font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" font-weight="700" fill="#111827">` +
		`${escapeXml(name)}</text>${inner}</svg>`
	);
}
