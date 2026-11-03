import { describe, it, expect } from 'vitest';
import { ACTIONS, actionFor, actionClass } from './actions';

describe('the one set of action buttons', () => {
  it('uses the edit toolbar icons for Undo, Redo, Discard and Save', () => {
    expect(ACTIONS.undo.icon).toBe('mdi:undo');
    expect(ACTIONS.redo.icon).toBe('mdi:redo');
    expect(ACTIONS.discard.icon).toBe('mdi:close-circle-outline');
    expect(ACTIONS.save.icon).toBe('mdi:content-save');
  });

  it('has one plain word per action', () => {
    expect(Object.fromEntries(Object.entries(ACTIONS).map(([k, a]) => [k, a.label]))).toEqual({
      save: 'Save', create: 'Create', discard: 'Discard', undo: 'Undo', redo: 'Redo', cancel: 'Cancel',
      close: 'Close', delete: 'Delete', duplicate: 'Duplicate', reset: 'Reset to default'
    });
  });

  it('gives every action an icon', () => {
    for (const a of Object.values(ACTIONS)) expect(a.icon).toMatch(/^mdi:/);
  });

  it('is primary for Save and Create, danger for Delete, secondary for the rest', () => {
    expect(actionClass('save')).toBe('btn-primary');
    expect(actionClass('create')).toBe('btn-primary');
    expect(actionClass('delete')).toBe('btn-danger');
    for (const k of ['discard', 'undo', 'redo', 'cancel', 'close', 'duplicate', 'reset'] as const) {
      expect(actionClass(k)).toBe('btn-secondary');
    }
  });

  it('finds the action a button label names, and nothing for any other label', () => {
    expect(actionFor('Delete')).toBe('delete');
    expect(actionFor('Cancel')).toBe('cancel');
    expect(actionFor('Reset to default')).toBe('reset');
    expect(actionFor('Delete anyway')).toBe('delete');
    expect(actionFor('Discard staged restore')).toBe('discard');
    expect(actionFor('Sign out')).toBeNull();
    expect(actionFor('Confirm')).toBeNull();
    expect(actionFor(undefined)).toBeNull();
    expect(actionFor('Saved')).toBeNull();
  });
});
