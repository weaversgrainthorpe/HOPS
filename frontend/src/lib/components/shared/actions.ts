/**
 * The one set of action buttons (Save, Discard, Undo, Redo, Cancel, Delete…): the same icon, word
 * and button class wherever the action appears. The icons are the dashboard edit toolbar's.
 * ActionButton draws a button from this; the edit toolbar and the confirm dialog read it too.
 */
export type ActionKind = 'save' | 'create' | 'discard' | 'undo' | 'redo' | 'cancel' | 'close' | 'delete' | 'duplicate' | 'reset';

export interface ActionLook {
  icon: string;
  label: string;
  /** Primary for Save and Create, danger for Delete, secondary for the rest. */
  style: 'primary' | 'secondary' | 'danger';
  /** Shown while the action runs (Save only). */
  busyLabel?: string;
}

export const ACTIONS: Record<ActionKind, ActionLook> = {
  save: { icon: 'mdi:content-save', label: 'Save', style: 'primary', busyLabel: 'Saving…' },
  create: { icon: 'mdi:content-save', label: 'Create', style: 'primary', busyLabel: 'Creating…' },
  discard: { icon: 'mdi:close-circle-outline', label: 'Discard', style: 'secondary' },
  undo: { icon: 'mdi:undo', label: 'Undo', style: 'secondary' },
  redo: { icon: 'mdi:redo', label: 'Redo', style: 'secondary' },
  cancel: { icon: 'mdi:close', label: 'Cancel', style: 'secondary' },
  close: { icon: 'mdi:close', label: 'Close', style: 'secondary' },
  delete: { icon: 'mdi:trash-can', label: 'Delete', style: 'danger', busyLabel: 'Deleting…' },
  duplicate: { icon: 'mdi:content-copy', label: 'Duplicate', style: 'secondary' },
  reset: { icon: 'mdi:restart', label: 'Reset to default', style: 'secondary' }
};

/** The shared button class for an action (app.css). */
export function actionClass(kind: ActionKind): string {
  return `btn-${ACTIONS[kind].style}`;
}

const BY_FIRST_WORD = new Map<string, ActionKind>(
  (Object.keys(ACTIONS) as ActionKind[]).map((k) => [ACTIONS[k].label.split(' ')[0], k])
);

/**
 * The action a button label names by its first word ("Delete anyway" is Delete), or null when it
 * names none of them: a label passed in from elsewhere (a confirm dialog) still gets the right icon.
 */
export function actionFor(label: string | undefined | null): ActionKind | null {
  if (!label) return null;
  return BY_FIRST_WORD.get(label.trim().split(/\s+/)[0]) ?? null;
}
