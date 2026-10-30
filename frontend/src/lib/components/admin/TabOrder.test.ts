import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

vi.mock('$lib/utils/api', async () => ({
  ...(await vi.importActual<object>('$lib/utils/api')),
  saveDashboardV3: vi.fn()
}));
vi.mock('$lib/stores/config', async () => ({
  ...(await vi.importActual<object>('$lib/stores/config')),
  loadConfig: vi.fn()
}));

import * as api from '$lib/utils/api';
import { loadConfig } from '$lib/stores/config';
import { toast } from '$lib/stores/toast';
import { setLayout, resetEditor, startSession } from '$lib/components/editor/editorTestKit';
import TabOrder from './TabOrder.svelte';
import type { LayoutDashboard } from '$lib/types/layout';

const save = api.saveDashboardV3 as unknown as ReturnType<typeof vi.fn>;
const load = loadConfig as unknown as ReturnType<typeof vi.fn>;

const tab = (id: string) => ({ id, name: id, root: { columns: 24, children: [] } });
const dash = (ids: string[], revision = 4): LayoutDashboard => ({ id: 'd1', name: 'Home', path: '/home', revision, tabs: ids.map(tab) });
const SIX = ['t1', 't2', 't3', 't4', 't5', 't6'];

const rows = () => [...document.querySelectorAll('[data-tab-row]')].map((r) => r.getAttribute('data-tab-row'));
const nums = () => [...document.querySelectorAll('[data-tab-row] .num')].map((n) => n.textContent);
const tickRow = (name: string) => fireEvent.click(screen.getByRole('checkbox', { name }));
const btn = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;

beforeEach(() => {
  resetEditor();
  save.mockReset();
  load.mockReset();
  setLayout([dash(SIX)]);
});

