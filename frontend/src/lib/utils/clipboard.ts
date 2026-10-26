/**
 * Copies text to the clipboard: the Clipboard API where the browser allows it, else (plain http,
 * no secure context) the old hidden-textarea way. Throws when neither works, so the caller can
 * say so — a copy never fails silently.
 */
export async function copyText(text: string): Promise<void> {
	if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
		await navigator.clipboard.writeText(text);
		return;
	}
	const ta = document.createElement('textarea');
	ta.value = text;
	ta.setAttribute('readonly', '');
	ta.style.position = 'fixed';
	ta.style.opacity = '0';
	document.body.appendChild(ta);
	ta.select();
	let ok = false;
	try {
		ok = document.execCommand('copy');
	} finally {
		ta.remove();
	}
	if (!ok) throw new Error('the browser refused');
}
