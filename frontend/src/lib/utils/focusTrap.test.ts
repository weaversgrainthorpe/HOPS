import { describe, it, expect, afterEach } from 'vitest';
import { focusTrap } from './focusTrap';

const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)));

function dialog(): { el: HTMLElement; a: HTMLInputElement; b: HTMLInputElement } {
	const el = document.createElement('div');
	el.innerHTML = '<input id="a" /><input id="b" />';
	document.body.appendChild(el);
	return { el, a: el.querySelector('#a')!, b: el.querySelector('#b')! };
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('focusTrap initial focus', () => {
	it('focuses the initialFocus element (or the first focusable) one frame after opening', async () => {
		const { el, b } = dialog();
		const t = focusTrap(el, { initialFocus: '#b' });
		await frame();
		expect(document.activeElement).toBe(b);
		t.destroy?.();
	});

	it('never takes the focus back from a field the user already moved into', async () => {
		const { el, a, b } = dialog();
		const t = focusTrap(el, { initialFocus: '#a' });
		b.focus(); // typed into the second field before the frame
		await frame();
		expect(document.activeElement).toBe(b);
		expect(document.activeElement).not.toBe(a);
		t.destroy?.();
	});
});
