// Which URL a tile opens (Home/Away). A tile may carry an optional awayUrl:
// the address to use when this browser is set to Away (a Tailscale, VPN or
// public address). Every place that opens a tile — a click, Enter on a focused
// tile, the iframe/popup modes, search — asks this module, so they all agree.
// Status checks are not affected: the server is at home and checks `url`.
import { isValidUrl } from './url';
import type { LayoutDashboard, LayoutNode } from '$lib/types/layout';

interface HasUrls {
	url?: string;
	awayUrl?: string;
	type?: string;
}

/** True when the tile has a non-blank away address. */
export function hasAwayUrl(t: HasUrls): boolean {
	return typeof t.awayUrl === 'string' && t.awayUrl.trim() !== '';
}

/** The URL the tile opens: its awayUrl when `away` and it has one, else its url. */
export function tileOpenUrl(t: HasUrls, away: boolean): string {
	if (away && hasAwayUrl(t)) return (t.awayUrl as string).trim();
	return t.url ?? '';
}

/** True when any link tile on the dashboard (any tab, any folder depth) has an away address. */
export function dashboardHasAway(d: LayoutDashboard | null | undefined): boolean {
	if (!d || !Array.isArray(d.tabs)) return false;
	const walk = (nodes: LayoutNode[] | undefined): boolean =>
		Array.isArray(nodes) &&
		nodes.some((n) =>
			n?.kind === 'folder'
				? walk(n.content?.children)
				: n?.kind === 'tile' && n.type !== 'note' && hasAwayUrl(n)
		);
	return d.tabs.some((t) => walk(t?.root?.children));
}

/** The tile dialog's check of an away address: null when blank (optional) or valid. */
export function awayUrlProblem(u: string | undefined): string | null {
	if (!u || u.trim() === '') return null;
	return addressProblem(u, 'https://nas.your-tailnet.ts.net');
}

/** The tile dialog's check of a link tile's URL (required): null when valid. */
export function linkUrlProblem(u: string | undefined): string | null {
	if (!u || u.trim() === '') return 'Enter an address, e.g. http://192.168.1.1';
	return addressProblem(u, 'http://192.168.1.1');
}

function addressProblem(u: string, example: string): string | null {
	if (isValidUrl(u.trim())) return null;
	if (/^\s*(https?|ftps?|ssh)\/\//i.test(u)) return `A colon is missing after the scheme, e.g. ${example}`;
	if (u.includes('\\')) return `Use forward slashes (/), not backslashes (\\), e.g. ${example}`;
	return `Enter a valid address (http, https, ftp, ssh or mailto), e.g. ${example}`;
}
