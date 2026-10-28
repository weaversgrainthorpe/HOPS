import { describe, it, expect } from 'vitest';
import { findOverrides, previewRestore, withInheritanceRestored, type Bases } from './statusOverrides';
import type { DashboardBase } from './statusChecks';
import type { LayoutDashboard } from '$lib/types/layout';

const tile = (id: string, enabled?: unknown, extra: Record<string, unknown> = {}) => ({
  kind: 'tile', id, name: id, ...(enabled === undefined && !Object.keys(extra).length ? {} : { statusCheck: { ...extra, ...(enabled === undefined ? {} : { enabled }) } })
});
const folder = (id: string, children: unknown[], on?: unknown) => ({
  kind: 'folder', id, name: id, ...(on === undefined ? {} : { statusChecksEnabled: on }), content: { children }
});
const tab = (id: string, children: unknown[], on?: unknown) => ({
  id, name: id, ...(on === undefined ? {} : { statusChecksEnabled: on }), root: { columns: 24, children }
});
const dash = (id: string, tabs: unknown[]) => ({ id, name: id, path: id, revision: 1, tabs }) as unknown as LayoutDashboard;
const base = (id: string, on: boolean, source: 'dashboard' | 'global'): DashboardBase => ({ on, source, dashboardId: id });

describe('findOverrides', () => {
  it('a tile On under a dashboard Off', () => {
    const d = dash('d', [tab('t', [tile('a', true)])]);
    const rows = findOverrides([d], { d: base('d', false, 'dashboard') }, false);
    const tileRows = rows.filter((r) => r.level === 'tile');
    expect(tileRows).toHaveLength(1);
    expect(tileRows[0]).toMatchObject({
      key: 'd:tile:a', now: 'on', path: ['t', 'a'], inherited: { on: false, source: 'dashboard' },
      effect: { start: 0, stop: 1 }, changes: true
    });
  });

  it('a folder Off over two inheriting tiles', () => {
    const d = dash('d', [tab('t', [folder('f', [tile('a'), tile('b')], false)])]);
    const rows = findOverrides([d], { d: base('d', true, 'global') }, true);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ level: 'folder', now: 'off', path: ['t', 'f'], effect: { start: 2, stop: 0 }, changes: true });
  });

  it('a folder with no effect', () => {
    const d = dash('d', [tab('t', [folder('f', [tile('a', false), tile('b', false)], true)])]);
    const rows = findOverrides([d], { d: base('d', true, 'global') }, true);
    const f = rows.find((r) => r.level === 'folder')!;
    expect(f.effect).toEqual({ start: 0, stop: 0 });
    expect(f.changes).toBe(false);
  });

  it('an invalid tile', () => {
    const d = dash('d', [tab('t', [{ kind: 'tile', id: 'a', name: 'a', statusCheck: 'yes' }])]);
    const rows = findOverrides([d], { d: base('d', true, 'global') }, true);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ now: 'invalid', changes: true });
  });

  it('absent and null give no row', () => {
    const d = dash('d', [tab('t', [tile('a'), tile('b', null), tile('c', undefined, { type: 'http' })])]);
    expect(findOverrides([d], { d: base('d', true, 'global') }, true)).toEqual([]);
  });

  it('a dashboard row counts only the tiles that inherit', () => {
    const d = dash('d', [tab('t', [tile('a'), tile('b', false), tile('c', true)])]);
    const rows = findOverrides([d], { d: base('d', false, 'dashboard') }, true);
    const dr = rows.find((r) => r.level === 'dashboard')!;
    expect(dr).toMatchObject({ key: 'd:dashboard:d', id: 'd', path: [], now: 'off', inherited: { on: true, source: 'global' }, effect: { start: 1, stop: 0 }, changes: true });
  });

  it('an unknown base gives null inherited and effect', () => {
    const d = dash('d', [tab('t', [tile('a', true)])]);
    const rows = findOverrides([d], { d: null }, null);
    expect(rows).toHaveLength(1);
    expect(rows[0].inherited).toBeNull();
    expect(rows[0].effect).toBeNull();
  });

  it('an unknown global nulls a dashboard row only', () => {
    const d = dash('d', [tab('t', [tile('a', true)])]);
    const rows = findOverrides([d], { d: base('d', false, 'dashboard') }, null);
    const dr = rows.find((r) => r.level === 'dashboard')!;
    expect(dr.inherited).toBeNull();
    expect(dr.effect).toBeNull();
    expect(rows.find((r) => r.level === 'tile')!.effect).toEqual({ start: 0, stop: 1 });
  });

  it('follows on-screen order with paths', () => {
    const d1 = dash('d1', [
      tab('t1', [folder('f1', [tile('a', true), folder('f2', [tile('b', false)], true)], false), tile('c', true)], false),
      tab('t2', [tile('e', false)])
    ]);
    const d2 = dash('d2', [tab('t3', [tile('z', true)])]);
    const rows = findOverrides([d1, d2], { d1: base('d1', true, 'global'), d2: base('d2', true, 'global') }, true);
    expect(rows.map((r) => r.key)).toEqual([
      'd1:tab:t1', 'd1:folder:f1', 'd1:tile:a', 'd1:folder:f2', 'd1:tile:b', 'd1:tile:c', 'd1:tile:e', 'd2:tile:z'
    ]);
    expect(rows.find((r) => r.id === 'b')!.path).toEqual(['t1', 'f1', 'f2', 'b']);
    expect(rows.find((r) => r.id === 't1')!.path).toEqual(['t1']);
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
  });
});

