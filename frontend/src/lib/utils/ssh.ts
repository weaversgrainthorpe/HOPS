// SSH tile preset: an ssh:// tile is an ordinary link tile whose URL is built
// from Host / Port / User fields. The browser hands ssh:// to the computer's
// own SSH app; HOPS stores no credentials and runs no terminal.

import { isValidUrl } from './url';

export interface SshFields {
	host: string;
	/** Blank means 22. */
	port: string;
	/** Optional. */
	user: string;
}

export type SshErrors = Partial<Record<keyof SshFields, string>>;

export const SSH_DEFAULT_PORT = '22';

export function isSshUrl(url: string | undefined | null): boolean {
	return typeof url === 'string' && url.trim().toLowerCase().startsWith('ssh://');
}

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const USER = /^[a-z0-9._-]+$/i;

function validHostname(h: string): boolean {
	if (h.length > 253) return false;
	return h.split('.').every((l) => LABEL.test(l));
}

function validIPv4(h: string): boolean {
	return IPV4.test(h) && h.split('.').every((o) => Number(o) <= 255);
}

function validIPv6Bracketed(h: string): boolean {
	if (!/^\[[0-9a-f:.]+\]$/i.test(h) || !h.includes(':')) return false;
	try {
		// The URL parser is the authority on what an IPv6 literal is.
		return new URL(`ssh://${h}`).hostname.length > 2;
	} catch {
		return false;
	}
}

/** Field-by-field errors; an empty object means valid. */
export function validateSsh(f: SshFields): SshErrors {
	const errors: SshErrors = {};
	const host = f.host.trim();
	const port = f.port.trim();
	const user = f.user.trim();
	if (!host) {
		errors.host = 'Host is required.';
	} else if (/[\s/@?#]/.test(host)) {
		errors.host = 'Host cannot contain spaces or / @ ? #.';
	} else if (host.startsWith('[')) {
		if (!validIPv6Bracketed(host)) errors.host = 'Not a valid IPv6 address (write it in brackets, e.g. [fd00::1]).';
	} else if (host.includes(':')) {
		errors.host = 'Put an IPv6 address in brackets, e.g. [fd00::1]; put the port in the Port field.';
	} else if (/^[\d.]+$/.test(host)) {
		if (!validIPv4(host)) errors.host = 'Not a valid IPv4 address.';
	} else if (!validHostname(host)) {
		errors.host = 'Not a valid hostname (letters, digits, dots and hyphens).';
	}
	if (port && !(/^\d{1,5}$/.test(port) && Number(port) >= 1 && Number(port) <= 65535)) {
		errors.port = 'Port must be a whole number from 1 to 65535.';
	}
	if (user && !USER.test(user)) {
		errors.user = 'User may contain only letters, digits, dot, hyphen and underscore.';
	}
	return errors;
}

/** ssh://[user@]host[:port], with :22 left out. Assumes validated fields. */
export function buildSshUrl(f: SshFields): string {
	const host = f.host.trim();
	const port = f.port.trim();
	const user = f.user.trim();
	const p = port && port !== SSH_DEFAULT_PORT ? `:${Number(port)}` : '';
	return `ssh://${user ? `${user}@` : ''}${host}${p}`;
}

/** The fields behind an ssh:// URL, or null when it isn't one (or can't be read). */
export function parseSshUrl(url: string): SshFields | null {
	if (!isSshUrl(url)) return null;
	try {
		const u = new URL(url.trim());
		return {
			host: u.hostname,
			port: u.port || SSH_DEFAULT_PORT,
			user: decodeURIComponent(u.username)
		};
	} catch {
		return null;
	}
}

/**
 * Opens an ssh:// URL in place, without a new tab: the current window
 * navigates to it and the browser hands it to the OS's SSH app, so the
 * dashboard stays loaded (checked in Chromium). A hidden iframe does not
 * work: Chromium blocks subframe URLs carrying a user@ and the CSP's
 * frame-src allows only http(s).
 */
export function openSshInPlace(url: string): boolean {
	// Only an allow-listed ssh:// address ever reaches location (pentest L1).
	if (!isSshUrl(url) || !isValidUrl(url)) return false;
	window.location.href = url.trim();
	return true;
}
