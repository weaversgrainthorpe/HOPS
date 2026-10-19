import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { navigateTiles } from './tileNav';
import { openFolder, closeAll } from '$lib/stores/folderOverlay';

function box(el: HTMLElement, x: number, y: number) {
	el.getBoundingClientRect = () =>
		({ left: x, top: y, width: 10, height: 10, right: x + 10, bottom: y + 10, x, y }) as DOMRect;
}
function mk(cls: string, x: number, y: number, parent: HTMLElement, id: string): HTMLElement {
	const b = document.createElement('button');
	b.className = cls;
	b.id = id;
	box(b, x, y);
	parent.appendChild(b);
	return b;
}

describe('navigateTiles', () => {
	let page: HTMLElement;
	beforeEach(() => {
		document.body.innerHTML = '';
		page = document.createElement('div');
		document.body.appendChild(page);
	});
	afterEach(() => closeAll());

	it('reaches a collapsed folder by arrow keys', () => {
		const a = mk('entry', 0, 0, page, 'a');
		const f = mk('folder-collapsed-tile', 50, 0, page, 'f');
		a.focus();
		expect(navigateTiles('ArrowRight')).toBe(true);
		expect(document.activeElement).toBe(f);
	});

	it('skips tiles inside [inert]', () => {
		const a = mk('entry', 0, 0, page, 'a');
		const wrap = document.createElement('div');
		wrap.setAttribute('inert', '');
		page.appendChild(wrap);
		mk('entry', 20, 0, wrap, 'dead');
		const live = mk('entry', 60, 0, page, 'live');
		a.focus();
		navigateTiles('ArrowRight');
		expect(document.activeElement).toBe(live);
	});

	it('with an overlay open, never focuses a tile behind it', () => {
		mk('entry', 100, 0, page, 'behind');
		const panel = document.createElement('div');
		panel.className = 'overlay-panel';
		document.body.appendChild(panel);
		const p1 = mk('entry', 0, 0, panel, 'p1');
		openFolder('x');
		p1.focus();
		expect(navigateTiles('ArrowRight')).toBe(false);
		expect(document.activeElement).toBe(p1);
	});

	it('focuses the first panel candidate when focus is outside the overlay', () => {
		const behind = mk('entry', 0, 0, page, 'behind');
		const panel = document.createElement('div');
		panel.className = 'overlay-panel';
		document.body.appendChild(panel);
		const p1 = mk('entry', 0, 0, panel, 'p1');
		openFolder('x');
		behind.focus();
		expect(navigateTiles('ArrowDown')).toBe(true);
		expect(document.activeElement).toBe(p1);
	});
});
