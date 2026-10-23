import { redirect } from '@sveltejs/kit';

// M5 §9: Settings is a set of pages, one per section; /settings itself opens the first one.
// A redirect (not a page that forwards after it renders) leaves no /settings entry in the
// history, so Back from /settings/dashboards goes to where you came from, never into a loop.
export function load(): never {
	redirect(307, '/settings/dashboards');
}
