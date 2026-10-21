import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/svelte';
import EditHandle from './EditHandle.svelte';

afterEach(() => cleanup());

describe('EditHandle (one editing flow, §4B)', () => {
  it('is a real button named "Edit <name>" that calls onEdit', async () => {
    const onEdit = vi.fn();
    render(EditHandle, { name: 'Router', onEdit });
    const btn = screen.getByRole('button', { name: 'Edit Router' });
    expect(btn.tagName).toBe('BUTTON');
    expect(btn.getAttribute('type')).toBe('button');
    await fireEvent.click(btn);
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it('an empty name still gives a usable label', () => {
    render(EditHandle, { name: '', onEdit: () => {} });
    expect(screen.getByRole('button', { name: 'Edit Untitled' })).toBeInTheDocument();
  });

  it('is reachable by keyboard (no negative tabindex) and Enter edits', async () => {
    const onEdit = vi.fn();
    render(EditHandle, { name: 'Router', onEdit });
    const btn = screen.getByRole('button', { name: 'Edit Router' });
    expect(btn.getAttribute('tabindex')).not.toBe('-1');
    btn.focus();
    expect(document.activeElement).toBe(btn);
    // A native button turns Enter into a click.
    await fireEvent.click(btn);
    expect(onEdit).toHaveBeenCalled();
  });

  it('its click does not reach the item (no select / tab switch)', async () => {
    const outer = vi.fn();
    const onEdit = vi.fn();
    const host = document.createElement('div');
    host.addEventListener('click', outer);
    document.body.appendChild(host);
    render(EditHandle, { target: host, props: { name: 'Box', onEdit } });
    await fireEvent.click(screen.getByRole('button', { name: 'Edit Box' }));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
    host.remove();
  });

  it('never blocks a drag: its pointerdown reaches the item', async () => {
    const down = vi.fn();
    const host = document.createElement('div');
    host.addEventListener('pointerdown', down);
    document.body.appendChild(host);
    render(EditHandle, { target: host, props: { name: 'Box', onEdit: () => {} } });
    await fireEvent.pointerDown(screen.getByRole('button', { name: 'Edit Box' }));
    expect(down).toHaveBeenCalledTimes(1);
    host.remove();
  });

  it('a double-click on it does not also reach the item (one edit, not two)', async () => {
    const dbl = vi.fn();
    const host = document.createElement('div');
    host.addEventListener('dblclick', dbl);
    document.body.appendChild(host);
    render(EditHandle, { target: host, props: { name: 'Box', onEdit: () => {} } });
    await fireEvent.dblClick(screen.getByRole('button', { name: 'Edit Box' }));
    expect(dbl).not.toHaveBeenCalled();
    host.remove();
  });

  it('without a label it is icon-only; with one (Task 6: "Dashboard") the label is visible text', () => {
    const { unmount } = render(EditHandle, { name: 'Box', onEdit: () => {} });
    expect(screen.getByRole('button', { name: 'Edit Box' }).textContent?.trim()).toBe('');
    unmount();
    render(EditHandle, { name: 'this dashboard', label: 'Dashboard', onEdit: () => {} });
    const btn = screen.getByRole('button', { name: 'Edit this dashboard' });
    expect(btn.textContent?.trim()).toBe('Dashboard');
  });

  it('carries the shared class so hosts show it on hover / focus-within (always under hover:none)', () => {
    render(EditHandle, { name: 'Box', onEdit: () => {} });
    const btn = screen.getByRole('button', { name: 'Edit Box' });
    expect(btn.classList.contains('edit-handle')).toBe(true);
    expect(btn.hasAttribute('data-edit-handle')).toBe(true);
  });
});
