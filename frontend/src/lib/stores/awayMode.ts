// Home/Away (per browser): which address tiles open. A viewer convenience,
// remembered in this browser only (signed in or not), defaulting to Home.
// Storage can be missing or throw (private windows, blocked site data): then
// the choice simply lasts for this page load.
import { writable } from 'svelte/store';

const KEY = 'hops_away_mode';

function read(): boolean {
	try {
		return typeof localStorage !== 'undefined' && localStorage.getItem(KEY) === 'away';
	} catch {
		return false;
	}
}

/** true: Away (tiles open their away address when they have one). */
export const awayMode = writable<boolean>(read());

export function setAway(away: boolean): void {
	awayMode.set(away);
	try {
		localStorage.setItem(KEY, away ? 'away' : 'home');
	} catch {
		// Not remembered in this browser; the choice still applies until reload.
	}
}
