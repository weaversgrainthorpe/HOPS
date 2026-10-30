import { describe, it, expect } from 'vitest';
import fixture from '../../../../backend/internal/configdoc/testdata/status_checks_cases.json';
import {
  dashboardBase, isCheckableTile, resolveStatusChecks, statusRowText, tileSetting, containerSetting, levelNameIn, disabledTooltip,
  type Resolution
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

describe('resolveStatusChecks without the dashboard base', () => {
  it('answers when a nearer level decides', () => {
    expect(resolveStatusChecks(null, { id: 't', statusChecksEnabled: false }, [], null)).toEqual({
      on: false, source: 'tab', sourceId: 't'
    });
  });
  it('answers an invalid level before the base is needed', () => {
    expect(resolveStatusChecks(null, { id: 't' }, [{ id: 'f0', statusChecksEnabled: 1 }], null)).toEqual({
      on: false, source: 'invalid', sourceId: 'f0'
    });
  });
  it('returns null (unknown — never a guess) when only the base could decide', () => {
    expect(resolveStatusChecks(null, { id: 't' }, [{ id: 'f0' }], null)).toBeNull();
  });
  it('a wrong-typed dashboard override falls back to the global value (as Resolve does)', () => {
    expect(dashboardBase('d', 'yes', true)).toEqual({ on: true, source: 'global', dashboardId: 'd' });
  });
});

describe('the settings as the dialogs see them', () => {
  it('tile: on / off / inherit (including absent) / invalid', () => {
    expect(tileSetting({ statusCheck: { type: 'http', enabled: true } })).toBe('on');
    expect(tileSetting({ statusCheck: { type: 'http', enabled: false } })).toBe('off');
    expect(tileSetting({ statusCheck: { type: 'http', enabled: null } })).toBe('inherit');
    expect(tileSetting({})).toBe('inherit');
    expect(tileSetting({ statusCheck: null })).toBe('inherit');
    expect(tileSetting({ statusCheck: { type: 'http' } })).toBe('inherit');
    expect(tileSetting({ statusCheck: { type: 'http', enabled: 'yes' } })).toBe('invalid');
  });
  it('tab/folder: absent = inherit', () => {
    expect(containerSetting(undefined)).toBe('inherit');
    expect(containerSetting(true)).toBe('on');
    expect(containerSetting(false)).toBe('off');
    expect(containerSetting('yes')).toBe('invalid');
  });
});

describe('statusRowText', () => {
  const names = (r: Resolution) =>
    r.source === 'global' ? 'Settings' : ({ d: 'Home', t: 'Main', f0: 'Media' } as Record<string, string>)[r.sourceId];
  const dashOff: Resolution = { on: false, source: 'dashboard', sourceId: 'd' };
  const dashOn: Resolution = { on: true, source: 'dashboard', sourceId: 'd' };
  const folderOn: Resolution = { on: true, source: 'folder', sourceId: 'f0' };
  const globalOff: Resolution = { on: false, source: 'global', sourceId: '' };

  it('inheriting names the level and the value', () => {
    expect(statusRowText('inherit', dashOff, names).text).toBe('Inherited from Home: off');
    expect(statusRowText('inherit', folderOn, names).text).toBe('Inherited from Media: on');
    expect(statusRowText('inherit', globalOff, names).text).toBe('Inherited from Settings: off');
  });
  it('set here says what it overrides', () => {
    expect(statusRowText('on', dashOff, names).text).toBe('Overridden here: on (the dashboard is off)');
    expect(statusRowText('off', folderOn, names).text).toBe('Overridden here: off (the folder is on)');
    expect(statusRowText('on', globalOff, names).text).toBe('Overridden here: on (the global setting is off)');
    expect(statusRowText('on', dashOn, names).text).toBe('Overridden here: on (the dashboard is on too)');
  });
  it('unknown parent (base still loading) is pending, never a guess', () => {
    expect(statusRowText('inherit', null, names)).toEqual({ text: 'Checking…', tone: 'pending' });
    expect(statusRowText('on', null, names)).toEqual({ text: 'Checking…', tone: 'pending' });
  });
  it('an invalid value above wins and is named', () => {
    const r = statusRowText('on', { on: false, source: 'invalid', sourceId: 'f0' }, names);
    expect(r.tone).toBe('warn');
    expect(r.text).toBe('Off: invalid setting on Media (open it and choose Inherit, On or Off)');
  });
  it('an invalid value here is said so', () => {
    const r = statusRowText('invalid', dashOn, names);
    expect(r.tone).toBe('warn');
    expect(r.text).toMatch(/^Invalid setting here: treated as off/);
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
  it('tooltip from the source', () => {
    expect(disabledTooltip([dash], 'dashboard', 'd')).toBe('Status checks are off for this tile (set on Home)');
    expect(disabledTooltip([dash], 'global', '')).toBe('Status checks are off for this tile (Settings)');
    expect(disabledTooltip([dash], 'invalid', 'f0')).toBe(
      'Status checks are off for this tile: invalid setting on Media'
    );
    expect(disabledTooltip([dash], undefined, undefined)).toBe('Status checks are off for this tile');
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
