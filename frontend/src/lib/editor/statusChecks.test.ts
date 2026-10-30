import { describe, it, expect } from 'vitest';
import fixture from '../../../../backend/internal/configdoc/testdata/status_checks_cases.json';
import {
  dashboardBase, isCheckableTile, resolveStatusChecks, tileSetting, gateSetting, gatesAbove, gatePlace, levelNameIn,
  disabledTooltip, tileMayBeChecked
} from './statusChecks';
import type { LayoutDashboard } from '$lib/types/layout';

// The resolver matrix shared with the Go test: every case must pass here too, so the
// dialogs' "effect" text can never drift from what the checker does.
// Conventions: backend/internal/configdoc/testdata/status_checks_cases.README.md.
interface Case {
  name: string;
  global: boolean;
  dashboardOverride: boolean | null;
  tab: boolean | null | 'invalid';
  folders: (boolean | null | 'invalid')[];
  tile: boolean | null | 'absent' | 'noEnabled' | 'invalid';
  want: { on: boolean; source: string; sourceIdx?: number; sourceId?: string };
}

const cases = fixture as unknown as Case[];
const on = { id: 'x', statusCheck: { type: 'http', enabled: true } };

function level(o: Record<string, unknown>, v: boolean | null | 'invalid') {
  if (v === 'invalid') o.statusChecksEnabled = 'yes';
  else if (v !== null) o.statusChecksEnabled = v;
  return o;
}

function tileOf(v: Case['tile']): Record<string, unknown> {
  const t: Record<string, unknown> = { id: 'x', kind: 'tile' };
  if (v === 'absent') return t;
  if (v === 'noEnabled') t.statusCheck = { type: 'http' };
  else if (v === 'invalid') t.statusCheck = { type: 'http', enabled: 'yes' };
  else t.statusCheck = { type: 'http', enabled: v };
  return t;
}

describe('resolveStatusChecks: the shared fixture (same cases as the Go resolver)', () => {
  it('has cases', () => {
    expect(cases.length).toBeGreaterThan(10);
  });
  for (const c of cases) {
    it(c.name, () => {
      const base = dashboardBase('d', c.dashboardOverride, c.global);
      const tab = level({ id: 't' }, c.tab);
      const folders = c.folders.map((f, i) => level({ id: `f${i}`, kind: 'folder' }, f));
      const got = resolveStatusChecks(base, tab, folders, tileOf(c.tile));
      let wantId = ({ global: '', dashboard: 'd', tab: 't', tile: 'x' } as Record<string, string>)[c.want.source];
      if (c.want.source === 'folder') wantId = `f${c.want.sourceIdx}`;
      if (c.want.sourceId !== undefined) wantId = c.want.sourceId;
      expect(got).toEqual({ on: c.want.on, source: c.want.source, sourceId: wantId });
    });
  }
});

describe('resolveStatusChecks without the top gates', () => {
  it('even a tile that is Off waits for the base (a Disabled gate above would be named instead)', () => {
    expect(resolveStatusChecks(null, { id: 't' }, [], { id: 'x', statusCheck: { enabled: false } })).toBeNull();
  });
  it('answers an invalid level before the base is needed', () => {
    expect(resolveStatusChecks(null, { id: 't' }, [{ id: 'f0', statusChecksEnabled: 1 }], on)).toEqual({
      on: false, source: 'invalid', sourceId: 'f0'
    });
  });
  it('returns null (unknown — never a guess) for an On tile until the base is known', () => {
    expect(resolveStatusChecks(null, { id: 't', statusChecksEnabled: false }, [{ id: 'f0' }], on)).toBeNull();
  });
  it('a wrong-typed dashboard override is ignored (as Resolve does): the dashboard stays Enabled', () => {
    expect(dashboardBase('d', 'yes', true)).toEqual({ dashboardId: 'd', global: true, dashboard: true });
    expect(dashboardBase('d', true, false)).toEqual({ dashboardId: 'd', global: false, dashboard: true });
    expect(dashboardBase('d', false, true)).toEqual({ dashboardId: 'd', global: true, dashboard: false });
  });
});

describe('gatesAbove', () => {
  const base = (global: boolean, dashboard: boolean) => ({ dashboardId: 'd', global, dashboard });
  it('all Enabled: null (allowed)', () => {
    expect(gatesAbove(base(true, true), { id: 't', statusChecksEnabled: true }, [{ id: 'f0', statusChecksEnabled: null }])).toBeNull();
  });
  it('names the outermost Disabled gate and counts the rest', () => {
    expect(gatesAbove(base(false, false), { id: 't', statusChecksEnabled: false }, [{ id: 'f0', statusChecksEnabled: false }])).toEqual({
      source: 'global', sourceId: '', more: 3
    });
    expect(gatesAbove(base(true, true), { id: 't' }, [{ id: 'f0', statusChecksEnabled: false }, { id: 'f1', statusChecksEnabled: false }])).toEqual({
      source: 'folder', sourceId: 'f0', more: 1
    });
  });
  it('the dashboard dialog leaves its own gate out', () => {
    expect(gatesAbove(base(true, false), null, [], true)).toBeNull();
    expect(gatesAbove(base(false, false), null, [], true)).toEqual({ source: 'global', sourceId: '', more: 0 });
  });
  it('unknown base: undefined, unless an invalid gate already decides', () => {
    expect(gatesAbove(null, { id: 't' }, [])).toBeUndefined();
    expect(gatesAbove(null, { id: 't', statusChecksEnabled: 'no' }, [])).toEqual({ source: 'invalid', sourceId: 't', more: 0 });
  });
});

