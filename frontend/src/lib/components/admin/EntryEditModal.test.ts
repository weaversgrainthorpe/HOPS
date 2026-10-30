import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import EntryEditModal from './EntryEditModal.svelte';
import { editMode } from '$lib/stores/editMode';
import type { Entry } from '$lib/types';

const entry: Entry = {
  id: 'e1', name: 'Plain', url: 'http://x.test', icon: 'mdi:lan', openMode: 'newtab', size: 'medium', order: 0
};

function open(e: Entry = entry) {
  const onSave = vi.fn();
  const onCancel = vi.fn();
  render(EntryEditModal, { entry: e, onSave, onCancel });
  return { onSave, onCancel };
}
const slider = (name: RegExp) => screen.getByRole('slider', { name }) as HTMLInputElement;
const save = () => fireEvent.click(screen.getByRole('button', { name: /^Save/ }));

// Three opacity sliders, saved with the dialog (staged until Save).
describe('EntryEditModal opacity sliders', () => {
  beforeEach(() => editMode.set(true));
  afterEach(() => editMode.set(false));

  it('has "Background opacity", "Text opacity" and "Icon opacity" sliders with their defaults', async () => {
    open();
    await tick();
    expect(slider(/^Background opacity/).value).toBe('95');
    expect(slider(/^Text opacity/).value).toBe('100');
    expect(slider(/^Icon opacity/).value).toBe('100');
    expect(screen.queryByRole('slider', { name: /^Opacity/ })).toBeNull();
  });

  it('shows stored values, clamped', async () => {
    open({ ...entry, opacity: 0.2, textOpacity: 2, iconOpacity: 0.5 });
    await tick();
    expect(slider(/^Background opacity/).value).toBe('20');
    expect(slider(/^Text opacity/).value).toBe('100');
    expect(slider(/^Icon opacity/).value).toBe('50');
  });

  it('a moved slider is written on Save only; untouched ones write nothing', async () => {
    const { onSave } = open();
    await tick();
    await fireEvent.input(slider(/^Text opacity/), { target: { value: '40' } });
    await fireEvent.input(slider(/^Background opacity/), { target: { value: '20' } });
    expect(onSave).not.toHaveBeenCalled();
    await save();
    expect(onSave).toHaveBeenCalledTimes(1);
    const out = onSave.mock.calls[0][0] as Entry;
    expect(out.textOpacity).toBe(0.4);
    expect(out.opacity).toBe(0.2);
    expect(out).not.toHaveProperty('iconOpacity');
  });

  it('Reset clears a field back to its default (stored as unset)', async () => {
    const { onSave } = open({ ...entry, iconOpacity: 0.3 });
    await tick();
    const group = slider(/^Icon opacity/).closest('.opacity-slider') as HTMLElement;
    await fireEvent.click(group.querySelector('.reset-btn')!);
    expect(slider(/^Icon opacity/).value).toBe('100');
    await save();
    expect((onSave.mock.calls[0][0] as Entry).iconOpacity).toBeUndefined();
  });
});

// Size sets the space the tile takes on a tab; the dialog shows the tile's own size,
// Small, Medium or Large only (no "Custom").
describe('EntryEditModal Size', () => {
  beforeEach(() => editMode.set(true));
  afterEach(() => editMode.set(false));
  const sizeSelect = () => screen.getByLabelText(/^Size/) as HTMLSelectElement;

  function openSized(size: 'small' | 'medium' | 'large' | undefined, checkSize = vi.fn(() => null as string | null)) {
    const onSave = vi.fn();
    render(EntryEditModal, { entry: { ...entry, size } as Entry, onSave, onCancel: vi.fn(), checkSize });
    return { onSave, checkSize };
  }

  it('shows the stored size, with exactly Small, Medium and Large on offer', async () => {
    openSized('large');
    await tick();
    expect(sizeSelect().value).toBe('large');
    expect([...sizeSelect().options].map((o) => o.textContent)).toEqual(['Small', 'Medium', 'Large']);
    expect(screen.queryByRole('option', { name: 'Custom' })).toBeNull();
  });

  it('a missing size shows Medium', async () => {
    openSized(undefined);
    await tick();
    expect(sizeSelect().value).toBe('medium');
  });

  it('a save without picking a size passes no size (the span is untouched)', async () => {
    const { onSave } = openSized('medium');
    await tick();
    await save();
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][1]).toEqual({});
    expect((onSave.mock.calls[0][0] as Entry).size).toBe('medium');
  });

  it('picking a size stages it (checked at once) and Save passes it', async () => {
    const { onSave, checkSize } = openSized('medium');
    await tick();
    await fireEvent.change(sizeSelect(), { target: { value: 'large' } });
    expect(checkSize).toHaveBeenCalledWith('large');
    expect(onSave).not.toHaveBeenCalled();
    await save();
    expect(onSave.mock.calls[0][1]).toEqual({ size: 'large' });
    expect((onSave.mock.calls[0][0] as Entry).size).toBe('large');
  });

  it('a refused size shows the reason inline and Save does not go through', async () => {
    const { onSave } = openSized('medium', vi.fn(() => 'There is no room for a large tile here.'));
    await tick();
    await fireEvent.change(sizeSelect(), { target: { value: 'large' } });
    expect(screen.getByRole('alert')).toHaveTextContent('There is no room for a large tile here.');
    await save();
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('no room');
  });
});

describe('EntryEditModal URL check', () => {
  const urlInput = () => screen.getByLabelText(/^Address/) as HTMLInputElement;

  it('a mistyped URL is named in the dialog on leaving the field, and Save does not go through', async () => {
    const onSave = vi.fn();
    render(EntryEditModal, { entry: { ...entry, url: 'https://ok.example' } as Entry, onSave, onCancel: vi.fn() });
    await fireEvent.input(urlInput(), { target: { value: 'http:\\\\172.16.0.1' } });
    await fireEvent.blur(urlInput());
    expect(screen.getByRole('alert').textContent).toMatch(/forward slashes/);
    expect(urlInput().getAttribute('aria-invalid')).toBe('true');
    await save();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('a refused scheme is named too, and a fixed URL saves', async () => {
    const onSave = vi.fn();
    render(EntryEditModal, { entry: { ...entry, url: 'https://ok.example' } as Entry, onSave, onCancel: vi.fn() });
    await fireEvent.input(urlInput(), { target: { value: 'file:///etc/passwd' } });
    await save();
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/valid address/);
    await fireEvent.input(urlInput(), { target: { value: 'http://172.16.0.1' } });
    expect(screen.queryByRole('alert')).toBeNull();
    await save();
    expect(onSave).toHaveBeenCalledOnce();
    expect(onSave.mock.calls[0][0].url).toBe('http://172.16.0.1');
  });

  it('a saved address HOPS does not open (kept from v2) says why at once; Save waits, Cancel leaves it', async () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    editMode.set(true);
    render(EntryEditModal, { entry: { ...entry, url: 'rdp://pc.lan' } as Entry, onSave, onCancel });
    await tick();
    expect(screen.getByRole('alert').textContent).toBe(
      "This address uses rdp:, which HOPS doesn't open. Change it or leave the tile as it is."
    );
    await save();
    expect(onSave).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByRole('button', { name: /^Cancel/ }));
    expect(onCancel).toHaveBeenCalled();
    editMode.set(false);
  });
});
