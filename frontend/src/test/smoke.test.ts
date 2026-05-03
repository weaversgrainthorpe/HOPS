import { describe, it, expect } from 'vitest';

describe('test infrastructure smoke test', () => {
	it('vitest can run a basic assertion', () => {
		expect(1 + 1).toBe(2);
	});

	it('jsdom provides document', () => {
		expect(typeof document).toBe('object');
		expect(document.createElement('div')).toBeTruthy();
	});

	it('localStorage is available', () => {
		localStorage.setItem('foo', 'bar');
		expect(localStorage.getItem('foo')).toBe('bar');
	});
});
