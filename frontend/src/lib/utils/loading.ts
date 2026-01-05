// Loading state management utilities

import { writable, type Writable } from 'svelte/store';

export interface LoadingState {
  isLoading: boolean;
  error: string | null;
  message?: string;
}

/**
 * Creates a loading state store with helper methods
 */
export function createLoadingState(initialMessage?: string): {
  subscribe: Writable<LoadingState>['subscribe'];
  start: (message?: string) => void;
  stop: () => void;
  setError: (error: string | Error) => void;
  reset: () => void;
  get: () => LoadingState;
} {
  const initialState: LoadingState = {
    isLoading: false,
    error: null,
    message: initialMessage
  };

  const { subscribe, set, update } = writable<LoadingState>(initialState);

  let currentState = initialState;

  // Keep track of current state
  subscribe(state => {
    currentState = state;
  });

  return {
    subscribe,
    start: (message?: string) => {
      set({
        isLoading: true,
        error: null,
        message: message || initialMessage
      });
    },
    stop: () => {
      update(state => ({
        ...state,
        isLoading: false,
        message: undefined
      }));
    },
    setError: (error: string | Error) => {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : error,
        message: undefined
      });
    },
    reset: () => {
      set(initialState);
    },
    get: () => currentState
  };
}

/**
 * Wraps an async function with loading state management
 */
export async function withLoading<T>(
  loadingState: ReturnType<typeof createLoadingState>,
  fn: () => Promise<T>,
  options?: {
    loadingMessage?: string;
    errorMessage?: string;
    rethrow?: boolean;
  }
): Promise<T | null> {
  try {
    loadingState.start(options?.loadingMessage);
    const result = await fn();
    loadingState.stop();
    return result;
  } catch (error) {
    const errorMsg = options?.errorMessage ||
      (error instanceof Error ? error.message : 'An error occurred');
    loadingState.setError(errorMsg);

    if (options?.rethrow) {
      throw error;
    }
    return null;
  }
}

/**
 * Simple loading state for component-level use
 */
export function useLoading() {
  let isLoading = $state(false);
  let error = $state<string | null>(null);

  return {
    get isLoading() { return isLoading; },
    get error() { return error; },
    start: () => {
      isLoading = true;
      error = null;
    },
    stop: () => {
      isLoading = false;
    },
    setError: (err: string | Error) => {
      isLoading = false;
      error = err instanceof Error ? err.message : err;
    },
    reset: () => {
      isLoading = false;
      error = null;
    },
    async wrap<T>(fn: () => Promise<T>): Promise<T | null> {
      try {
        isLoading = true;
        error = null;
        const result = await fn();
        isLoading = false;
        return result;
      } catch (e) {
        isLoading = false;
        error = e instanceof Error ? e.message : 'An error occurred';
        return null;
      }
    }
  };
}

/**
 * Debounced loading state - only shows loading after a delay
 * Useful for operations that might complete quickly
 */
export function createDebouncedLoading(delay = 200): {
  subscribe: Writable<boolean>['subscribe'];
  start: () => void;
  stop: () => void;
} {
  const { subscribe, set } = writable(false);
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let isActive = false;

  return {
    subscribe,
    start: () => {
      isActive = true;
      timeout = setTimeout(() => {
        if (isActive) {
          set(true);
        }
      }, delay);
    },
    stop: () => {
      isActive = false;
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
      set(false);
    }
  };
}
