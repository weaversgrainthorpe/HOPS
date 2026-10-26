// Which dashboards are being edited in OTHER tabs of this browser. Edit drafts live only in their
// tab's memory, so "Add to HOPS" opened in a new tab can't add into one; saving straight to the
// server there would clash with that draft's later save (a conflict that loses one or the other).
// /add asks first and refuses, saying why, when the target has an open edit in another tab.
import { get } from 'svelte/store';
import { session, parkedDraft } from '$lib/stores/editSession';

const CHANNEL = 'hops.editPresence';

type Msg = { type: 'who'; reqId: string } | { type: 'here'; reqId: string; dashboardIds: string[] };

/** Answer other tabs' questions about this tab's edit session or parked draft. Returns a stop function. */
export function initEditPresence(): () => void {
	if (typeof BroadcastChannel === 'undefined') return () => {};
	const ch = new BroadcastChannel(CHANNEL);
	ch.onmessage = (e: MessageEvent<Msg>) => {
		if (e.data?.type !== 'who') return;
		const ids = [get(session)?.dashboardId, get(parkedDraft)?.dashboardId].filter((x): x is string => !!x);
		if (ids.length) ch.postMessage({ type: 'here', reqId: e.data.reqId, dashboardIds: ids } satisfies Msg);
	};
	return () => ch.close();
}

/**
 * The dashboards with an edit session or parked draft in other tabs of this browser (answers
 * within `waitMs`). `null` when the browser can't ask (no BroadcastChannel): unknown, not "none".
 */
export function editedInOtherTabs(waitMs = 250): Promise<Set<string> | null> {
	if (typeof BroadcastChannel === 'undefined') return Promise.resolve(null);
	return new Promise((resolve) => {
		const ch = new BroadcastChannel(CHANNEL);
		const reqId = Math.random().toString(36).slice(2);
		const out = new Set<string>();
		ch.onmessage = (e: MessageEvent<Msg>) => {
			if (e.data?.type === 'here' && e.data.reqId === reqId) for (const id of e.data.dashboardIds) out.add(id);
		};
		ch.postMessage({ type: 'who', reqId } satisfies Msg);
		setTimeout(() => {
			ch.close();
			resolve(out);
		}, waitMs);
	});
}
