import { describe, it, expect } from 'vitest';
import { normalizeAddress, findDuplicates, removeTiles, scopeGroups } from './duplicates';
import type { LayoutDoc } from '$lib/types/layout';

const tile = (id: string, name: string, url: string, extra: Record<string, unknown> = {}) =>
  ({ id, kind: 'tile', type: 'link', name, url, icon: 'mdi:lan', openMode: 'newtab', size: 'medium', order: 0, ...extra });

const doc = (dashboards: unknown[]) => ({ schemaVersion: 3, dashboards }) as unknown as LayoutDoc;
const dash = (id: string, name: string, children: unknown[], tab2: unknown[] = []) => ({
  id, name, path: `/${id}`, revision: 1,
  tabs: [
    { id: `${id}-t1`, name: 'Main', root: { columns: 24, children } },
    { id: `${id}-t2`, name: 'Other', root: { columns: 24, children: tab2 } }
  ]
});
const folder = (id: string, name: string, children: unknown[]) => ({ id, kind: 'folder', name, display: 'expanded', content: { children } });

describe('normalizeAddress', () => {
  it('lower-cases scheme and host, drops default ports and the trailing slash', () => {
    expect(normalizeAddress('HTTPS://Plex.Example.LAN:443/')).toBe('https://plex.example.lan');
    expect(normalizeAddress('http://plex.example.lan:80')).toBe('http://plex.example.lan');
    expect(normalizeAddress('http://plex.example.lan:8080/web/')).toBe('http://plex.example.lan:8080/web');
    expect(normalizeAddress('ssh://nas.lan:22')).toBe('ssh://nas.lan');
  });
  it('keeps the path case, query and a non-default port', () => {
    expect(normalizeAddress('https://a.lan/Path?x=1')).toBe('https://a.lan/Path?x=1');
    expect(normalizeAddress('https://a.lan:8443/')).toBe('https://a.lan:8443');
  });
  it('does not strip www', () => {
    expect(normalizeAddress('https://www.a.lan/')).not.toBe(normalizeAddress('https://a.lan/'));
  });
  it('returns null for empty or unparseable addresses', () => {
    expect(normalizeAddress('')).toBeNull();
    expect(normalizeAddress('   ')).toBeNull();
    expect(normalizeAddress('not a url')).toBeNull();
  });
});

describe('findDuplicates', () => {
  it('groups across dashboards, tabs and nested folders, with paths', () => {
    const d = doc([
      dash('a', 'Home', [tile('p1', 'Plex', 'https://plex.lan/'), folder('f1', 'Media', [folder('f2', 'Deep', [tile('p2', 'Plex too', 'HTTPS://PLEX.lan:443')])])]),
      dash('b', 'Lab', [tile('x', 'Other', 'https://other.lan/')], [tile('p3', 'Plex', 'https://plex.lan', { awayUrl: 'https://away.example/' })])
    ]);
    const r = findDuplicates(d);
    expect(r.totalTiles).toBe(4);
    expect(r.groups).toHaveLength(1);
    const g = r.groups[0];
    expect(g.address).toBe('https://plex.lan');
    expect(g.tiles.map((t) => t.id)).toEqual(['p1', 'p2', 'p3']);
    expect(g.tiles[1].path).toEqual(['Home', 'Main', 'Media', 'Deep']);
    expect(g.tiles[1].folderIds).toEqual(['f1', 'f2']);
    expect(g.tiles[2].path).toEqual(['Lab', 'Other']);
    expect(g.tiles[2].awayUrl).toBe('https://away.example/');
  });
  it('does not group www with non-www, or different awayUrls apart', () => {
    const d = doc([dash('a', 'Home', [tile('1', 'A', 'https://a.lan/'), tile('2', 'B', 'https://www.a.lan/')])]);
    expect(findDuplicates(d).groups).toEqual([]);
    const e = doc([dash('a', 'Home', [tile('1', 'A', 'https://a.lan/', { awayUrl: 'https://x/' }), tile('2', 'B', 'https://a.lan/')])]);
    expect(findDuplicates(e).groups).toHaveLength(1);
  });
  it('skips tiles with no address (notes)', () => {
    const d = doc([dash('a', 'Home', [tile('1', 'N1', '', { type: 'note' }), tile('2', 'N2', '', { type: 'note' })])]);
    expect(findDuplicates(d).groups).toEqual([]);
    expect(findDuplicates(d).totalTiles).toBe(2);
  });
  it('handles a null document', () => {
    expect(findDuplicates(null)).toEqual({ groups: [], totalTiles: 0 });
  });
});

