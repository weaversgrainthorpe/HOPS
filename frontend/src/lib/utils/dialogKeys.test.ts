import { describe, it, expect, vi, afterEach } from 'vitest';
import { dialogContentKeydown, dialogWindowEscape, isTopmostDialog } from './dialogKeys';

function dialog(): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  document.body.appendChild(el);
  return el;
}

const key = (k: string, init: KeyboardEventInit = {}) =>
  new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });

afterEach(() => {
  document.body.innerHTML = '';
});

describe('dialogContentKeydown (a dialog content element\'s keydown)', () => {
  it('Escape closes this dialog, and is marked handled and stopped', () => {
    const close = vi.fn();
    const e = key('Escape');
    const stop = vi.spyOn(e, 'stopPropagation');
    dialogContentKeydown(e, close);
    expect(close).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true);
    expect(stop).toHaveBeenCalled();
  });

  it('other keys never leak past the dialog (arrows, Delete, "/"), and do not close it', () => {
    const close = vi.fn();
    for (const k of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Delete', '/', 'z']) {
      const e = key(k);
      const stop = vi.spyOn(e, 'stopPropagation');
      dialogContentKeydown(e, close);
      expect(stop).toHaveBeenCalled();
      expect(e.defaultPrevented).toBe(false);
    }
    expect(close).not.toHaveBeenCalled();
  });

  it('an Escape something inside already handled (a dropdown) does not also close the dialog', () => {
    const close = vi.fn();
    const e = key('Escape');
    e.preventDefault();
    dialogContentKeydown(e, close);
    expect(close).not.toHaveBeenCalled();
  });

  it('an Escape that ends an IME composition does not close the dialog', () => {
    const close = vi.fn();
    dialogContentKeydown(key('Escape', { isComposing: true }), close);
    expect(close).not.toHaveBeenCalled();
  });
});

describe('dialogWindowEscape (focus outside every dialog)', () => {
  it('only the topmost open dialog closes', () => {
    const lower = dialog();
    const upper = dialog();
    const closeLower = vi.fn();
    const closeUpper = vi.fn();
    const e = key('Escape');
    // Both dialogs' window listeners see the same event; the topmost acts first and marks it handled.
    dialogWindowEscape(e, lower, closeLower);
    dialogWindowEscape(e, upper, closeUpper);
    expect(closeUpper).toHaveBeenCalledTimes(1);
    expect(closeLower).not.toHaveBeenCalled();
    expect(isTopmostDialog(upper)).toBe(true);
    expect(isTopmostDialog(lower)).toBe(false);
  });

  it('ignores an Escape already handled, other keys, and a dialog not (yet) mounted', () => {
    const el = dialog();
    const close = vi.fn();
    const handled = key('Escape');
    handled.preventDefault();
    dialogWindowEscape(handled, el, close);
    dialogWindowEscape(key('Enter'), el, close);
    dialogWindowEscape(key('Escape'), null, close);
    expect(close).not.toHaveBeenCalled();
  });

});
