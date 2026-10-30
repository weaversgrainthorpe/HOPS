import { redirect } from '@sveltejs/kit';

// The page's earlier address (older notices and bookmarks link here): it is now Blocked status checks.
export function load(): never {
	redirect(307, '/settings/dashboards/blocked-status-checks');
}
