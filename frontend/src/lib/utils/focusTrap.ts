/**
 * Focus trap utility for modals and dialogs
 * Ensures keyboard focus stays within the modal when open
 * @module focusTrap
 */

/** CSS selectors for focusable elements */
const FOCUSABLE_SELECTORS = [
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'a[href]',
  '[tabindex]:not([tabindex="-1"])'
].join(', ');

/** Options for a focus trap. */
export interface FocusTrapOptions {
  /** Selector (inside the container) of the element to focus first; default: the first focusable one. */
  initialFocus?: string;
}

/**
 * Focus trap controller interface
 */
export interface FocusTrapController {
  /** Activates the focus trap */
  activate: () => void;
  /** Deactivates the focus trap and restores previous focus */
  deactivate: () => void;
}

/**
 * Creates a focus trap for a container element.
 * The trap keeps keyboard focus within the container when using Tab/Shift+Tab.
 *
 * @param container - The HTML element to trap focus within
 * @returns A controller object with activate and deactivate methods
 *
 * @example
 * ```ts
 * const trap = createFocusTrap(modalElement);
 * trap.activate(); // Start trapping focus
 * // ... later
 * trap.deactivate(); // Stop trapping and restore previous focus
 * ```
 */
export function createFocusTrap(container: HTMLElement, options: FocusTrapOptions = {}): FocusTrapController {
  let previouslyFocused: HTMLElement | null = null;

  function getFocusableElements(): HTMLElement[] {
    return Array.from(container.querySelectorAll(FOCUSABLE_SELECTORS));
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key !== 'Tab') return;

    const focusableElements = getFocusableElements();
    if (focusableElements.length === 0) return;

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    if (event.shiftKey) {
      // Shift + Tab: going backwards
      if (document.activeElement === firstElement || document.activeElement === container) {
        event.preventDefault();
        lastElement.focus();
      }
    } else {
      // Tab: going forwards
      if (document.activeElement === lastElement || document.activeElement === container) {
        event.preventDefault();
        firstElement.focus();
      }
    }
  }

  function activate() {
    // Store the currently focused element to restore later
    previouslyFocused = document.activeElement as HTMLElement;

    // Add the keydown listener
    container.addEventListener('keydown', handleKeydown);

    // Focus the first focusable element or the container itself
    const focusableElements = getFocusableElements();
    if (focusableElements.length > 0) {
      // Delay focus slightly to allow modal animation to complete
      requestAnimationFrame(() => {
        // The user (or a fast typist) already moved into a field of this dialog: never pull
        // the focus — and what they type next — back to the first one.
        const active = document.activeElement;
        if (active && active !== container && container.contains(active)) return;
        const preferred = options.initialFocus
          ? container.querySelector<HTMLElement>(options.initialFocus)
          : null;
        (preferred ?? focusableElements[0]).focus();
      });
    } else {
      // If no focusable elements, make container focusable and focus it
      if (!container.hasAttribute('tabindex')) {
        container.setAttribute('tabindex', '-1');
      }
      container.focus();
    }
  }

  function deactivate() {
    container.removeEventListener('keydown', handleKeydown);

    // Restore focus to the previously focused element
    if (previouslyFocused && previouslyFocused.focus) {
      previouslyFocused.focus();
    }
  }

  return {
    activate,
    deactivate
  };
}

/**
 * Svelte action for focus trapping.
 * Automatically activates on mount and deactivates on destroy.
 *
 * @param node - The HTML element to apply the focus trap to
 * @returns Svelte action return object with destroy method
 *
 * @example
 * ```svelte
 * <div class="modal" use:focusTrap>
 *   <!-- Modal content -->
 * </div>
 * ```
 */
export function focusTrap(node: HTMLElement, options: FocusTrapOptions = {}): { destroy: () => void } {
  const trap = createFocusTrap(node, options);
  trap.activate();

  return {
    destroy() {
      trap.deactivate();
    }
  };
}