describe('Tab order page', () => {
  it('shows every tab numbered in the stored order', () => {
    render(TabOrder, { dashboardId: 'd1' });
    expect(screen.getByRole('heading', { name: /Tab order: Home/ }).textContent).toContain('(6 tabs)');
    expect(rows()).toEqual(SIX);
    expect(nums()).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(screen.getByText('No changes')).toBeTruthy();
    expect(btn('Save order').disabled).toBe(true);
  });

  it('↓ moves one place and marks unsaved', async () => {
    render(TabOrder, { dashboardId: 'd1' });
    await fireEvent.click(btn('Move t1 down'));
    expect(rows()).toEqual(['t2', 't1', 't3', 't4', 't5', 't6']);
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
    expect(btn('Save order').disabled).toBe(false);
  });

  it('to the top and to the bottom buttons work, and the ends are disabled', async () => {
    render(TabOrder, { dashboardId: 'd1' });
    expect(btn('Move t1 up').disabled).toBe(true);
    expect(btn('Move t6 to the bottom').disabled).toBe(true);
    await fireEvent.click(btn('Move t5 to the top'));
    await fireEvent.click(btn('Move t1 to the bottom'));
    expect(rows()).toEqual(['t5', 't2', 't3', 't4', 't6', 't1']);
  });

  it('tick two and Move ticked to top moves them as a block', async () => {
    render(TabOrder, { dashboardId: 'd1' });
    expect(screen.getByText('0 ticked')).toBeTruthy();
    await tickRow('t3');
    await tickRow('t5');
    expect(screen.getByText('2 ticked')).toBeTruthy();
    await fireEvent.click(btn('Move ticked to top'));
    expect(rows()).toEqual(['t3', 't5', 't1', 't2', 't4', 't6']);
    await fireEvent.click(btn('Move ticked to bottom'));
    expect(rows()).toEqual(['t1', 't2', 't4', 't6', 't3', 't5']);
  });

  it('Move ticked to position 4', async () => {
    render(TabOrder, { dashboardId: 'd1' });
    await tickRow('t1');
    await tickRow('t2');
    await fireEvent.input(screen.getByRole('spinbutton'), { target: { value: '4' } });
    await fireEvent.click(btn('Move'));
    expect(rows()).toEqual(['t3', 't4', 't5', 't1', 't2', 't6']);
  });

  it('Sort A→Z is one Undo step', async () => {
    setLayout([dash(['b', 'c', 'a'])]);
    render(TabOrder, { dashboardId: 'd1' });
    await fireEvent.click(btn('Sort A→Z'));
    expect(rows()).toEqual(['a', 'b', 'c']);
    await fireEvent.click(btn('Undo'));
    expect(rows()).toEqual(['b', 'c', 'a']);
    expect(screen.getByText('No changes')).toBeTruthy();
    expect(btn('Undo').disabled).toBe(true);
  });

  it('Discard changes returns to the saved order', async () => {
    render(TabOrder, { dashboardId: 'd1' });
    await fireEvent.click(btn('Move t1 to the bottom'));
    await fireEvent.click(btn('Move t2 to the bottom'));
    await fireEvent.click(btn('Discard changes'));
    expect(rows()).toEqual(SIX);
  });

  it('the find box narrows the list but numbers stay the real positions', async () => {
    render(TabOrder, { dashboardId: 'd1' });
    await fireEvent.input(screen.getByPlaceholderText('Find a tab…'), { target: { value: 't5' } });
    expect(rows()).toEqual(['t5']);
    expect(nums()).toEqual(['5']);
  });

  it('dropping a row on another moves it there (a ticked row takes the ticked rows with it)', async () => {
    render(TabOrder, { dashboardId: 'd1' });
    const row = (id: string) => document.querySelector(`[data-tab-row="${id}"]`)!;
    await fireEvent.dragStart(row('t3'));
    await fireEvent.dragOver(row('t1'));
    await fireEvent.drop(row('t1'));
    expect(rows()).toEqual(['t3', 't1', 't2', 't4', 't5', 't6']);
    await tickRow('t5');
    await tickRow('t6');
    await fireEvent.dragStart(row('t5'));
    await fireEvent.dragOver(row('t1'));
    await fireEvent.drop(row('t1'));
    expect(rows()).toEqual(['t3', 't5', 't6', 't1', 't2', 't4']);
  });

  it('Save sends one reorderTabs save with the base revision', async () => {
    save.mockResolvedValue({ revision: 5, layout: { layoutVersion: 2, dashboards: [dash(['t2', 't1', 't3', 't4', 't5', 't6'], 5)] } });
    const ok = vi.spyOn(toast, 'success');
    render(TabOrder, { dashboardId: 'd1' });
    await fireEvent.click(btn('Move t1 down'));
    await fireEvent.click(btn('Save order'));
    await waitFor(() => expect(ok).toHaveBeenCalledWith('Tab order saved'));
    expect(save).toHaveBeenCalledTimes(1);
    const [id, d, rev] = save.mock.calls[0];
    expect(id).toBe('d1');
    expect(rev).toBe(4);
    expect(d.tabs.map((t: { id: string }) => t.id)).toEqual(['t2', 't1', 't3', 't4', 't5', 't6']);
    expect(screen.getByText('No changes')).toBeTruthy();
  });

  it('refuses while that dashboard is being edited, and sends nothing', async () => {
    startSession('d1');
    render(TabOrder, { dashboardId: 'd1' });
    await fireEvent.click(btn('Move t1 down'));
    await fireEvent.click(btn('Save order'));
    expect(screen.getByRole('alert').textContent).toBe(
      'Not saved: "Home" is being edited (an edit session or unsaved draft is open). Save or discard that first, then save the tab order.'
    );
    expect(save).not.toHaveBeenCalled();
    expect(rows()[0]).toBe('t2');
  });

  it("a 409 keeps the user's order, applies it to the latest version, and names what changed", async () => {
    save.mockRejectedValue(new api.ConflictError('d1', 9));
    load.mockImplementation(async () => {
      setLayout([dash(['t1', 't2', 't4', 't5', 't6', 't7'], 9)]);
    });
    render(TabOrder, { dashboardId: 'd1' });
    await fireEvent.click(btn('Move t6 to the top'));
    await fireEvent.click(btn('Save order'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('changed somewhere else'));
    expect(rows()).toEqual(['t6', 't1', 't2', 't4', 't5', 't7']);
    const msg = screen.getByRole('alert').textContent!;
    expect(msg).toContain('new tabs added at the end: t7');
    expect(msg).toContain('tabs no longer there: t3');
    expect(msg.endsWith('Check it and Save again.')).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
    expect(btn('Save order').disabled).toBe(false);
    // Discard returns to the FRESH saved order.
    await fireEvent.click(btn('Discard changes'));
    expect(rows()).toEqual(['t1', 't2', 't4', 't5', 't6', 't7']);
  });

  it('a 409 whose latest version cannot be read says so and keeps the order', async () => {
    save.mockRejectedValue(new api.ConflictError('d1', 9));
    load.mockResolvedValue(undefined);
    render(TabOrder, { dashboardId: 'd1' });
    await fireEvent.click(btn('Move t6 to the top'));
    await fireEvent.click(btn('Save order'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('could not be read'));
    expect(rows()[0]).toBe('t6');
  });

  it('any other save failure is shown with its reason and keeps the order', async () => {
    save.mockRejectedValue(new Error('disk full'));
    render(TabOrder, { dashboardId: 'd1' });
    await fireEvent.click(btn('Move t6 to the top'));
    await fireEvent.click(btn('Save order'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Not saved: disk full'));
    expect(rows()[0]).toBe('t6');
    expect(btn('Save order').disabled).toBe(false);
  });

  it('a downward drag shows the line under the row it will land after, an upward one above', async () => {
    render(TabOrder, { dashboardId: 'd1' });
    const row = (id: string) => document.querySelector(`[data-tab-row="${id}"]`)!;
    await fireEvent.dragStart(row('t2'));
    await fireEvent.dragOver(row('t5'));
    expect(row('t5').classList.contains('over-after')).toBe(true);
    expect(row('t5').classList.contains('over')).toBe(false);
    await fireEvent.dragOver(row('t1'));
    expect(row('t1').classList.contains('over')).toBe(true);
    expect(row('t1').classList.contains('over-after')).toBe(false);
  });

  it('dropping downward lands after the target', async () => {
    render(TabOrder, { dashboardId: 'd1' });
    const row = (id: string) => document.querySelector(`[data-tab-row="${id}"]`)!;
    await fireEvent.dragStart(row('t2'));
    await fireEvent.dragOver(row('t5'));
    await fireEvent.drop(row('t5'));
    expect(rows()).toEqual(['t1', 't3', 't4', 't5', 't2', 't6']);
  });

  it('Move to position is off with an empty or fractional box, and says why', async () => {
    render(TabOrder, { dashboardId: 'd1' });
    await tickRow('t1');
    const box = screen.getByRole('spinbutton');
    await fireEvent.input(box, { target: { value: '' } });
    expect(btn('Move').disabled).toBe(true);
    expect(screen.getByText('Type a whole number from 1 to 6.')).toBeTruthy();
    await fireEvent.input(box, { target: { value: '2.5' } });
    expect(btn('Move').disabled).toBe(true);
    expect(rows()).toEqual(SIX);
  });

  it('an out-of-range position is clamped and the box shows where the block went', async () => {
    render(TabOrder, { dashboardId: 'd1' });
    await tickRow('t1');
    await tickRow('t2');
    const box = screen.getByRole('spinbutton') as HTMLInputElement;
    await fireEvent.input(box, { target: { value: '99' } });
    await fireEvent.click(btn('Move'));
    expect(rows()).toEqual(['t3', 't4', 't5', 't6', 't1', 't2']);
    expect(box.value).toBe('5');
  });

  it('config changed elsewhere while open: Save sends nothing, merges onto the latest, second Save uses the new revision', async () => {
    render(TabOrder, { dashboardId: 'd1' });
    await fireEvent.click(btn('Move t6 to the top'));
    setLayout([dash(['t1', 't2', 't4', 't5', 't6', 't7'], 9)]);
    await fireEvent.click(btn('Save order'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('changed somewhere else'));
    expect(save).not.toHaveBeenCalled();
    expect(rows()).toEqual(['t6', 't1', 't2', 't4', 't5', 't7']);
    const msg = screen.getByRole('alert').textContent!;
    expect(msg).toContain('new tabs added at the end: t7');
    expect(msg).toContain('tabs no longer there: t3');
    save.mockResolvedValue({ revision: 10, layout: { layoutVersion: 2, dashboards: [dash(['t6', 't1', 't2', 't4', 't5', 't7'], 10)] } });
    await fireEvent.click(btn('Save order'));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const [, d, rev] = save.mock.calls[0];
    expect(rev).toBe(9);
    expect(d.tabs.map((t: { id: string }) => t.id)).toEqual(['t6', 't1', 't2', 't4', 't5', 't7']);
  });

  it('says so for an unknown id', () => {
    render(TabOrder, { dashboardId: 'nope' });
    expect(screen.getByText('There is no dashboard with that id. It may have been deleted.')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Settings › Dashboards/ }).getAttribute('href')).toBe('/settings/dashboards');
  });

  it('says so for a one-tab dashboard', () => {
    setLayout([dash(['t1'])]);
    render(TabOrder, { dashboardId: 'd1' });
    expect(screen.getByText('This dashboard has only one tab, so there is nothing to reorder.')).toBeTruthy();
  });
});
