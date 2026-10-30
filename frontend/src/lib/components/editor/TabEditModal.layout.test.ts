import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
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
    expect(onSave.mock.calls[0]).toHaveLength(8); // name, icon, iconUrl, iconBgColor, color, opacity, background, status checks
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
    expect(screen.getByRole('button', { name: /Configure Tab Background/ })).toBeInTheDocument();
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
    await fireEvent.click(screen.getByRole('button', { name: /Configure Tab Background/ }));
    await fireEvent.click(screen.getByRole('button', { name: /^Color$/ }));
    await fireEvent.click(screen.getByRole('button', { name: /^Save Background/ }));
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
    await fireEvent.click(screen.getByRole('button', { name: /Configure Tab Background/ }));
    await fireEvent.click(screen.getByRole('button', { name: /^None$/ }));
    await fireEvent.click(screen.getByRole('button', { name: /^Save Background/ }));
    await fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    expect(onSave2.mock.calls[0][6]).toBeNull();
  });
});
