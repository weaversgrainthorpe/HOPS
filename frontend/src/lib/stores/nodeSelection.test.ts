import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { config } from './config';
import { begin, resetEditSessionForTests } from './editSession';
import { selectedNodes, toggleNode, clearSelection, selectionInDraft } from './nodeSelection';
import type { Config } from '$lib/types';
import type { LayoutDashboard, LayoutNode } from '$lib/types/layout';

const tile = (id: string, x: number): LayoutNode =>
  ({ kind: 'tile', id, name: id, url: 'http://x', placement: { x, y: 0, w: 1, h: 1 } }) as unknown as LayoutNode;
const d = (id: string): LayoutDashboard => ({
  id, name: id, path: '/' + id, revision: 1,
  tabs: [{ id: id + '-t', name: 'T', root: { columns: 12, children: [tile(id + 'a', 0), tile(id + 'b', 1)] } }]
});

beforeEach(() => {
  resetEditSessionForTests();
  clearSelection();
  config.set({ dashboards: [], layout: { schemaVersion: 3, dashboards: [d('p'), d('q')] } } as unknown as Config);
});

describe('nodeSelection', () => {
  it('a plain click selects one; Ctrl/Cmd-click adds and removes', () => {
    toggleNode('a', false);
    expect([...get(selectedNodes)]).toEqual(['a']);
    toggleNode('b', false);
    expect([...get(selectedNodes)]).toEqual(['b']);
    toggleNode('c', true);
    toggleNode('d', true);
    expect([...get(selectedNodes)].sort()).toEqual(['b', 'c', 'd']);
    toggleNode('c', true);
    expect([...get(selectedNodes)].sort()).toEqual(['b', 'd']);
  });

  it('a plain click on the only selected item keeps it selected', () => {
    toggleNode('a', false);
    toggleNode('a', false);
    expect([...get(selectedNodes)]).toEqual(['a']);
  });

  it('clearSelection empties it', () => {
    toggleNode('a', false);
    toggleNode('b', true);
    clearSelection();
    expect(get(selectedNodes).size).toBe(0);
  });

  it('is cleared when the session ends or moves to another dashboard', () => {
    begin('p');
    toggleNode('pa', false);
    resetEditSessionForTests();
    expect(get(selectedNodes).size).toBe(0);
    begin('p');
    toggleNode('pa', false);
    resetEditSessionForTests();
    begin('q');
    expect(get(selectedNodes).size).toBe(0);
  });

  it('selectionInDraft drops ids no longer in the draft', () => {
    begin('p');
    toggleNode('pa', false);
    toggleNode('gone', true);
    expect(selectionInDraft()).toEqual(['pa']);
  });
});
