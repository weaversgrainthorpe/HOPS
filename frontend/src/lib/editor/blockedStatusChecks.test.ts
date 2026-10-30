import { describe, it, expect } from 'vitest';
import { findBlocked } from './blockedStatusChecks';
import type { LayoutDashboard } from '$lib/types/layout';

const tile = (id: string, enabled?: unknown, extra: Record<string, unknown> = {}) => ({
  kind: 'tile', id, name: id.toUpperCase(), type: 'link', url: `https://${id}.lan/`,
  ...(enabled === undefined ? {} : { statusCheck: { type: 'http', enabled } }), ...extra
});
const folder = (id: string, children: unknown[], gate?: unknown) => ({
  kind: 'folder', id, name: id.toUpperCase(), ...(gate === undefined ? {} : { statusChecksEnabled: gate }), content: { children }
});
const dash = (id: string, children: unknown[], opts: { gate?: unknown; tabGate?: unknown } = {}) => ({
  id, name: `Dash ${id}`, path: `/${id}`, revision: 1,
  ...(opts.gate === undefined ? {} : { settings: { statusChecksEnabled: opts.gate } }),
  tabs: [{ id: `${id}-t`, name: 'Main', ...(opts.tabGate === undefined ? {} : { statusChecksEnabled: opts.tabGate }), root: { columns: 24, children } }]
}) as unknown as LayoutDashboard;

describe('findBlocked', () => {
  it('lists only On tiles under a Disabled gate', () => {
    const d = dash('d', [
      tile('a', true),
      folder('f', [tile('b', true), tile('c', false), tile('n')], false),
      folder('g', [tile('e', true)])
    ]);
    const rows = findBlocked([d]);
    expect(rows.map((r) => r.key)).toEqual(['d:b']);
    expect(rows[0]).toMatchObject({
      tabId: 'd-t', folderIds: ['f'], path: ['Main', 'F', 'B'],
      blockedBy: { source: 'folder', sourceId: 'f', name: 'F', more: 0 }
    });
  });

  it('names the outermost Disabled gate and counts the others', () => {
    const d = dash('d', [folder('f', [folder('g', [tile('x', true)], false)], false)], { gate: false, tabGate: false });
    expect(findBlocked([d])[0].blockedBy).toEqual({ source: 'dashboard', sourceId: 'd', name: 'Dash d', more: 3 });
  });

  it('a dashboard stored true or null is Enabled; notes and URL-less tiles are never listed', () => {
    expect(findBlocked([dash('d', [tile('a', true)], { gate: true })])).toEqual([]);
    expect(findBlocked([dash('d', [tile('a', true)], { gate: null })])).toEqual([]);
    expect(findBlocked([dash('d', [tile('a', true, { type: 'note' }), tile('b', true, { url: '' })], { gate: false })])).toEqual([]);
  });

  it('a wrong-typed gate is reported as what blocks the tile', () => {
    const rows = findBlocked([dash('d', [folder('f', [tile('a', true)], 'yes')])]);
    expect(rows[0].blockedBy).toMatchObject({ source: 'invalid', sourceId: 'f', name: 'F' });
  });
});
