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
