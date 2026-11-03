import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/svelte';
import TabEditModal from '../admin/TabEditModal.svelte';
import { editMode } from '$lib/stores/editMode';

beforeEach(() => editMode.set(true));
afterEach(() => editMode.set(false));

describe('TabEditModal has no layout (every tab is a grid)', () => {
  it('offers no Layout or Design width, and Save passes no layout', async () => {
    const onSave = vi.fn();
    render(TabEditModal, { tabName: 'Media', onSave, onCancel: vi.fn() });
    expect(screen.queryByLabelText('Layout')).toBeNull();
    expect(screen.queryByLabelText(/Design width/)).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: /^Save/ }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0]).toBe('Media');
    expect(onSave.mock.calls[0]).toHaveLength(9); // name, icon, iconUrl, iconBgColor, color, opacity, background, status checks, text colour
    expect(onSave.mock.calls[0][8]).toBeUndefined(); // Auto: the key is removed
  });
});

describe('TabEditModal background', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ categories: [], images: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    ));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('always offers the background picker (no per-tab switch any more)', () => {
    render(TabEditModal, { tabName: 'Media', onSave: vi.fn(), onCancel: vi.fn() });
    expect(screen.getByRole('button', { name: /Configure tab background/ })).toBeInTheDocument();
    expect(screen.queryByText(/Individual backgrounds per tab/)).toBeNull();
  });
  it('says when a kept picture is switched off (inherit form)', () => {
    render(TabEditModal, {
      tabName: 'Media', tabBackground: { inherit: true, type: 'image', value: '/backgrounds/a.jpg' },
      onSave: vi.fn(), onCancel: vi.fn()
    });
    expect(screen.getByText(/dashboard background/i, { selector: '.background-status' }).textContent).toMatch(/kept/i);
  });
  it('a picked background is staged and passed with the dialog Save; Cancel passes nothing', async () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    render(TabEditModal, { tabName: 'Media', onSave, onCancel });
    await fireEvent.click(screen.getByRole('button', { name: /Configure tab background/ }));
    await fireEvent.click(screen.getByRole('button', { name: /^Colour$/ }));
    await fireEvent.click(within(screen.getByRole('dialog', { name: /background$/i })).getByRole('button', { name: 'Save' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText(/applies when you save/i, { selector: '.background-status' })).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    expect(onSave.mock.calls[0][6]).toMatchObject({ type: 'color' });
  });
  it('without a pick, Save passes no background change; None passes null', async () => {
    const onSave = vi.fn();
    const { unmount } = render(TabEditModal, { tabName: 'Media', tabBackground: { type: 'color', value: '#000000' }, onSave, onCancel: vi.fn() });
    await fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    expect(onSave.mock.calls[0][6]).toBeUndefined();
    unmount();
    const onSave2 = vi.fn();
    render(TabEditModal, { tabName: 'Media', tabBackground: { type: 'color', value: '#000000' }, onSave: onSave2, onCancel: vi.fn() });
    await fireEvent.click(screen.getByRole('button', { name: /Configure tab background/ }));
    await fireEvent.click(screen.getByRole('button', { name: /^None$/ }));
    await fireEvent.click(within(screen.getByRole('dialog', { name: /background$/i })).getByRole('button', { name: 'Save' }));
    await fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    expect(onSave2.mock.calls[0][6]).toBeNull();
  });
});

// Fix round 1: a tab has the same Text colour control as tiles and folders (the one rule).
describe('TabEditModal text colour', () => {
  it('a stored Light shows checked and is saved; Auto saves as undefined', async () => {
    const onSave = vi.fn();
    render(TabEditModal, { tabName: 'Media', tabColor: '#0f172a', tabTextColor: 'light', onSave, onCancel: vi.fn() });
    expect(screen.getByRole('radio', { name: 'Light' })).toBeChecked();
    await fireEvent.click(screen.getByRole('button', { name: /^Save/ }));
    expect(onSave.mock.calls[0][8]).toBe('light');
  });
  it('an explicit choice that is hard to read is warned about, as on tiles and folders', async () => {
    render(TabEditModal, { tabName: 'Media', tabColor: '#f59e0b', onSave: vi.fn(), onCancel: vi.fn() });
    expect(screen.queryByText(/hard to read/i)).toBeNull();
    await fireEvent.click(screen.getByRole('radio', { name: 'Light' }));
    expect(screen.getByText(/hard to read/i).closest('[data-contrast-warning]')).toBeTruthy();
  });
  it('no colour: says the choice applies when the tab has a colour', () => {
    render(TabEditModal, { tabName: 'Media', onSave: vi.fn(), onCancel: vi.fn() });
    expect(screen.getByText('Text colour applies when the tab has a colour.')).toBeTruthy();
  });
});

describe('TabEditModal unreadable colour (fix round 2)', () => {
  it('a stored colour that cannot be read is named in the dialog; a picked colour clears it', async () => {
    render(TabEditModal, { tabName: 'Media', tabColor: 'bluish', onSave: vi.fn(), onCancel: vi.fn() });
    expect(screen.getByText(/Its colour \(bluish\) can't be read/)).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Blue' }));
    expect(screen.queryByText(/can't be read/)).toBeNull();
  });
});
