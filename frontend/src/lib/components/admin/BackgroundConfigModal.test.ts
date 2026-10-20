import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import BackgroundConfigModal from './BackgroundConfigModal.svelte';
import type { Background } from '$lib/types';

// M4 Task 5: one picker at every level (design §4a calls 1, 2, 5).
const getBackgrounds = vi.fn();
vi.mock('$lib/utils/api', () => ({
  getBackgrounds: (...a: unknown[]) => getBackgrounds(...a),
  uploadBackground: vi.fn(),
  deleteBackground: vi.fn(),
  createBackgroundCategory: vi.fn()
}));

beforeEach(() => {
  getBackgrounds.mockReset();
  getBackgrounds.mockResolvedValue({ categories: [], images: [] });
});

type Level = 'dashboard' | 'tab' | 'folder';
function open(level: Level, background?: Background) {
  const onSave = vi.fn();
  const onCancel = vi.fn();
  render(BackgroundConfigModal, { level, background, onSave, onCancel });
  return { onSave, onCancel };
}
const save = () => fireEvent.click(screen.getByRole('button', { name: /^Save Background/ }));
const inheritSwitch = () => screen.getByRole('switch', { name: /Inherit/ });

describe('BackgroundConfigModal at every level', () => {
  it('has a title per level', () => {
    for (const [level, title] of [['dashboard', 'Dashboard background'], ['tab', 'Tab background'], ['folder', 'Folder background']] as const) {
      const { unmount } = render(BackgroundConfigModal, { level, onSave: vi.fn(), onCancel: vi.fn() });
      expect(screen.getByRole('heading', { level: 2 }).textContent).toMatch(new RegExp(title, 'i'));
      unmount();
    }
  });

  it('has no per-tab toggle any more', () => {
    open('dashboard', { type: 'image', value: '/presets/network-grid.jpg' });
    expect(screen.queryByText(/Individual backgrounds per tab/i)).toBeNull();
  });

  it('folder level hides the overlay darkness and blur; tab level shows them', () => {
    const bg: Background = { type: 'image', value: '/presets/network-grid.jpg' };
    const { unmount } = render(BackgroundConfigModal, { level: 'folder', background: bg, onSave: vi.fn(), onCancel: vi.fn() });
    expect(screen.queryByText(/Overlay Darkness/i)).toBeNull();
    expect(screen.queryByText(/Overlay Blur/i)).toBeNull();
    unmount();
    open('tab', bg);
    expect(screen.getByText(/Overlay Darkness/i)).toBeInTheDocument();
    expect(screen.getByText(/Overlay Blur/i)).toBeInTheDocument();
  });

  it('folder level never writes overlay fields', async () => {
    const { onSave } = open('folder', { type: 'image', value: '/presets/network-grid.jpg', overlayOpacity: 0.3 });
    await save();
    const out = onSave.mock.calls[0][0] as Background;
    expect(out).not.toHaveProperty('overlayOpacity');
    expect(out).not.toHaveProperty('overlayBlur');
  });

  it('Inherit keeps the stored picture and sets inherit: true', async () => {
    const images = ['/presets/network-grid.jpg', '/presets/data-center.jpg'];
    const { onSave } = open('tab', { type: 'slideshow', images, interval: 40 });
    const sw = inheritSwitch();
    expect((sw as HTMLInputElement).checked).toBe(false);
    await fireEvent.click(sw);
    expect(screen.getByText(/picture below is kept/i)).toBeInTheDocument();
    await save();
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ inherit: true, type: 'slideshow', images, interval: 40 }));
  });

  it('Inherit keeps a single image value', async () => {
    const { onSave } = open('folder', { type: 'image', value: '/backgrounds/a.jpg' });
    await fireEvent.click(inheritSwitch());
    await save();
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ inherit: true, type: 'image', value: '/backgrounds/a.jpg' }));
  });

  it('turning Inherit off restores the kept picture', async () => {
    const { onSave } = open('dashboard', { inherit: true, type: 'image', value: '/backgrounds/a.jpg', opacity: 0.4 });
    const sw = inheritSwitch();
    expect((sw as HTMLInputElement).checked).toBe(true);
    await fireEvent.click(sw);
    await save();
    const out = onSave.mock.calls[0][0] as Background;
    expect(out).toMatchObject({ type: 'image', value: '/backgrounds/a.jpg', opacity: 0.4 });
    expect(out.inherit).toBeFalsy();
  });

  it('a bare inherit form opens with Inherit on and saves as inherit', async () => {
    const { onSave } = open('tab', { inherit: true });
    expect((inheritSwitch() as HTMLInputElement).checked).toBe(true);
    await save();
    expect(onSave).toHaveBeenCalledWith({ inherit: true });
  });

  it('one opacity slider writes background.opacity (0–1)', async () => {
    const { onSave } = open('folder', { type: 'image', value: '/presets/network-grid.jpg' });
    const slider = screen.getByLabelText(/^Background opacity/) as HTMLInputElement;
    expect(slider.type).toBe('range');
    expect(slider.min).toBe('0');
    expect(slider.max).toBe('1');
    expect(slider.value).toBe('1');
    await fireEvent.input(slider, { target: { value: '0.5' } });
    await save();
    expect((onSave.mock.calls[0][0] as Background).opacity).toBe(0.5);
  });

  it('a stored out-of-range opacity is clamped', async () => {
    const { onSave } = open('tab', { type: 'color', value: '#112233', opacity: 7 });
    await save();
    expect((onSave.mock.calls[0][0] as Background).opacity).toBe(1);
  });

  it('a colour background gets the opacity slider too', () => {
    open('folder', { type: 'color', value: '#112233' });
    expect(screen.getByLabelText(/^Background opacity/)).toBeInTheDocument();
  });

  it('an invalid custom URL shows an inline error and is not added', async () => {
    const { onSave } = open('tab', { type: 'slideshow', images: ['/presets/network-grid.jpg'] });
    const input = screen.getByLabelText(/Add Custom Image URL/i);
    for (const bad of ['javascript:alert(1)', '/api/config', 'ftp://x.example/a.jpg', '/backgrounds/../api/x']) {
      await fireEvent.input(input, { target: { value: bad } });
      await fireEvent.click(screen.getByRole('button', { name: /^Add$/ }));
      const err = screen.getByRole('alert');
      expect(err.textContent).toMatch(/can't be used/i);
      expect(input.getAttribute('aria-invalid')).toBe('true');
    }
    await save();
    expect((onSave.mock.calls[0][0] as Background).images).toEqual(['/presets/network-grid.jpg']);
  });

  it('a valid custom URL is added (and clears the error)', async () => {
    const { onSave } = open('tab', { type: 'slideshow', images: [] });
    const input = screen.getByLabelText(/Add Custom Image URL/i);
    await fireEvent.input(input, { target: { value: 'javascript:alert(1)' } });
    await fireEvent.click(screen.getByRole('button', { name: /^Add$/ }));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    await fireEvent.input(input, { target: { value: 'https://img.example.com/photo (1).jpg' } });
    await fireEvent.click(screen.getByRole('button', { name: /^Add$/ }));
    expect(screen.queryByRole('alert')).toBeNull();
    await save();
    expect((onSave.mock.calls[0][0] as Background).images).toEqual(['https://img.example.com/photo (1).jpg']);
  });

  it('an invalid single image URL blocks Save with a visible error', async () => {
    const { onSave } = open('tab', { type: 'image', value: '/presets/network-grid.jpg' });
    await fireEvent.input(screen.getByLabelText(/^Image URL/), { target: { value: 'javascript:alert(1)' } });
    await save();
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getAllByRole('alert').some((a) => /can't be used/i.test(a.textContent ?? ''))).toBe(true);
  });

  it('an empty slideshow is refused visibly', async () => {
    const { onSave } = open('folder', { type: 'slideshow', images: [] });
    await save();
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/at least one image/i);
  });

  it('None saves no background', async () => {
    const { onSave } = open('folder', { type: 'image', value: '/presets/network-grid.jpg' });
    await fireEvent.click(screen.getByRole('button', { name: /^None$/ }));
    await save();
    expect(onSave).toHaveBeenCalledWith(undefined);
  });

  it('a failed library load is visible (bundled presets only)', async () => {
    getBackgrounds.mockRejectedValue(new Error('HTTP 500'));
    open('tab', { type: 'image', value: '/presets/network-grid.jpg' });
    await waitFor(() => expect(screen.getByText(/couldn't load your uploaded images/i)).toBeInTheDocument());
  });
});
