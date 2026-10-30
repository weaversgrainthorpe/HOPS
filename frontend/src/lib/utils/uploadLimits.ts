// Upload limits. The three limits are stored in bytes but shown and typed in MB, and
// an upload over a limit is refused with a message that names the limit and the file's size.
// The server enforces the limits too (and words its refusal the same way); checking here first
// means a big file is refused at once instead of being sent and cut off mid-transfer.

const API_BASE = import.meta.env.VITE_API_BASE || '/api';

/** One megabyte as HOPS shows it: 1,048,576 bytes (matches the server). */
export const MB = 1048576;

export type UploadKind = 'import' | 'background' | 'icon';

const LARGEST: Record<UploadKind, string> = {
	import: 'file you can import',
	background: 'background image allowed',
	icon: 'icon file allowed'
};

/** Bytes (as stored) → the MB text shown in the input: up to 2 decimals, no trailing zeros. */
export function bytesToMBText(bytes: string | number): string {
	const n = Number(bytes);
	if (!Number.isFinite(n)) return String(bytes);
	return String(Math.round((n / MB) * 100) / 100);
}

/** Bytes → "1.5 MB" for messages (one decimal, whole numbers plain), as the server words it. */
export function formatMB(bytes: number): string {
	return `${Math.round((bytes / MB) * 10) / 10} MB`;
}

export type MBParse = { ok: true; bytes: number } | { ok: false; error: string };

/** Parses what the admin typed (MB) into bytes, refusing empty, invalid or out-of-range values. */
export function parseMBInput(text: string | number | null | undefined, bounds: { min?: number; max?: number }): MBParse {
	const min = bounds.min || MB;
	const raw = String(text ?? '').trim();
	const tooSmall: MBParse = { ok: false, error: `Must be at least ${formatMB(min)}` };
	if (!/^\d+(\.\d+)?$|^\.\d+$/.test(raw)) return tooSmall;
	const bytes = Math.round(Number(raw) * MB);
	if (!Number.isFinite(bytes) || bytes < min) return tooSmall;
	if (bounds.max && bytes > bounds.max) return { ok: false, error: `Can be at most ${formatMB(bounds.max)}` };
	return { ok: true, bytes };
}

/** The refusal for a file over its limit; it names both the size and the limit. */
export function uploadTooLargeMessage(kind: UploadKind, size: number, limit: number): string {
	let sizeText = formatMB(size);
	if (sizeText === formatMB(limit)) sizeText = `just over ${formatMB(limit)}`;
	return `This file is ${sizeText}, but the largest ${LARGEST[kind]} is ${formatMB(limit)}. Choose a smaller file, or raise the limit in Settings → Global settings.`;
}

/**
 * Checks a file against the current limit before it is sent. Returns the refusal message, or
 * null when the file may be sent. If the limits can't be read, it returns null and the server,
 * which enforces the same limits and says so in the same words, decides.
 */
export async function checkUploadSize(kind: UploadKind, file: Pick<File, 'size'>): Promise<string | null> {
	let limit: number | undefined;
	try {
		const res = await fetch(`${API_BASE}/upload-limits`, { credentials: 'same-origin' });
		if (res.ok) {
			const body = (await res.json()) as Partial<Record<UploadKind, number>>;
			limit = typeof body[kind] === 'number' ? body[kind] : undefined;
		}
	} catch {
		limit = undefined;
	}
	if (limit === undefined) return null;
	return file.size > limit ? uploadTooLargeMessage(kind, file.size, limit) : null;
}

/** Reads a failed upload response into a sentence: the server's `error`, never raw JSON. */
export async function uploadErrorMessage(response: Response, fallback: string): Promise<string> {
	let text = '';
	try {
		text = await response.text();
	} catch {
		text = '';
	}
	if (text) {
		try {
			const parsed = JSON.parse(text);
			if (parsed && typeof parsed.error === 'string' && parsed.error) return parsed.error;
		} catch {
			/* not JSON: fall through */
		}
	}
	if (response.status === 413) return 'That file is bigger than the upload limit.';
	return text ? `${fallback}: ${text}` : `${fallback} (${response.status} ${response.statusText})`.trim();
}

/**
 * Sends an upload. The server may refuse an oversize body before reading it (a limit changed since
 * the pre-check, or the limits could not be read), and the browser then reports only a dropped
 * connection; that is named here rather than surfacing a bare "Failed to fetch".
 */
export async function sendUpload(url: string, init: RequestInit): Promise<Response> {
	try {
		return await fetch(url, init);
	} catch (e) {
		const why = e instanceof Error && e.message ? ` (${e.message})` : '';
		throw new Error(
			`The upload was cut off before the server answered${why}. The file may be over the upload limit, or the connection dropped.`
		);
	}
}