describe('previewRestore', () => {
  // A folder Off holds tile a (explicit On) and tile b (inherits, so off).
  const d = dash('d', [tab('t', [folder('f', [tile('a', true), tile('b')], false)])]);
  const bases: Bases = { d: base('d', true, 'global') };
  it('restoring the tile alone stops it', () => {
    const r = previewRestore([d], bases, true, ['d:tile:a']);
    expect(r.start).toEqual([]);
    expect(r.stop).toEqual([{ dashboardId: 'd', id: 'a', path: ['t', 'f', 'a'] }]);
  });
  it('restoring both: the tile inherits On, so only b starts', () => {
    const r = previewRestore([d], bases, true, ['d:tile:a', 'd:folder:f']);
    expect(r.stop).toEqual([]);
    expect(r.start).toEqual([{ dashboardId: 'd', id: 'b', path: ['t', 'f', 'b'] }]);
  });
  it('ignores unknown bases and stays on its dashboards', () => {
    const d1 = dash('d1', [tab('t', [tile('a', true)])]);
    const d2 = dash('d2', [tab('t', [tile('b', true)])]);
    const r = previewRestore([d1, d2], { d1: base('d1', false, 'dashboard'), d2: null }, false, ['d1:tile:a', 'd2:tile:b']);
    expect(r.stop.map((t) => t.id)).toEqual(['a']);
  });
});

describe('withInheritanceRestored', () => {
  it('removes enabled, and statusCheck when empty; clears containers; does not mutate', () => {
    const d = dash('d', [
      tab('t', [tile('a', true, { type: 'http', interval: 60 }), tile('b', false), folder('f', [], true)], true)
    ]);
    const copy = JSON.parse(JSON.stringify(d));
    const out = withInheritanceRestored(d, ['d:tile:a', 'd:tile:b', 'd:folder:f', 'd:tab:t']);
    expect(d).toEqual(copy);
    const kids = out.tabs[0].root.children as unknown as Record<string, unknown>[];
    expect(kids[0].statusCheck).toEqual({ type: 'http', interval: 60 });
    expect('statusCheck' in kids[1]).toBe(false);
    expect('statusChecksEnabled' in kids[2]).toBe(false);
    expect('statusChecksEnabled' in out.tabs[0]).toBe(false);
  });
  it('leaves unlisted rows alone', () => {
    const d = dash('d', [tab('t', [tile('a', true)], true)]);
    const out = withInheritanceRestored(d, ['d:tile:zzz']);
    expect(out).toEqual(d);
  });
});
