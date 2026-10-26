// Which dashboards are being edited in OTHER tabs of this browser, and handing a new tile to one.
// Edit drafts live only in their tab's memory, so "Add to HOPS" in another tab must not save over
// a draft with unsaved changes (that draft's later save would conflict). Instead:
//   - dirty edit elsewhere: /add sends the checked tile to that tab, which adds it to ITS draft
//     through the normal edit path (undoable, unsaved) and acknowledges; /add waits for the ACK.
//     Every hand-off carries an idempotency id, so a retry never adds twice.
//   - clean edit elsewhere: /add saves directly (revision-checked) and announces "saved at N";
//     the editing tab, still clean, moves its session onto that revision, so its next Save is fine.
// Editing tabs also announce changes (start, dirty/clean, end) so /add's note stays current.
import { get } from 'svelte/store';
import { session, parkedDraft, dirty, apply, expectExternalSave } from '$lib/stores/editSession';
import { loadConfig } from '$lib/stores/config';
import { withNewTile } from '$lib/editor/editorActions';
import { toast } from '$lib/stores/toast';
import type { LayoutDashboard, TileNode } from '$lib/types/layout';

const CHANNEL = 'hops.editPresence';

/** One tab's edit of one dashboard. `parked`: kept from before a sign-out (can't take a tile now). */
export interface EditInfo {
	dashboardId: string;
	dirty: boolean;
	parked?: boolean;
}

export interface AddTo {
	tabId: string;
	folderId?: string;
}

export type Msg =
	| { type: 'who'; reqId: string }
	| { type: 'here'; reqId: string; tabKey: string; edits: EditInfo[] }
	| { type: 'state'; tabKey: string; edits: EditInfo[] }
	| { type: 'add'; addId: string; toTab: string; dashboardId: string; tile: TileNode; to: AddTo }
	| { type: 'added'; addId: string; ok: true }
	| { type: 'added'; addId: string; ok: false; reason: string }
	| { type: 'saved'; dashboardId: string; revision: number };

/** An edit known in another tab: which tab (its key) and whether it has unsaved changes. */
export interface OtherEdit extends EditInfo {
	tabKey: string;
}

/** dashboardId → the other tabs editing it. */
export type Presence = Map<string, OtherEdit[]>;

export type AddRoute =
	| { kind: 'draft-here' }
	| { kind: 'handoff'; tabKey: string }
	| { kind: 'save-notify' }
	| { kind: 'save' };

/**
 * How /add adds to `dashboardId`: into this tab's draft; handed to another tab with unsaved
 * changes (preferring a live session over a parked draft); a direct save that tells a CLEAN
 * editing tab; or a plain direct save.
 */
export function chooseRoute(dashboardId: string, editingHere: string | null, presence: Presence | null): AddRoute {
	if (dashboardId === editingHere) return { kind: 'draft-here' };
	const edits = presence?.get(dashboardId) ?? [];
	const dirtyOne = edits.find((e) => e.dirty && !e.parked) ?? edits.find((e) => e.dirty);
	if (dirtyOne) return { kind: 'handoff', tabKey: dirtyOne.tabKey };
	if (edits.length) return { kind: 'save-notify' };
	return { kind: 'save' };
}

