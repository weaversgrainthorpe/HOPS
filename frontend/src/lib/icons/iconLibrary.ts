/**
 * The icon library (icons + categories from the server), shared by the icon picker and
 * Settings › Icons so "My Uploads" and the Icons page always show the same thing. A change made
 * in one (upload, rename, delete) reloads it, and the other sees the change.
 *
 * A failed load is a state with its message, never an empty library: the last good lists are
 * kept but `state` says 'failed', so a caller can tell "couldn't load" from "nothing there".
 */
import { writable, get } from 'svelte/store';
import { getIconCategories, getIcons, type Icon, type IconCategory } from '$lib/utils/api';

export interface IconLibrary {
	state: 'idle' | 'loading' | 'ok' | 'failed';
	error: string | null;
	icons: Icon[];
	categories: IconCategory[];
	/** When the lists were last loaded successfully (ISO), or null. */
	loadedAt: string | null;
}

const initial: IconLibrary = { state: 'idle', error: null, icons: [], categories: [], loadedAt: null };

export const iconLibrary = writable<IconLibrary>(initial);

let inFlight: Promise<void> | null = null;

/** Loads (or reloads) both lists. Concurrent calls share one request. Never throws. */
export function loadIconLibrary(): Promise<void> {
	if (inFlight) return inFlight;
	iconLibrary.update((s) => ({ ...s, state: 'loading' }));
	inFlight = (async () => {
		try {
			const [categories, icons] = await Promise.all([getIconCategories(), getIcons()]);
			if (!Array.isArray(categories) || !Array.isArray(icons)) throw new Error('the server sent an unreadable answer');
			iconLibrary.set({ state: 'ok', error: null, icons, categories, loadedAt: new Date().toISOString() });
		} catch (e) {
			const error = e instanceof Error && e.message ? e.message : 'the request failed';
			iconLibrary.update((s) => ({ ...s, state: 'failed', error }));
		} finally {
			inFlight = null;
		}
	})();
	return inFlight;
}

/** Loads once if never loaded (or the last load failed); otherwise keeps what is there. */
export function ensureIconLibrary(): Promise<void> {
	const s = get(iconLibrary);
	return s.state === 'ok' ? Promise.resolve() : loadIconLibrary();
}

/** For tests. */
export function resetIconLibrary() {
	inFlight = null;
	iconLibrary.set(initial);
}
