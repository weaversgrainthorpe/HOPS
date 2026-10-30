import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

// Discovery is a Settings section now, at /settings/discovery…. The old /admin/discovery…
// addresses (bookmarks, links) go to the matching new page, keeping the query string (Edit &
// re-scan passes the targets in it). A redirect from load replaces the old address, so Back never
// returns to it.
export const load: PageLoad = ({ params, url }) => {
	redirect(307, _discoveryRedirect(params.rest ?? '', url.search));
};

export function _discoveryRedirect(rest: string, search = ''): string {
	return `/settings/discovery${rest ? `/${rest}` : ''}${search}`;
}
