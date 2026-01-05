/**
 * Keyboard navigation for grid-based option selections
 * Enables arrow key navigation within option grids in modals
 */

export interface GridNavOptions {
  /** Number of columns in the grid (or function to calculate it) */
  columns: number | (() => number);
  /** Callback when selection changes */
  onSelect: (index: number) => void;
  /** Total number of items */
  itemCount: number;
  /** Whether to wrap around at edges */
  wrap?: boolean;
}

/**
 * Creates a keyboard event handler for grid navigation
 */
export function createGridKeyboardHandler(
  getCurrentIndex: () => number,
  options: GridNavOptions
) {
  const getColumns = () =>
    typeof options.columns === 'function' ? options.columns() : options.columns;

  return (e: KeyboardEvent) => {
    const current = getCurrentIndex();
    const cols = getColumns();
    const total = options.itemCount;
    const wrap = options.wrap ?? true;

    let newIndex = current;

    switch (e.key) {
      case 'ArrowRight':
        e.preventDefault();
        if (wrap) {
          newIndex = (current + 1) % total;
        } else {
          newIndex = Math.min(current + 1, total - 1);
        }
        break;

      case 'ArrowLeft':
        e.preventDefault();
        if (wrap) {
          newIndex = (current - 1 + total) % total;
        } else {
          newIndex = Math.max(current - 1, 0);
        }
        break;

      case 'ArrowDown':
        e.preventDefault();
        const nextRow = current + cols;
        if (nextRow < total) {
          newIndex = nextRow;
        } else if (wrap) {
          // Wrap to top of same column
          newIndex = current % cols;
        }
        break;

      case 'ArrowUp':
        e.preventDefault();
        const prevRow = current - cols;
        if (prevRow >= 0) {
          newIndex = prevRow;
        } else if (wrap) {
          // Wrap to bottom of same column
          const col = current % cols;
          const lastRowStart = Math.floor((total - 1) / cols) * cols;
          newIndex = Math.min(lastRowStart + col, total - 1);
        }
        break;

      case 'Home':
        e.preventDefault();
        newIndex = 0;
        break;

      case 'End':
        e.preventDefault();
        newIndex = total - 1;
        break;

      default:
        return; // Don't prevent default for other keys
    }

    if (newIndex !== current && newIndex >= 0 && newIndex < total) {
      options.onSelect(newIndex);
    }
  };
}

/**
 * Svelte action for grid keyboard navigation
 * Usage: use:gridNav={{ items, selectedIndex, onSelect, columns }}
 */
export function gridNav<T>(
  node: HTMLElement,
  params: {
    items: T[];
    selectedIndex: number;
    onSelect: (index: number) => void;
    columns?: number;
  }
) {
  let currentParams = params;

  const handler = (e: KeyboardEvent) => {
    const keyHandler = createGridKeyboardHandler(
      () => currentParams.selectedIndex,
      {
        columns: currentParams.columns || 3,
        itemCount: currentParams.items.length,
        onSelect: currentParams.onSelect
      }
    );
    keyHandler(e);
  };

  node.addEventListener('keydown', handler);

  return {
    update(newParams: typeof params) {
      currentParams = newParams;
    },
    destroy() {
      node.removeEventListener('keydown', handler);
    }
  };
}
