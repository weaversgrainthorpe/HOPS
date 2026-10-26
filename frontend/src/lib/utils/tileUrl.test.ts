import { describe, it, expect } from 'vitest';
import { tileOpenUrl, hasAwayUrl, dashboardHasAway, awayUrlProblem } from './tileUrl';
import type { LayoutDashboard } from '$lib/types/layout';

const tile = (url: string, awayUrl?: string) => ({ url, ...(awayUrl === undefined ? {} : { awayUrl }) });

describe('tileOpenUrl (which URL a tile opens)', () => {
	it('Home always opens url', () => {
		expect(tileOpenUrl(tile('http://nas.lan', 'https://nas.ts.net'), false)).toBe('http://nas.lan');
	});
	it('Away opens awayUrl when the tile has one', () => {
		expect(tileOpenUrl(tile('http://nas.lan', 'https://nas.ts.net'), true)).toBe('https://nas.ts.net');
	});
	it('Away falls back to url when the tile has no away address', () => {
		expect(tileOpenUrl(tile('http://nas.lan'), true)).toBe('http://nas.lan');
		expect(tileOpenUrl(tile('http://nas.lan', '   '), true)).toBe('http://nas.lan');
	});
	it('a blank awayUrl is not an away address', () => {
		expect(hasAwayUrl(tile('x', ''))).toBe(false);
		expect(hasAwayUrl(tile('x', 'https://a'))).toBe(true);
	});
});

describe('dashboardHasAway', () => {
	const dash = (children: unknown[]): LayoutDashboard =>
		({ id: 'd', name: 'D', path: '/d', revision: 1, tabs: [{ id: 't', name: 'T', root: { children } }] }) as unknown as LayoutDashboard;
	it('false with no away addresses', () => {
		expect(dashboardHasAway(dash([{ kind: 'tile', url: 'a' }]))).toBe(false);
		expect(dashboardHasAway(undefined)).toBe(false);
	});
	it('finds an away address inside nested folders', () => {
		const deep = { kind: 'folder', content: { children: [{ kind: 'folder', content: { children: [{ kind: 'tile', url: 'a', awayUrl: 'https://b' }] } }] } };
		expect(dashboardHasAway(dash([deep]))).toBe(true);
	});
	it('ignores note tiles', () => {
		expect(dashboardHasAway(dash([{ kind: 'tile', type: 'note', url: '', awayUrl: 'https://b' }]))).toBe(false);
	});
});

describe('awayUrlProblem (dialog validation)', () => {
	it('blank is fine (optional)', () => {
		expect(awayUrlProblem('')).toBeNull();
		expect(awayUrlProblem('  ')).toBeNull();
	});
	it('accepts the same schemes as url', () => {
		for (const u of ['https://nas.ts.net', 'http://100.64.0.1:8080', 'ssh://me@h:2222', 'nas.example.com']) {
			expect(awayUrlProblem(u)).toBeNull();
		}
	});
	it('refuses unsafe or malformed addresses', () => {
		for (const u of ['javascript:alert(1)', 'data:text/html,x', 'https://exa mple.com']) {
			expect(awayUrlProblem(u)).toMatch(/address/i);
		}
	});
});
