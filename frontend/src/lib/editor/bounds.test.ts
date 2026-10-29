import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { get } from 'svelte/store';

vi.mock('$lib/utils/api', async () => ({
  ...(await vi.importActual<object>('$lib/utils/api')),
  saveDashboardV3: vi.fn(),
  getConfig: vi.fn(async () => { throw new Error('offline in tests'); })
}));

import type { LayoutDashboard, LayoutNode } from '$lib/types/layout';
import { toast } from '$lib/stores/toast';
import { apply } from '$lib/stores/editSession';
import { setLayout, resetEditor, startSession, draft, home, folder, tile, p } from '$lib/components/editor/editorTestKit';
import { resolveDrop, type DragState } from './drag/dragController';
import type { HitResult } from './drag/hitTest';
import { boundsProblem, childLevel, itemHeight, landingProblem, measureBounds, MAX_NESTING_DEPTH } from './bounds';
import { documentIds, insertNew } from './editorActions';
import { mergeIntoNewFolder } from './treeOps';

/** A chain of `levels` folders d1 › d2 › …, the innermost holding tile `deep-tile`. */
function chain(levels: number): LayoutNode {
  let n: LayoutNode = tile('deep-tile');
  for (let i = levels; i >= 1; i--) n = folder(`d${i}`, i === 1 ? p(0, 4, 8, 8) : undefined, [n]);
  return n;
}

function withChain(levels: number): LayoutDashboard {
  const d = home();
  d.tabs[0].root.children.push(chain(levels));
  return d;
}

describe('bounds (the save limits, measured)', () => {
  it('counts tabs, items and the deepest level', () => {
    const b = measureBounds(withChain(3)); // d1 › d2 › d3 › deep-tile: deep-tile is level 4
    expect(b.depth).toBe(4);
    expect(b.tabs).toBe(home().tabs.length);
    expect(b.nodes).toBe(measureBounds(home()).nodes + 4);
  });

  it('itemHeight and childLevel', () => {
    const d = withChain(3);
    expect(itemHeight(tile('x'))).toBe(1);
    expect(itemHeight(chain(3))).toBe(4);
    expect(childLevel(d)).toBe(1);
    expect(childLevel(d, 'd1')).toBe(2);
    expect(childLevel(d, 'd3')).toBe(4);
  });

  it('landingProblem names the depth a drop would reach', () => {
    expect(landingProblem([tile('x')], MAX_NESTING_DEPTH)).toBeNull();
    expect(landingProblem([tile('x')], MAX_NESTING_DEPTH + 1)).toMatch(/13 levels down.*allows 12/);
    expect(landingProblem([chain(2)], MAX_NESTING_DEPTH)).toMatch(/14 levels down/); // d1, d2 and the tile: 3 levels
  });

  it('boundsProblem refuses a change that goes over, but not one that only shrinks an over-limit dashboard', () => {
    const ok = withChain(MAX_NESTING_DEPTH - 1); // the tile is at level 12
    const over = withChain(MAX_NESTING_DEPTH); // the tile is at level 13
    expect(boundsProblem(ok, ok)).toBeNull();
    expect(boundsProblem(ok, over)).toMatch(/Too deep/);
    expect(boundsProblem(over, withChain(MAX_NESTING_DEPTH))).toBeNull(); // no worse than before
    expect(boundsProblem(over, ok)).toBeNull();
  });
});

describe('the editor refuses a change a save would refuse, when it is made', () => {
  beforeEach(() => {
    resetEditor();
    setLayout([withChain(MAX_NESTING_DEPTH - 1)]); // d1 … d11, deep-tile at level 12
    startSession();
  });
  afterEach(() => resetEditor());

  it('adding a folder at the deepest level is refused with a toast; the draft is unchanged', () => {
    const before = draft();
    const ok = apply('Add folder', (dd) => insertNew(dd, folder('new-f', undefined, [tile('new-t')]), { tabId: 't1', folderId: 'd11' }));
    expect(ok).toBe(false);
    expect(draft()).toBe(before);
    expect(get(toast).at(-1)).toMatchObject({ type: 'error', message: expect.stringMatching(/Too deep: .*13 levels down/) });
  });

  it('a tile can still go at level 12', () => {
    const ok = apply('Add tile', (dd) => insertNew(dd, tile('ok-t'), { tabId: 't1', folderId: 'd11' }));
    expect(ok).toBe(true);
  });

  it('dragging a folder into the deepest folder shows "too deep" while hovering', () => {
    const state: DragState = { ids: ['f1'], copy: false, pointer: { x: 0, y: 0 }, target: null, grab: { fx: 0, fy: 0 } };
    const hit: HitResult = { folderBar: { folderId: 'd11' }, dx: 0, dy: 0 } as unknown as HitResult;
    const t = resolveDrop(state, hit, draft());
    expect(t.kind).toBe('invalid');
    expect(t.kind === 'invalid' && t.reason).toMatch(/Too deep/);
  });

  it('making a folder from a tile and the deepest tile is refused (both would go to level 13)', () => {
    const before = draft();
    const ok = apply('Make folder', (dd) => mergeIntoNewFolder(dd, ['a'], 'deep-tile', documentIds()).dashboard);
    expect(ok).toBe(false);
    expect(draft()).toBe(before);
    expect(get(toast).at(-1)?.message).toMatch(/Too deep/);
  });
});