describe('removeTiles', () => {
  it('removes tiles at any depth and leaves everything else', () => {
    const d = dash('a', 'Home', [tile('p1', 'Plex', 'https://plex.lan/'), folder('f1', 'Media', [tile('p2', 'Plex', 'https://plex.lan/'), tile('k', 'Keep', 'https://k.lan')])]);
    const out = removeTiles(d as never, new Set(['p1', 'p2']));
    const kids = out.tabs[0].root.children as Array<{ id: string; content?: { children: Array<{ id: string }> } }>;
    expect(kids.map((n) => n.id)).toEqual(['f1']);
    expect(kids[0].content!.children.map((n) => n.id)).toEqual(['k']);
    expect((d.tabs[0].root.children as unknown[]).length).toBe(2); // input untouched
  });
});

describe('scopeGroups', () => {
  const U = 'https://x.example.lan/';
  // Dashboard A: tab1 loose + folder F1 (2 copies) + folder F2 (1 copy); tab2 loose. Dashboard B: loose + folder F3.
  const d = doc([
    dash('a', 'A', [tile('a1', 'one', U), tile('a2', 'two', U), folder('f1', 'F1', [tile('a3', 'three', U), tile('a4', 'four', U)]), folder('f2', 'F2', [tile('a5', 'five', U)])], [tile('a6', 'six', U)]),
    dash('b', 'B', [tile('b1', 'b-one', U), folder('f3', 'F3', [tile('b2', 'b-two', U)])])
  ]);
  const groups = findDuplicates(d).groups;
  const ids = (s: Parameters<typeof scopeGroups>[1]) => scopeGroups(groups, s).map((g) => g.tiles.map((t) => t.id).sort());

  it('all is the unchanged groups', () => {
    expect(ids('all')).toEqual([['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'b1', 'b2']]);
  });
  it('dashboard splits by dashboard', () => {
    expect(ids('dashboard').sort()).toEqual([['a1', 'a2', 'a3', 'a4', 'a5', 'a6'], ['b1', 'b2']]);
  });
  it('tab splits by dashboard and tab', () => {
    expect(ids('tab').sort()).toEqual([['a1', 'a2', 'a3', 'a4', 'a5'], ['b1', 'b2']]);
  });
  it('folder keeps only same immediate container', () => {
    // a1+a2 loose in the tab root, a3+a4 in F1; a5, b2 alone in a folder, a6 and b1 alone in their roots.
    expect(ids('folder').sort()).toEqual([['a1', 'a2'], ['a3', 'a4']]);
  });
  it('sub-groups have distinct keys and keep the address', () => {
    const g = scopeGroups(groups, 'folder');
    expect(new Set(g.map((x) => x.key)).size).toBe(2);
    expect(g.every((x) => x.address === 'https://x.example.lan')).toBe(true);
  });
  it('drops sub-groups of one tile', () => {
    const one = findDuplicates(doc([dash('a', 'A', [tile('p', 'p', U)]), dash('b', 'B', [tile('q', 'q', U)])])).groups;
    expect(scopeGroups(one, 'all')).toHaveLength(1);
    expect(scopeGroups(one, 'dashboard')).toHaveLength(0);
  });
});