/** A fresh id (idempotency key / tab key). */
export function newId(): string {
	return typeof crypto !== 'undefined' && 'randomUUID' in crypto
		? crypto.randomUUID()
		: Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// ---------------------------------------------------------------- the editing tab's side

export interface EditorDeps {
	/** This tab's edits (session and parked draft). */
	edits(): EditInfo[];
	/** Add `tile` to this tab's live draft of `dashboardId` (the normal edit path); a reason when it can't. */
	addToDraft(dashboardId: string, tile: TileNode, to: AddTo): true | string;
	/** A direct save of `dashboardId` at `revision` was made from /add. */
	externalSave(dashboardId: string, revision: number): void;
}

/**
 * The editing tab's answer to one message, or null. Pure apart from `deps`, so unit-tested.
 * `handled` remembers hand-offs already taken (by idempotency id) with their answers: a repeat
 * gets the same answer and adds nothing.
 */
export function editorReply(msg: Msg, tabKey: string, deps: EditorDeps, handled: Map<string, Msg>): Msg | null {
	if (msg?.type === 'who') {
		const edits = deps.edits();
		return edits.length ? { type: 'here', reqId: msg.reqId, tabKey, edits } : null;
	}
	if (msg?.type === 'add') {
		if (msg.toTab !== tabKey) return null;
		const done = handled.get(msg.addId);
		if (done) return done;
		const r = deps.addToDraft(msg.dashboardId, msg.tile, msg.to);
		const reply: Msg = r === true ? { type: 'added', addId: msg.addId, ok: true } : { type: 'added', addId: msg.addId, ok: false, reason: r };
		handled.set(msg.addId, reply);
		return reply;
	}
	if (msg?.type === 'saved') deps.externalSave(msg.dashboardId, msg.revision);
	return null;
}

function liveEdits(): EditInfo[] {
	const out: EditInfo[] = [];
	const s = get(session);
	if (s) out.push({ dashboardId: s.dashboardId, dirty: get(dirty) });
	const p = get(parkedDraft);
	if (p && p.dashboardId !== s?.dashboardId) out.push({ dashboardId: p.dashboardId, dirty: true, parked: true });
	return out;
}

const liveDeps: EditorDeps = {
	edits: liveEdits,
	addToDraft(dashboardId, tile, to) {
		const s = get(session);
		if (!s || s.dashboardId !== dashboardId) {
			return get(parkedDraft)?.dashboardId === dashboardId
				? 'that tab was signed out (its unsaved changes are kept, but it is not editing right now)'
				: 'that tab is no longer editing this dashboard';
		}
		let failure = '';
		let next: LayoutDashboard | null = null;
		try {
			next = withNewTile(s.draft, tile, to).dashboard;
		} catch (e) {
			failure = e instanceof Error && e.message ? e.message : "the tile couldn't be placed";
		}
		if (!next) return failure;
		if (!apply('Add tile', () => next!)) return "the tile couldn't be added to its unsaved changes";
		toast.success(`Added “${tile.name}” from Add to HOPS — save to keep it.`, 8000);
		return true;
	},
	externalSave(dashboardId, revision) {
		const s = get(session);
		if (!s || s.dashboardId !== dashboardId || revision <= s.baseRevision) return;
		if (get(dirty)) {
			toast.warning(
				'A tile was saved to this dashboard from Add to HOPS while you have unsaved changes here. When you save, HOPS will ask how to resolve the clash.',
				0
			);
			return;
		}
		expectExternalSave(dashboardId, revision, 'A tile was added from Add to HOPS. You are editing the latest version.');
		void loadConfig({ background: true });
	}
};

/**
 * This tab answers presence questions, announces its edit state when it changes, takes tiles
 * handed over from /add in another tab, and follows a direct save made there. Returns a stop function.
 */
export function initEditPresence(): () => void {
	if (typeof BroadcastChannel === 'undefined') return () => {};
	const ch = new BroadcastChannel(CHANNEL);
	const tabKey = newId();
	const handled = new Map<string, Msg>();
	ch.onmessage = (e: MessageEvent<Msg>) => {
		const reply = editorReply(e.data, tabKey, liveDeps, handled);
		if (reply) ch.postMessage(reply);
	};
	let last = '';
	const announce = () => {
		const edits = liveEdits();
		const key = JSON.stringify(edits);
		if (key === last) return;
		last = key;
		ch.postMessage({ type: 'state', tabKey, edits } satisfies Msg);
	};
	const unsubs = [session.subscribe(announce), dirty.subscribe(announce), parkedDraft.subscribe(announce)];
	const gone = () => ch.postMessage({ type: 'state', tabKey, edits: [] } satisfies Msg);
	window.addEventListener('pagehide', gone);
	return () => {
		unsubs.forEach((u) => u());
		window.removeEventListener('pagehide', gone);
		ch.close();
	};
}

// ---------------------------------------------------------------- /add's side

/** Fold one message into a presence map (replies to `reqId`, and live state announcements). */
export function foldPresence(p: Presence, msg: Msg, reqId?: string): boolean {
	if (!(msg?.type === 'state' || (msg?.type === 'here' && msg.reqId === reqId))) return false;
	for (const [id, list] of p) {
		const rest = list.filter((x) => x.tabKey !== msg.tabKey);
		if (rest.length) p.set(id, rest);
		else p.delete(id);
	}
	for (const e of msg.edits) p.set(e.dashboardId, [...(p.get(e.dashboardId) ?? []), { ...e, tabKey: msg.tabKey }]);
	return true;
}

export interface PresenceWatch {
	/** Ask every tab again; resolves with the answers after `waitMs` (null: this browser can't ask). */
	query(waitMs?: number): Promise<Presence | null>;
	/** Hand `tile` to tab `tabKey`; resolves with its answer, or 'timeout' with none within `waitMs`. */
	handOff(
		o: { addId: string; tabKey: string; dashboardId: string; tile: TileNode; to: AddTo },
		waitMs?: number
	): Promise<{ ok: true } | { ok: false; reason: string } | 'timeout'>;
	/** Tell editing tabs that `dashboardId` was saved at `revision`. */
	announceSaved(dashboardId: string, revision: number): void;
	close(): void;
}

/** /add's channel: live presence (`onChange` on every update) plus querying and hand-offs. */
export function watchPresence(onChange: (p: Presence) => void): PresenceWatch | null {
	if (typeof BroadcastChannel === 'undefined') return null;
	const ch = new BroadcastChannel(CHANNEL);
	let current: Presence = new Map();
	let pendingReq: { reqId: string; p: Presence } | null = null;
	const waiting = new Map<string, (r: { ok: true } | { ok: false; reason: string }) => void>();
	ch.onmessage = (e: MessageEvent<Msg>) => {
		const m = e.data;
		if (m?.type === 'added') {
			waiting.get(m.addId)?.(m.ok ? { ok: true } : { ok: false, reason: m.reason });
			return;
		}
		if (pendingReq) foldPresence(pendingReq.p, m, pendingReq.reqId);
		if (foldPresence(current, m, pendingReq?.reqId)) onChange(new Map(current));
	};
	return {
		query(waitMs = 1000) {
			const reqId = newId();
			const req = { reqId, p: new Map() as Presence };
			pendingReq = req;
			ch.postMessage({ type: 'who', reqId } satisfies Msg);
			return new Promise((resolve) =>
				setTimeout(() => {
					if (pendingReq === req) pendingReq = null;
					current = new Map(req.p);
					onChange(new Map(current));
					resolve(new Map(req.p));
				}, waitMs)
			);
		},
		handOff(o, waitMs = 3000) {
			return new Promise((resolve) => {
				const t = setTimeout(() => {
					waiting.delete(o.addId);
					resolve('timeout');
				}, waitMs);
				waiting.set(o.addId, (r) => {
					clearTimeout(t);
					waiting.delete(o.addId);
					resolve(r);
				});
				ch.postMessage({ type: 'add', addId: o.addId, toTab: o.tabKey, dashboardId: o.dashboardId, tile: o.tile, to: o.to } satisfies Msg);
			});
		},
		announceSaved(dashboardId, revision) {
			ch.postMessage({ type: 'saved', dashboardId, revision } satisfies Msg);
		},
		close() {
			ch.close();
		}
	};
}
