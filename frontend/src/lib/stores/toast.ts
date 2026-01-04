import { writable } from 'svelte/store';

export interface Toast {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  message: string;
  duration?: number;
}

function createToastStore() {
  const { subscribe, update } = writable<Toast[]>([]);

  function add(toast: Omit<Toast, 'id'>) {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const newToast: Toast = { ...toast, id };

    update(toasts => [...toasts, newToast]);

    // Auto-remove after duration (default 4 seconds)
    const duration = toast.duration ?? 4000;
    if (duration > 0) {
      setTimeout(() => {
        remove(id);
      }, duration);
    }

    return id;
  }

  function remove(id: string) {
    update(toasts => toasts.filter(t => t.id !== id));
  }

  function clear() {
    update(() => []);
  }

  return {
    subscribe,
    add,
    remove,
    clear,
    success: (message: string, duration?: number) => add({ type: 'success', message, duration }),
    error: (message: string, duration?: number) => add({ type: 'error', message, duration: duration ?? 6000 }),
    warning: (message: string, duration?: number) => add({ type: 'warning', message, duration }),
    info: (message: string, duration?: number) => add({ type: 'info', message, duration })
  };
}

export const toast = createToastStore();