describe('the settings as the dialogs see them', () => {
  it('tile: On only for enabled true; null, false and absent are Off', () => {
    expect(tileSetting({ statusCheck: { type: 'http', enabled: true } })).toBe('on');
    expect(tileSetting({ statusCheck: { type: 'http', enabled: false } })).toBe('off');
    expect(tileSetting({ statusCheck: { type: 'http', enabled: null } })).toBe('off');
    expect(tileSetting({})).toBe('off');
    expect(tileSetting({ statusCheck: null })).toBe('off');
    expect(tileSetting({ statusCheck: { type: 'http' } })).toBe('off');
    expect(tileSetting({ statusCheck: { type: 'http', enabled: 'yes' } })).toBe('invalid');
    expect(tileSetting({ statusCheck: 'on' })).toBe('invalid');
  });
  it('gate: only false is Disabled', () => {
    expect(gateSetting(undefined)).toBe('enabled');
    expect(gateSetting(null)).toBe('enabled');
    expect(gateSetting(true)).toBe('enabled');
    expect(gateSetting(false)).toBe('disabled');
    expect(gateSetting('yes')).toBe('invalid');
  });
  it('tileMayBeChecked: On or invalid (the badge says why), never Off', () => {
    expect(tileMayBeChecked({ statusCheck: { enabled: true } })).toBe(true);
    expect(tileMayBeChecked({ statusCheck: { enabled: 'yes' } })).toBe(true);
    expect(tileMayBeChecked({ statusCheck: { enabled: null } })).toBe(false);
    expect(tileMayBeChecked({})).toBe(false);
  });
});

describe('level names and the badge tooltip', () => {
  const dash = {
    id: 'd', name: 'Home', path: '/h', revision: 1,
    tabs: [{ id: 't', name: 'Main', root: { columns: 24, children: [
      { kind: 'folder', id: 'f0', name: 'Media', display: 'expanded', placement: { x: 0, y: 0, w: 2, h: 2 },
        content: { children: [{ kind: 'tile', id: 'x', name: 'Plex' }] } }
    ] } }]
  } as unknown as LayoutDashboard;

  it('finds each level by id', () => {
    expect(levelNameIn([dash], 'global', '')).toBe('Settings');
    expect(levelNameIn([dash], 'dashboard', 'd')).toBe('Home');
    expect(levelNameIn([dash], 'tab', 't')).toBe('Main');
    expect(levelNameIn([dash], 'folder', 'f0')).toBe('Media');
    expect(levelNameIn([dash], 'invalid', 'x')).toBe('Plex');
  });
  it('an id it cannot find is still named (by id), never blank', () => {
    expect(levelNameIn([dash], 'folder', 'gone')).toBe('folder gone');
  });
  it('gatePlace', () => {
    expect(gatePlace('global', undefined)).toBe('in Settings');
    expect(gatePlace('tab', 'Main')).toBe('on tab Main');
    expect(gatePlace('folder', '  ')).toBe('on an untitled folder');
  });
  it('tooltip from the source', () => {
    expect(disabledTooltip([dash], 'dashboard', 'd')).toBe('Not checked: status monitoring is disabled on dashboard Home');
    expect(disabledTooltip([dash], 'folder', 'f0')).toBe('Not checked: status monitoring is disabled on folder Media');
    expect(disabledTooltip([dash], 'global', '')).toBe('Not checked: status monitoring is disabled in Settings');
    expect(disabledTooltip([dash], 'invalid', 'f0')).toBe('Not checked: invalid status-check setting on Media');
    expect(disabledTooltip([dash], 'tile', 'x')).toBe('Status check is Off for this tile');
    expect(disabledTooltip([dash], undefined, undefined)).toBe('Status check is Off for this tile');
  });
});

// The twin of Go's configdoc.IsCheckableTile (same cases): the checker skips notes and URL-less tiles.
describe('isCheckableTile', () => {
  it.each([
    [{ url: 'http://a' }, true],
    [{ type: 'link', url: 'http://a' }, true],
    [{ type: 'note', url: 'http://a' }, false],
    [{ type: 'note' }, false],
    [{ url: '' }, false],
    [{}, false],
    [{ url: 7 }, false],
    [null, false]
  ])('%j → %s', (tile, want) => {
    expect(isCheckableTile(tile as never)).toBe(want);
  });
});
