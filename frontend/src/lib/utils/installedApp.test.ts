import { describe, it, expect, afterEach, vi } from 'vitest';
import { isInstalledApp } from './installedApp';

function stubDisplayMode(mode: string | null) {
	vi.stubGlobal('matchMedia', (query: string) => ({
		matches: mode !== null && query === `(display-mode: ${mode})`,
		media: query,
		addEventListener: () => {},
		removeEventListener: () => {}
	}));
}

describe('isInstalledApp', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		delete (navigator as { standalone?: boolean }).standalone;
	});

	it('is false in an ordinary browser tab', () => {
		stubDisplayMode(null);
		expect(isInstalledApp()).toBe(false);
	});

	it.each(['standalone', 'fullscreen', 'minimal-ui'])('is true in display-mode %s', (mode) => {
		stubDisplayMode(mode);
		expect(isInstalledApp()).toBe(true);
	});

	it("is true for an iOS home-screen app (navigator.standalone)", () => {
		stubDisplayMode(null);
		(navigator as { standalone?: boolean }).standalone = true;
		expect(isInstalledApp()).toBe(true);
	});

	it('is false when matchMedia is missing or throws', () => {
		vi.stubGlobal('matchMedia', undefined);
		expect(isInstalledApp()).toBe(false);
		vi.stubGlobal('matchMedia', () => {
			throw new Error('no');
		});
		expect(isInstalledApp()).toBe(false);
	});
});
