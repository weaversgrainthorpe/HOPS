import { describe, it, expect, vi } from 'vitest';
import { chooseRoute, editorReply, foldPresence, type EditorDeps, type Msg, type Presence } from './editPresence';
import type { TileNode } from '$lib/types/layout';

const tile = { id: 'n1', kind: 'tile', type: 'link', name: 'Grafana', url: 'https://g.test/' } as unknown as TileNode;

function deps(over: Partial<EditorDeps> = {}): EditorDeps & { adds: number } {
	const d = {
		adds: 0,
		edits: () => [{ dashboardId: 'd1', dirty: true }],
		addToDraft: vi.fn(() => {
			d.adds++;
			return true as const;
		}),
		externalSave: vi.fn(),
		...over
	};
	return d as EditorDeps & { adds: number };
}

describe('chooseRoute: where /add puts the tile', () => {
	const p = (list: Presence extends Map<string, infer V> ? V : never): Presence => new Map([['d1', list]]);
	it('into this tab\'s draft when this tab edits the dashboard', () => {
		expect(chooseRoute('d1', 'd1', p([{ dashboardId: 'd1', dirty: true, tabKey: 'a' }]))).toEqual({ kind: 'draft-here' });
	});
	it('hands off to a tab with unsaved changes (a live session before a parked draft)', () => {
		expect(chooseRoute('d1', null, p([
			{ dashboardId: 'd1', dirty: true, parked: true, tabKey: 'p' },
			{ dashboardId: 'd1', dirty: true, tabKey: 'a' }
		]))).toEqual({ kind: 'handoff', tabKey: 'a' });
	});
	it('a clean edit elsewhere: save directly and tell it', () => {
		expect(chooseRoute('d1', null, p([{ dashboardId: 'd1', dirty: false, tabKey: 'a' }]))).toEqual({ kind: 'save-notify' });
	});
	it('nobody editing, another dashboard edited, or unknown (no BroadcastChannel): a plain save', () => {
		expect(chooseRoute('d1', null, new Map())).toEqual({ kind: 'save' });
		expect(chooseRoute('d2', null, p([{ dashboardId: 'd1', dirty: true, tabKey: 'a' }]))).toEqual({ kind: 'save' });
		expect(chooseRoute('d1', null, null)).toEqual({ kind: 'save' });
	});
});

describe('editorReply: the editing tab\'s side of the protocol', () => {
	it('answers who with its edits; says nothing when not editing', () => {
		expect(editorReply({ type: 'who', reqId: 'r' }, 'A', deps(), new Map())).toEqual({
			type: 'here', reqId: 'r', tabKey: 'A', edits: [{ dashboardId: 'd1', dirty: true }]
		});
		expect(editorReply({ type: 'who', reqId: 'r' }, 'A', deps({ edits: () => [] }), new Map())).toBeNull();
	});

	it('takes a hand-off addressed to it and ACKs; ignores one for another tab', () => {
		const d = deps();
		const handled = new Map<string, Msg>();
		const msg: Msg = { type: 'add', addId: 'x1', toTab: 'A', dashboardId: 'd1', tile, to: { tabId: 't1' } };
		expect(editorReply({ ...msg, toTab: 'B' }, 'A', d, handled)).toBeNull();
		expect(editorReply(msg, 'A', d, handled)).toEqual({ type: 'added', addId: 'x1', ok: true });
		expect(d.addToDraft).toHaveBeenCalledWith('d1', tile, { tabId: 't1' });
	});

	it('idempotent: the same id again (a retry after a lost ACK) is ACKed without adding twice', () => {
		const d = deps();
		const handled = new Map<string, Msg>();
		const msg: Msg = { type: 'add', addId: 'x1', toTab: 'A', dashboardId: 'd1', tile, to: { tabId: 't1' } };
		editorReply(msg, 'A', d, handled);
		expect(editorReply(msg, 'A', d, handled)).toEqual({ type: 'added', addId: 'x1', ok: true });
		expect(d.adds).toBe(1);
		editorReply({ ...msg, addId: 'x2' }, 'A', d, handled);
		expect(d.adds).toBe(2);
	});

	it('a refusal is answered with its reason', () => {
		const d = deps({ addToDraft: () => 'that tab is no longer editing this dashboard' });
		expect(editorReply({ type: 'add', addId: 'x', toTab: 'A', dashboardId: 'd1', tile, to: { tabId: 't1' } }, 'A', d, new Map()))
			.toEqual({ type: 'added', addId: 'x', ok: false, reason: 'that tab is no longer editing this dashboard' });
	});

	it('a direct save announced from /add is passed on (the session decides clean/dirty)', () => {
		const d = deps();
		expect(editorReply({ type: 'saved', dashboardId: 'd1', revision: 7 }, 'A', d, new Map())).toBeNull();
		expect(d.externalSave).toHaveBeenCalledWith('d1', 7);
	});
});

describe('foldPresence: /add\'s view of other tabs', () => {
	it('adds replies to its question and live announcements; a tab that stops editing drops out', () => {
		const p: Presence = new Map();
		expect(foldPresence(p, { type: 'here', reqId: 'other', tabKey: 'A', edits: [{ dashboardId: 'd1', dirty: true }] }, 'mine')).toBe(false);
		foldPresence(p, { type: 'here', reqId: 'mine', tabKey: 'A', edits: [{ dashboardId: 'd1', dirty: false }] }, 'mine');
		expect(p.get('d1')).toEqual([{ dashboardId: 'd1', dirty: false, tabKey: 'A' }]);
		foldPresence(p, { type: 'state', tabKey: 'A', edits: [{ dashboardId: 'd1', dirty: true }] });
		expect(p.get('d1')).toEqual([{ dashboardId: 'd1', dirty: true, tabKey: 'A' }]);
		foldPresence(p, { type: 'state', tabKey: 'A', edits: [] });
		expect(p.has('d1')).toBe(false);
	});
});
