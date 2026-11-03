import { describe, it, expect } from 'vitest';
import known from '../../../../backend/internal/configdoc/testdata/known_fields.json';
import type { Background, DashboardSettings, HeaderConfig, StatusCheck } from './index';
import type { Container, FolderNode, LayoutDashboard, LayoutTab, Placement, TileNode } from './layout';
import type { TabFields } from '$lib/editor/editorActions';
import type { FolderFields } from '$lib/components/editor/FolderEditModal.svelte';
import { blankFolder, blankTile } from '$lib/editor/editorActions';
import { addTab } from '$lib/editor/treeOps';

// The server names every field of an imported dashboard it does not know
// (configdoc/knownfields.go; known_fields.json is the same lists). So every
// field the editor can write must be in them. Each object below has EVERY
// field of its type (Required<…>): a field added to a type and not here fails
// svelte-check, and one here the server lacks fails this test.

const placement: Required<Placement> = { x: 0, y: 0, w: 2, h: 2, z: 1 };
const background: Required<Background> = {
  type: 'slideshow', inherit: false, opacity: 1, value: '', images: [], interval: 30, fit: 'cover',
  transition: 'crossfade', transitionDuration: 1, overlayOpacity: 0.7, overlayBlur: 10
};
const statusCheck: Required<StatusCheck> = { type: 'http', enabled: true, interval: 60 };
const container: Required<Container> = { columns: 24, children: [] };
const header: Required<HeaderConfig> = { leftText: '', centerTitle: '', showLeft: true, showCenter: true };
const settings: Required<DashboardSettings> = {
  statusChecksEnabled: null, statusCheckIntervalMinutes: null, statusCheckTimeoutSeconds: null,
  editIdleTimeoutMinutes: null, animatedFolderBackgrounds: null
};
const tile: Required<TileNode> = {
  kind: 'tile', id: 't', type: 'link', name: 'n', url: 'https://example.com', awayUrl: 'https://example.net',
  icon: '', iconUrl: '', description: '', openMode: 'newtab', statusCheck, size: 'medium', color: '', opacity: 1,
  textOpacity: 1, iconOpacity: 1, iconBgColor: '', textColor: 'auto', order: 0, showStatus: true, placement
};
const folder: Required<FolderNode> = {
  kind: 'folder', id: 'f', name: 'n', description: '', icon: '', iconUrl: '', iconBgColor: '', color: '', opacity: 1,
  textColor: 'auto', display: 'expanded', size: 'medium', contentSize: 'medium', shape: 'rounded', tabPosition: 'left',
  minimisedIcon: 'contents', showTitle: true, background, placement, content: container
};
const folderFields: Required<FolderFields> = {
  name: 'n', description: '', icon: '', iconUrl: '', iconBgColor: '', color: '', opacity: 1, textColor: 'auto',
  display: 'expanded', showTitle: true, shape: 'rounded', tabPosition: 'left', size: 'medium', contentSize: 'medium',
  minimisedIcon: 'own', background, statusChecksEnabled: false
};
const tab: Required<LayoutTab> = { id: 't', name: 'n', background, root: container };
const tabFields: Required<TabFields> = {
  name: 'n', icon: '', iconUrl: '', iconBgColor: '', color: '', opacity: 1, textColor: 'light', background,
  statusChecksEnabled: false
};
// display and partial are read-only, per-request keys: never stored (the server drops or refuses them).
const notStored = new Set(['display', 'partial']);
const dashboard: Required<LayoutDashboard> = {
  id: 'd', name: 'n', path: '/d', revision: 1, order: 0, background, display: {}, tabs: [tab], partial: true
};

function unknownTo(level: keyof typeof known, o: object): string[] {
  const list = known[level] as string[];
  return Object.keys(o).filter((k) => !list.includes(k) && !notStored.has(k));
}

describe('every field the editor writes is one the server knows (known_fields.json)', () => {
  it.each([
    ['placement', placement], ['background', background], ['statusCheck', statusCheck], ['container', container],
    ['header', header], ['settings', settings], ['tile', tile], ['folder', folder], ['folder', folderFields],
    ['tab', tab], ['tab', tabFields], ['dashboard', dashboard],
    ['tile', blankTile()], ['folder', blankFolder()], ['container', blankFolder().content]
  ] as [keyof typeof known, object][])('%s', (level, o) => {
    expect(unknownTo(level, o)).toEqual([]);
  });

  it('a new tab, and a dashboard header and settings, as the editor makes them', () => {
    const d = addTab({ id: 'd', name: 'n', path: '/d', revision: 1, tabs: [] }, 'Tab').dashboard;
    expect(unknownTo('tab', d.tabs[0])).toEqual([]);
    expect(unknownTo('container', d.tabs[0].root)).toEqual([]);
    expect(unknownTo('dashboard', d)).toEqual([]);
  });
});
