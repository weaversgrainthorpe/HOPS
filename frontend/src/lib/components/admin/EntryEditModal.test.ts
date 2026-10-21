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

// Walkthrough §2: three opacity sliders, saved with the dialog (staged until Save).
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

// Spec §8: Size sets the space the tile takes; the dialog shows the size matching the span.
describe('EntryEditModal Size', () => {
  beforeEach(() => editMode.set(true));
  afterEach(() => editMode.set(false));
  const sizeSelect = () => screen.getByLabelText(/^Size/) as HTMLSelectElement;

  function openSized(sizeShown: 'small' | 'medium' | 'large' | 'custom', checkSize = vi.fn(() => null as string | null)) {
    const onSave = vi.fn();
    render(EntryEditModal, { entry, onSave, onCancel: vi.fn(), sizeShown, checkSize });
    return { onSave, checkSize };
  }

  it('shows "Custom (resized)" for a non-standard span, and only then', async () => {
    openSized('custom');
    await tick();
    expect(sizeSelect().value).toBe('custom');
    expect(screen.getByRole('option', { name: 'Custom (resized)' })).toBeInTheDocument();
  });

  it('a standard span shows its size and no Custom option', async () => {
    openSized('large');
    await tick();
    expect(sizeSelect().value).toBe('large');
    expect(screen.queryByRole('option', { name: 'Custom (resized)' })).toBeNull();
  });

  it('a save without picking a size passes no size (the span is untouched)', async () => {
    const { onSave } = openSized('custom');
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
