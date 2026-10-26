import { describe, it, expect } from 'vitest';
import { buildSearchIndex, rankSearch, hostOf } from './searchIndex';
import type { LayoutDoc } from '$lib/types/layout';

const tile = (id: string, name: string, extra: any = {}): any => ({ kind: 'tile', id, name, url: 'http://x.test/' + id, ...extra });
const folder = (id: string, name: string, children: any[], extra: any = {}): any => ({
  kind: 'folder', id, name, display: 'expanded', content: { children }, ...extra
});

// Media (minimised, paged) > Downloads > Sonarr, on tab "Media"; plus a flat tab.
const doc = (): LayoutDoc => ({
  dashboards: [
    {
      id: 'd1', name: 'Home', path: '/home', revision: 1,
      tabs: [
        { id: 't0', name: 'Main', root: { columns: 24, children: [tile('a', 'Alpha', { description: 'the first one' })] } },
        {
          id: 't1', name: 'Media',
          root: { columns: 24, children: [
            folder('dl', 'Downloads', [
              ...Array.from({ length: 30 }, (_, i) => tile('f' + i, 'Filler ' + i)),
              folder('sub', 'Sub', [tile('sonarr', 'Sonarr', { url: 'https://tv.example.org:8989/app' })])
            ], { display: 'collapsed', paging: { perPage: 10 } })
          ] }
        }
      ]
    },
    { id: 'd2', name: 'Lab', path: '/lab', revision: 1, tabs: [{ id: 'u', name: 'Bench', root: { columns: 24, children: [tile('o', 'Other')] } }] }
  ]
} as unknown as LayoutDoc);

describe('buildSearchIndex', () => {
  it('indexes tiles at any depth, inside minimised and paged folders, with the path text', () => {
    const idx = buildSearchIndex(doc(), 'd1');
    const s = idx.find((r) => r.id === 'sonarr')!;
    expect(s.kind).toBe('tile');
    expect(s.path).toBe('Media › Downloads › Sub › Sonarr');
    expect(s.folderIds).toEqual(['dl', 'sub']);
    expect(s.tabId).toBe('t1');
    expect(idx.filter((r) => r.kind === 'tile').length).toBe(1 + 30 + 1); // Alpha, 30 fillers, Sonarr
  });
  it('indexes folders as results too; a folder\'s own chain ends with itself', () => {
    const idx = buildSearchIndex(doc(), 'd1');
    const sub = idx.find((r) => r.id === 'sub')!;
    expect(sub.kind).toBe('folder');
    expect(sub.path).toBe('Media › Downloads › Sub');
    expect(sub.folderIds).toEqual(['dl', 'sub']);
    expect(idx.find((r) => r.id === 'dl')!.folderIds).toEqual(['dl']);
  });
  it('scopes to one dashboard, or covers all when none is given', () => {
    expect(buildSearchIndex(doc(), 'd1').some((r) => r.id === 'o')).toBe(false);
    expect(buildSearchIndex(doc()).some((r) => r.id === 'o')).toBe(true);
  });
  it('tolerates junk nodes', () => {
    const d = doc();
    (d.dashboards[0].tabs[0].root as any).children.push(null, 5, { kind: 'tile' });
    expect(() => buildSearchIndex(d, 'd1')).not.toThrow();
  });
});

describe('hostOf', () => {
  it('extracts the host, empty for junk', () => {
    expect(hostOf('https://tv.example.org:8989/app')).toBe('tv.example.org:8989');
    expect(hostOf('nonsense')).toBe('');
    expect(hostOf(undefined)).toBe('');
  });
});

describe('rankSearch', () => {
  const idx = () => buildSearchIndex(doc(), 'd1');
  it('matches name, description and URL host', () => {
    expect(rankSearch(idx(), 'sonarr', 50).map((r) => r.id)).toContain('sonarr');
    expect(rankSearch(idx(), 'first one', 50).map((r) => r.id)).toEqual(['a']);
    expect(rankSearch(idx(), 'example.org', 50).map((r) => r.id)).toEqual(['sonarr']);
  });
  it('ranks exact name, then prefix, then contains, then host/description', () => {
    const items = buildSearchIndex({
      dashboards: [{ id: 'd', name: 'D', path: '/d', revision: 1, tabs: [{ id: 't', name: 'T', root: { columns: 24, children: [
        tile('1', 'my plex box'), tile('2', 'Other', { description: 'plex notes' }), tile('3', 'Plexus'), tile('4', 'Plex'),
        tile('5', 'Z', { url: 'http://plex.lan/' })
      ] } }] }]
    } as unknown as LayoutDoc);
    expect(rankSearch(items, 'plex', 50).map((r) => r.id)).toEqual(['4', '3', '1', '5', '2']);
  });
  it('caps the results and ignores an empty query', () => {
    expect(rankSearch(idx(), 'filler', 5)).toHaveLength(5);
    expect(rankSearch(idx(), '  ', 5)).toEqual([]);
  });
});
