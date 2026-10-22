import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { navigateTiles } from './tileNav';

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

	it('reaches a collapsed folder by arrow keys', () => {
		const a = mk('entry', 0, 0, page, 'a');
		const f = mk('folder-collapsed-tile', 50, 0, page, 'f');
		a.focus();
		expect(navigateTiles('ArrowRight')).toBe(true);
		expect(document.activeElement).toBe(f);
	});

	it('with a modal dialog open (an About box with no stopped keys), never steals focus to a tile (M2 carry-over)', () => {
		const a = mk('entry', 0, 0, page, 'a');
		mk('entry', 50, 0, page, 'b');
		const dlg = document.createElement('div');
		dlg.setAttribute('role', 'dialog');
		dlg.setAttribute('aria-modal', 'true');
		const inside = document.createElement('button');
		dlg.appendChild(inside);
		document.body.appendChild(dlg);
		inside.focus();
		expect(navigateTiles('ArrowRight')).toBe(false);
		expect(document.activeElement).toBe(inside);
		dlg.remove();
		a.focus();
		expect(navigateTiles('ArrowRight')).toBe(true);
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

	it('folders open in place: their items are ordinary candidates beside the tab\'s', () => {
		const a = mk('entry', 0, 0, page, 'a');
		const box = document.createElement('div');
		box.className = 'folder open';
		page.appendChild(box);
		const inner = mk('entry', 60, 0, box, 'inner');
		a.focus();
		expect(navigateTiles('ArrowRight')).toBe(true);
		expect(document.activeElement).toBe(inner);
	});
});
