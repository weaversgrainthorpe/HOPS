// Shared UI constants for consistent timing, sizing, and spacing

/**
 * Animation and transition durations in milliseconds
 */
export const DURATIONS = {
  // Fast interactions (hover, focus)
  instant: 100,
  fast: 150,
  normal: 200,
  slow: 300,

  // Modal animations
  modalOpen: 200,
  modalClose: 150,

  // Slideshow transitions (in seconds for CSS)
  slideshowDefault: 1.5,
  slideshowMin: 0.5,
  slideshowMax: 5,

  // Toast notifications
  toastDisplay: 5000,
  toastFade: 300,

  // Debounce/throttle timings
  searchDebounce: 300,
  autosaveDebounce: 1000,

  // Status check intervals
  statusCheckInterval: 30000, // 30 seconds
  backendCheckInterval: 30000, // 30 seconds
} as const;

/**
 * Z-index layers for consistent stacking
 */
export const Z_INDEX = {
  background: 0,
  content: 1,
  sticky: 100,
  dropdown: 500,
  modal: 1000,
  modalOverlay: 999,
  toast: 9000,
  confirmModal: 10000,
  tooltip: 11000,
} as const;

/**
 * Common breakpoints for responsive design
 */
export const BREAKPOINTS = {
  mobile: 480,
  tablet: 768,
  laptop: 1024,
  desktop: 1280,
  widescreen: 1536,
} as const;

/**
 * Spacing scale (in rem units)
 */
export const SPACING = {
  xs: '0.25rem',   // 4px
  sm: '0.5rem',    // 8px
  md: '0.75rem',   // 12px
  lg: '1rem',      // 16px
  xl: '1.5rem',    // 24px
  '2xl': '2rem',   // 32px
  '3xl': '3rem',   // 48px
} as const;

/**
 * Border radius values
 */
export const RADIUS = {
  sm: '0.25rem',   // 4px
  md: '0.375rem',  // 6px
  lg: '0.5rem',    // 8px
  xl: '0.75rem',   // 12px
  full: '9999px',
} as const;

/**
 * Icon sizes
 */
export const ICON_SIZES = {
  xs: 14,
  sm: 16,
  md: 20,
  lg: 24,
  xl: 32,
  '2xl': 48,
} as const;

/**
 * Tile/entry sizes
 */
export const TILE_SIZES = {
  small: {
    width: '80px',
    height: '80px',
    iconSize: 32,
    fontSize: '0.75rem',
  },
  medium: {
    width: '100px',
    height: '100px',
    iconSize: 40,
    fontSize: '0.875rem',
  },
  large: {
    width: '120px',
    height: '120px',
    iconSize: 48,
    fontSize: '1rem',
  },
} as const;

/**
 * Modal sizes (max-width)
 */
export const MODAL_SIZES = {
  sm: '400px',
  md: '600px',
  lg: '800px',
  xl: '1000px',
  full: '100%',
} as const;

/**
 * Opacity presets for UI elements
 */
export const OPACITY = {
  disabled: 0.5,
  secondary: 0.7,
  hover: 0.8,
  overlay: 0.7,
  backdrop: 0.7,
} as const;

/**
 * Box shadow presets
 */
export const SHADOWS = {
  sm: '0 1px 2px rgba(0, 0, 0, 0.05)',
  md: '0 4px 6px rgba(0, 0, 0, 0.1)',
  lg: '0 10px 15px rgba(0, 0, 0, 0.1)',
  xl: '0 20px 25px rgba(0, 0, 0, 0.15)',
  modal: '0 20px 25px -5px rgba(0, 0, 0, 0.3)',
} as const;

/**
 * Helper to get a CSS variable with fallback
 */
export function cssVar(name: string, fallback?: string): string {
  return fallback ? `var(${name}, ${fallback})` : `var(${name})`;
}

/**
 * Helper to convert milliseconds to CSS seconds
 */
export function toSeconds(ms: number): string {
  return `${ms / 1000}s`;
}
