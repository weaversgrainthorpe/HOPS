import { describe, it, expect } from 'vitest';
import {
	buildBookmarklet, parseAddParams, cleanName, dashboardIconCandidates, pickDashboardIcon, foldersOf,
	NAME_MAX, URL_MAX
} from './addToHops';
import type { LayoutDashboard } from '$lib/types/layout';

const q = (o: Record<string, string>) => new URLSearchParams(o);

describe('buildBookmarklet', () => {
	const b = buildBookmarklet('http://hops.lan:8080');
	it('is a javascript: URL that opens <origin>/add with the page address, title and icon', () => {
		expect(b.startsWith('javascript:')).toBe(true);
		expect(b).toContain('"http://hops.lan:8080/add?url="');
		expect(b).toContain('encodeURIComponent(location.href)');
		expect(b).toContain('encodeURIComponent(d.title)');
		expect(b).toContain('&icon=');
	});
	it('picks apple-touch-icon, then rel=icon, then /favicon.ico', () => {
		const a = b.indexOf('apple-touch-icon');
		const i = b.indexOf('rel~=icon');
		const f = b.indexOf('/favicon.ico');
		expect(a).toBeGreaterThan(0);
		expect(i).toBeGreaterThan(a);
		expect(f).toBeGreaterThan(i);
	});
	it('opens without an opener, loads no external script, and stays small', () => {
		expect(b).toContain("'noopener'");
		expect(b).not.toMatch(/createElement|<script|\.src=/);
		expect(b.length).toBeLessThan(500);
		expect(b).not.toMatch(/\s/);
	});
	it('runs: builds the right address from a page', () => {
		const opened: unknown[][] = [];
		const link = (href: string) => ({ href });
		const doc = {
			title: 'Grafana & co',
			querySelector: (s: string) => (s.includes('apple-touch-icon') ? null : s.includes('icon') ? link('https://g.lan/fav.png') : null)
		};
		const fn = new Function('document', 'location', 'window', decodeURIComponent(b.slice('javascript:'.length)));
		fn(doc, { href: 'https://g.lan/d?x=1', origin: 'https://g.lan' }, { open: (...a: unknown[]) => opened.push(a) });
		expect(opened).toHaveLength(1);
		const u = new URL(String(opened[0][0]));
		expect(u.origin + u.pathname).toBe('http://hops.lan:8080/add');
		expect(u.searchParams.get('url')).toBe('https://g.lan/d?x=1');
		expect(u.searchParams.get('name')).toBe('Grafana & co');
		expect(u.searchParams.get('icon')).toBe('https://g.lan/fav.png');
		expect(opened[0][1]).toBe('_blank');
	});
	it('falls back to /favicon.ico when the page names no icon', () => {
		const opened: unknown[][] = [];
		const fn = new Function('document', 'location', 'window', decodeURIComponent(b.slice('javascript:'.length)));
		fn({ title: 'x', querySelector: () => null }, { href: 'http://n.lan/', origin: 'http://n.lan' }, { open: (...a: unknown[]) => opened.push(a) });
		expect(new URL(String(opened[0][0])).searchParams.get('icon')).toBe('http://n.lan/favicon.ico');
	});
});

describe('cleanName', () => {
	it('drops control characters, collapses whitespace, trims and caps', () => {
		expect(cleanName('  My\t\nTool\u0000  ')).toBe('My Tool');
		expect(cleanName('a'.repeat(500))).toHaveLength(NAME_MAX);
		expect(cleanName('<b>x</b>')).toBe('<b>x</b>'); // plain text, shown escaped — never HTML
	});
});

describe('parseAddParams', () => {
	it('prefills from a good http(s) page', () => {
		const r = parseAddParams(q({ url: ' https://grafana.lan/d ', name: 'Grafana', icon: 'https://grafana.lan/fav.png' }));
		expect(r).toEqual({ url: 'https://grafana.lan/d', name: 'Grafana', iconUrl: 'https://grafana.lan/fav.png', problems: [] });
	});
	it('refuses javascript:, data: and other schemes, saying so', () => {
		for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,hi', 'vbscript:x', 'file:///etc/passwd', 'ftp://x']) {
			const r = parseAddParams(q({ url: bad, name: 'x' }));
			expect(r.url).toBe('');
			expect(r.problems.join(' ')).toMatch(/can't be used/);
		}
	});
	it('refuses an over-long address rather than cutting it', () => {
		const r = parseAddParams(q({ url: 'https://x.lan/' + 'a'.repeat(URL_MAX) }));
		expect(r.url).toBe('');
		expect(r.problems.join(' ')).toMatch(/too long/);
	});
	it('drops a non-http(s) or over-long icon, saying so', () => {
		const r = parseAddParams(q({ url: 'https://x.lan/', icon: 'javascript:alert(1)' }));
		expect(r.iconUrl).toBe('');
		expect(r.problems.join(' ')).toMatch(/icon/i);
		expect(parseAddParams(q({ url: 'https://x.lan/', icon: 'https://x.lan/' + 'a'.repeat(URL_MAX) })).iconUrl).toBe('');
	});
	it('no parameters: empty, no problems', () => {
		expect(parseAddParams(q({}))).toEqual({ url: '', name: '', iconUrl: '', problems: [] });
	});
	it('a name falls back to the host when the title is empty', () => {
		expect(parseAddParams(q({ url: 'https://nas.lan:5000/x', name: '  ' })).name).toBe('nas.lan');
	});
});

describe('Dashboard Icons match', () => {
	it('candidates: the whole name, its first word, the host label', () => {
		expect(dashboardIconCandidates('Proxmox Virtual Environment', 'https://pve.lan:8006/')).toEqual([
			'proxmox-virtual-environment', 'proxmox', 'pve'
		]);
	});
	it('only an exact name match wins', () => {
		expect(pickDashboardIcon(['grafana', 'proxmox'], 'Proxmox VE', 'https://10.0.0.5/')).toBe('/api/icons/dashboard/proxmox.svg');
		expect(pickDashboardIcon(['grafana'], 'Graf', 'https://graf.lan/')).toBeNull();
	});
});

describe('foldersOf', () => {
	it('lists every folder on a tab, nested ones with their path', () => {
		const d = {
			id: 'd', name: 'D', path: '/d', revision: 1,
			tabs: [{ id: 't', name: 'T', root: { columns: 24, children: [
				{ kind: 'tile', id: 'x', name: 'x' },
				{ kind: 'folder', id: 'f1', name: 'Media', content: { children: [{ kind: 'folder', id: 'f2', name: 'Old', content: { children: [] } }] } }
			] } }]
		} as unknown as LayoutDashboard;
		expect(foldersOf(d, 't')).toEqual([{ id: 'f1', label: 'Media' }, { id: 'f2', label: 'Media › Old' }]);
		expect(foldersOf(d, 'nope')).toEqual([]);
	});
});
