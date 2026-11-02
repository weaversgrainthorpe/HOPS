import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import ContentScaleSetting from './ContentScaleSetting.svelte';

describe('ContentScaleSetting: the dashboard\'s Tile content size slider', () => {
  it('a labelled native range, 75–125 in steps of 5, its value read out as a percentage', async () => {
    render(ContentScaleSetting, { stored: 110 });
    const s = screen.getByRole('slider', { name: 'Tile content size' }) as HTMLInputElement;
    expect(s.type).toBe('range');
    expect([s.min, s.max, s.step, s.value]).toEqual(['75', '125', '5', '110']);
    expect(s.getAttribute('aria-valuetext')).toBe('110%');
    expect(screen.getByText('110%').getAttribute('aria-hidden')).toBe('true'); // said once, by the slider
    expect(document.getElementById(s.getAttribute('aria-describedby')!)!.textContent).toMatch(/Small tiles change least/);
  });

  it('a missing value is 100%; value() is undefined while nothing changed (the dashboard is untouched)', async () => {
    const { component } = render(ContentScaleSetting, {});
    expect((screen.getByRole('slider') as HTMLInputElement).value).toBe('100');
    expect(component.value()).toBeUndefined();
    expect((screen.getByRole('button', { name: 'Reset to 100%' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('moving it changes the value and its read-out; Reset to 100% puts it back to normal', async () => {
    const { component } = render(ContentScaleSetting, { stored: 100 });
    const s = screen.getByRole('slider') as HTMLInputElement;
    await fireEvent.input(s, { target: { value: '125' } });
    await tick();
    expect(component.value()).toBe(125);
    expect(s.getAttribute('aria-valuetext')).toBe('125%');
    const reset = screen.getByRole('button', { name: 'Reset to 100%' }) as HTMLButtonElement;
    expect(reset.disabled).toBe(false);
    await fireEvent.click(reset);
    await tick();
    expect(component.value()).toBeUndefined(); // back to what is stored
    expect(s.value).toBe('100');
  });

  it('a stored value the server would refuse: drawn at 100% and says so (never silently)', async () => {
    const { component } = render(ContentScaleSetting, { stored: 130 });
    expect((screen.getByRole('slider') as HTMLInputElement).value).toBe('100');
    const note = screen.getByText(/can't be used/);
    expect(note.getAttribute('role')).toBe('status');
    expect(note.textContent).toMatch(/130.*100%/s);
    // Saving with the slider untouched writes the fix (100), so the bad value doesn't stay stored.
    expect(component.value()).toBe(100);
  });
});
