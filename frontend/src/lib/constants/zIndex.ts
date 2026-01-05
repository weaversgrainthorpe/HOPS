/**
 * Z-index constants for consistent layering across the application
 *
 * Layer hierarchy (lowest to highest):
 * - Base content (0)
 * - Elevated content (10)
 * - Sticky elements like navbar (100)
 * - Dropdowns and tooltips (200)
 * - Standard modals (1000)
 * - Nested/overlay modals (1100)
 * - Critical modals like confirm dialogs (1200)
 * - Toast notifications (1300)
 * - Easter eggs/animations (1400)
 */

export const Z_INDEX = {
  /** Base content layer */
  base: 0,

  /** Slightly elevated content (hover controls, badges) */
  elevated: 10,

  /** Sticky navigation elements */
  navbar: 100,

  /** Dropdown menus and tooltips */
  dropdown: 200,

  /** Context menus */
  contextMenu: 300,

  /** Standard modal dialogs */
  modal: 1000,

  /** Modals that appear over other modals (nested modals) */
  modalOverlay: 1100,

  /** Critical dialogs like confirm/delete (must be above all other modals) */
  modalCritical: 1200,

  /** Toast notifications (always visible) */
  toast: 1300,

  /** Easter eggs and special animations */
  easter: 1400,
} as const;

export type ZIndexKey = keyof typeof Z_INDEX;
