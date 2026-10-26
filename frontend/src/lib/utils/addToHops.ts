// "Add to HOPS": the bookmarklet and the /add page's parameter handling. Pure, so unit-tested.
//
// The bookmarklet only OPENS <HOPS>/add with the page's address, title and icon; the query
// parameters only prefill the form. Nothing is created until a signed-in user clicks Add (which
// saves through the normal dashboard save, with CSRF). Every parameter is untrusted text: shown
// as text, capped, and the address and icon must be http(s).
import type { Container, LayoutDashboard } from '$lib/types/layout';
import { DASHBOARD_ICON_PREFIX } from './iconSuggest';

export const NAME_MAX = 100;
export const URL_MAX = 2048;

/**
 * The bookmarklet for a HOPS at `origin`: opens `<origin>/add?url=…&name=…&icon=…` in a new tab,
 * with no opener. The icon is the page's apple-touch-icon, else its rel=icon, else /favicon.ico.
 * No external script, no whitespace.
 */
export function buildBookmarklet(origin: string): string {
	const target = JSON.stringify(`${origin.replace(/\/+$/, '')}/add?url=`);
	const code =
		'(function(d,l,i){' +
		"l=d.querySelector('link[rel~=apple-touch-icon]')||d.querySelector('link[rel~=icon]')," +
		"i=l&&l.href?l.href:location.origin+'/favicon.ico';" +
		`window.open(${target}+encodeURIComponent(location.href)+'&name='+encodeURIComponent(d.title)+'&icon='+encodeURIComponent(i),'_blank','noopener')` +
		'})(document)';
	return 'javascript:' + code;
}

/** A name as plain text: no control characters, single spaces, trimmed, at most NAME_MAX. */
export function cleanName(raw: string): string {
	// eslint-disable-next-line no-control-regex
	return raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX).trim();
}

/** `raw` as an http(s) URL string, or null. */
function httpUrl(raw: string): string | null {
	try {
		const u = new URL(raw);
		return u.protocol === 'http:' || u.protocol === 'https:' ? raw : null;
	} catch {
		return null;
	}
}

export interface AddParams {
	url: string;
	name: string;
	iconUrl: string;
	/** Why a parameter was not used, for the page to show. */
	problems: string[];
}

/** The /add query parameters, checked. A refused one is left empty and its reason listed. */
export function parseAddParams(p: URLSearchParams): AddParams {
	const problems: string[] = [];
	const rawUrl = (p.get('url') ?? '').trim();
	let url = '';
	if (rawUrl) {
		if (rawUrl.length > URL_MAX) problems.push(`The page address is too long (over ${URL_MAX} characters), so it wasn't filled in.`);
		else if (!httpUrl(rawUrl)) problems.push("The page address can't be used: only http:// and https:// addresses can be added this way.");
		else url = rawUrl;
	}
	let name = cleanName(p.get('name') ?? '');
	if (!name && url) name = cleanName(new URL(url).hostname);
	const rawIcon = (p.get('icon') ?? '').trim();
	let iconUrl = '';
	if (rawIcon) {
		if (rawIcon.length <= URL_MAX && httpUrl(rawIcon)) iconUrl = rawIcon;
		else problems.push("The page's icon can't be used (not an http:// or https:// image address), so the tile has no icon yet.");
	}
	return { url, name, iconUrl, problems };
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** Dashboard Icons names to try for a page: its whole name, its first word, its host's first label. */
export function dashboardIconCandidates(name: string, url: string): string[] {
	const out: string[] = [];
	const add = (s: string) => {
		const v = slug(s);
		if (v && !out.includes(v)) out.push(v);
	};
	add(name);
	add(name.trim().split(/\s+/)[0] ?? '');
	try {
		const host = new URL(url).hostname;
		if (!/^[\d.]+$/.test(host) && !host.includes(':')) add(host.split('.')[0]);
	} catch {
		/* no host to try */
	}
	return out;
}

/** The bundled Dashboard Icon for a page (an exact name match only), or null. */
export function pickDashboardIcon(names: readonly string[], name: string, url: string): string | null {
	const have = new Set(names);
	const hit = dashboardIconCandidates(name, url).find((c) => have.has(c));
	return hit ? `${DASHBOARD_ICON_PREFIX}${hit}.svg` : null;
}

/** Every folder on tab `tabId` (nested ones too), labelled with its path. */
export function foldersOf(d: LayoutDashboard, tabId: string): { id: string; label: string }[] {
	const tab = d.tabs.find((t) => t.id === tabId);
	const out: { id: string; label: string }[] = [];
	const walk = (c: Container | undefined, path: string[]) => {
		for (const n of Array.isArray(c?.children) ? c!.children : []) {
			if (n?.kind !== 'folder') continue;
			const p = [...path, n.name || 'Unnamed folder'];
			out.push({ id: n.id, label: p.join(' › ') });
			walk(n.content, p);
		}
	};
	walk(tab?.root, []);
	return out;
}

// ---------------------------------------------------------------- per-browser memory

const LAST_KEY = 'hops.addToHops.last';

export interface LastTarget {
	dashboardId: string;
	tabId?: string;
	folderId?: string;
}

/** Where this browser last added a page (a convenience; absent or unreadable = none). */
export function readLastTarget(): LastTarget | null {
	try {
		const v = JSON.parse(localStorage.getItem(LAST_KEY) ?? 'null');
		return v && typeof v.dashboardId === 'string' ? (v as LastTarget) : null;
	} catch {
		return null;
	}
}

export function writeLastTarget(t: LastTarget): void {
	try {
		localStorage.setItem(LAST_KEY, JSON.stringify(t));
	} catch {
		/* a per-browser convenience only: the tile was still added */
	}
}
