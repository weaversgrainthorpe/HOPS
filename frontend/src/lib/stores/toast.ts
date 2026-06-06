import { writable } from 'svelte/store';

export interface Toast {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  message: string;
  duration?: number;
}

function createToastStore() {
  const { subscribe, update } = writable<Toast[]>([]);

  // Timers tracked outside the store so pause/resume can re-arm them
  // without forcing a store update on every hover. WCAG 2.2.1 (Timing
  // Adjustable): user hover or focus must pause the auto-dismiss
  // countdown — losing a flash error to a 4s timer while the user is
  // reading it is a real accessibility failure.
  const timers = new Map<string, { handle: number; duration: number }>();

  function arm(id: string, duration: number) {
    const handle = window.setTimeout(() => {
      remove(id);
    }, duration);
    timers.set(id, { handle, duration });
  }

  function add(toast: Omit<Toast, 'id'>) {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const newToast: Toast = { ...toast, id };

    update(toasts => [...toasts, newToast]);

    const duration = toast.duration ?? 4000;
    if (duration > 0) arm(id, duration);

    return id;
  }

  function remove(id: string) {
    const t = timers.get(id);
    if (t) {
      clearTimeout(t.handle);
      timers.delete(id);
    }
    update(toasts => toasts.filter(t => t.id !== id));
  }

  // Pause the dismiss countdown while the user is hovering or focused
  // on the toast. Pairs with resume() — we clear the timer entirely and
  // restart it on resume with the original duration. Simpler than the
  // "deduct elapsed ms" alternative and matches user intuition (you
  // hovered, so the timer was reset).
  function pause(id: string) {
    const t = timers.get(id);
    if (t) {
      clearTimeout(t.handle);
    }
  }

  function resume(id: string) {
    const t = timers.get(id);
    if (t) arm(id, t.duration);
  }

  function clear() {
    for (const t of timers.values()) clearTimeout(t.handle);
    timers.clear();
    update(() => []);
  }

  return {
    subscribe,
    add,
    remove,
    pause,
    resume,
    clear,
    success: (message: string, duration?: number) => add({ type: 'success', message, duration }),
    error: (message: string, duration?: number) => add({ type: 'error', message, duration: duration ?? 6000 }),
    warning: (message: string, duration?: number) => add({ type: 'warning', message, duration }),
    info: (message: string, duration?: number) => add({ type: 'info', message, duration })
  };
}

export const toast = createToastStore();
