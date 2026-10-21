import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import PromoteDialog from './PromoteDialog.svelte';
import { config } from '$lib/stores/config';
import type { LayoutDashboard, LayoutNode } from '$lib/types/layout';

const folder = (id: string, name: string, children: LayoutNode[] = []): LayoutNode =>
  ({ kind: 'folder', id, name, display: 'expanded', placement: { x: 0, y: 0, w: 8, h: 6 }, content: { columns: 8, children } }) as LayoutNode;

// Home: tab Main > folder Media > folder Deep (depth 2). Showcase: a free tab.
const home: LayoutDashboard = {
  id: 'd1', name: 'Home', path: '/home', revision: 3, order: 0,
  tabs: [{ id: 't1', name: 'Main', root: { columns: 24, children: [folder('f1', 'Media', [folder('f2', 'Deep')])] } }]
};
const showcase: LayoutDashboard = {
  id: 's1', name: 'Showcase', path: '/showcase', revision: 2, order: 1,
  tabs: [{ id: 'st', name: 'Free', layout: 'free', designWidth: 1280, root: { columns: 160, children: [] } }]
};
const categories = [
  { slug: 'media', label: 'Media', icon: 'mdi:play', count: 2 },
  { slug: 'network', label: 'Network', icon: 'mdi:lan', count: 1 }
];

const onSubmit = vi.fn();
const onCancel = vi.fn();
const item = (name: RegExp) => screen.getByRole('treeitem', { name });
const expand = (name: RegExp) => fireEvent.keyDown(item(name), { key: 'ArrowRight' });
const promote = () => screen.getByRole('button', { name: /^Promote/ });

beforeEach(() => {
  onSubmit.mockReset();
  onCancel.mockReset();
  config.set({ schemaVersion: 3, dashboards: [home, showcase] });
});
afterEach(() => config.set(null));

describe('PromoteDialog: targets from the v3 tree', () => {
  it('an existing folder two levels deep is a target; every tile goes there', async () => {
    render(PromoteDialog, { count: 3, categories, busy: false, onSubmit, onCancel });
    expect(promote()).toBeDisabled();
    await expand(/^Home/);
    await expand(/^Main/);
    await expand(/^Media/);
    await fireEvent.click(item(/^Deep/));
    expect(screen.getByText(/All 3 tiles go into the folder/)).toHaveTextContent('Deep');
    await fireEvent.click(promote());
    expect(onSubmit).toHaveBeenCalledWith({ dashboardId: 'd1', tabId: 't1', folderId: 'f2' });
  });

  it('a tab gets one folder per category (on any dashboard, the Showcase included)', async () => {
    render(PromoteDialog, { count: 3, categories, busy: false, onSubmit, onCancel });
    await expand(/^Showcase/);
    await fireEvent.click(item(/^Free/));
    expect(screen.getByText(/Each category becomes a folder/)).toBeInTheDocument();
    for (const c of ['Media', 'Network']) expect(screen.getAllByText(c).length).toBeGreaterThan(0);
    await fireEvent.click(promote());
    expect(onSubmit).toHaveBeenCalledWith({ dashboardId: 's1', tabId: 'st' });
  });

  it('dashboards themselves are not targets (pick a tab or folder)', async () => {
    render(PromoteDialog, { count: 1, categories, busy: false, onSubmit, onCancel });
    expect(item(/^Home/)).toHaveAttribute('aria-disabled', 'true');
  });

  it('a new tab on an existing dashboard', async () => {
    render(PromoteDialog, { count: 1, categories, busy: false, onSubmit, onCancel });
    await fireEvent.click(screen.getByLabelText('A new tab on an existing dashboard'));
    await fireEvent.change(screen.getByLabelText('Dashboard'), { target: { value: 's1' } });
    expect(promote()).toBeDisabled();
    await fireEvent.input(screen.getByLabelText('New tab name'), { target: { value: 'Found' } });
    await fireEvent.click(promote());
    expect(onSubmit).toHaveBeenCalledWith({ dashboardId: 's1', newTab: { name: 'Found' } });
  });

  it('a new dashboard needs a name and a tab name', async () => {
    render(PromoteDialog, { count: 1, categories, busy: false, onSubmit, onCancel });
    await fireEvent.click(screen.getByLabelText('A new dashboard'));
    await fireEvent.input(screen.getByLabelText('New dashboard name'), { target: { value: 'Lab' } });
    expect(promote()).toBeDisabled();
    await fireEvent.input(screen.getByLabelText('New tab name'), { target: { value: 'Services' } });
    await fireEvent.click(promote());
    expect(onSubmit).toHaveBeenCalledWith({ newDashboard: { name: 'Lab' }, newTab: { name: 'Services' } });
  });

  it('a chosen folder that disappears (refresh) is dropped and said so', async () => {
    render(PromoteDialog, { count: 1, categories, busy: false, onSubmit, onCancel });
    await expand(/^Home/);
    await expand(/^Main/);
    await fireEvent.click(item(/^Media/));
    config.set({ schemaVersion: 3, dashboards: [{ ...home, tabs: [{ ...home.tabs[0], root: { columns: 24, children: [] } }] }, showcase] });
    await vi.waitFor(() => expect(screen.getByText('That destination no longer exists. Choose another.')).toBeInTheDocument());
    expect(promote()).toBeDisabled();
  });

  it('Cancel sends nothing', async () => {
    render(PromoteDialog, { count: 1, categories, busy: false, onSubmit, onCancel });
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
