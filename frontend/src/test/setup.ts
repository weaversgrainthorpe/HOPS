import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/svelte';

// Reset DOM between tests so components from one test don't leak into the next
afterEach(() => {
	cleanup();
});

// Provide a stable matchMedia mock — components like the theme store call this
// at module init and jsdom doesn't ship matchMedia.
if (typeof window !== 'undefined' && !window.matchMedia) {
	window.matchMedia = (query: string) => ({
		matches: false,
		media: query,
		onchange: null,
		addListener: () => {},
		removeListener: () => {},
		addEventListener: () => {},
		removeEventListener: () => {},
		dispatchEvent: () => false
	});
}

// localStorage is provided by jsdom but reset between tests so persisted theme
// state etc. don't leak.
afterEach(() => {
	if (typeof localStorage !== 'undefined') {
		localStorage.clear();
	}
});
