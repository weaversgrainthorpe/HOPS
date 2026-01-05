// Shared color constants for consistent theming across the application
// These colors follow the Tailwind CSS color palette naming convention

// Semantic colors for status and feedback
export const COLORS = {
  // Error/Danger states
  error: {
    DEFAULT: '#ef4444', // red-500
    light: '#f87171',   // red-400
    dark: '#dc2626',    // red-600
    hover: '#dc2626',   // red-600
  },

  // Warning states
  warning: {
    DEFAULT: '#f59e0b', // amber-500
    light: '#fbbf24',   // amber-400
    dark: '#d97706',    // amber-600
    hover: '#d97706',   // amber-600
  },

  // Success states
  success: {
    DEFAULT: '#10b981', // emerald-500
    light: '#34d399',   // emerald-400
    dark: '#059669',    // emerald-600
    hover: '#059669',   // emerald-600
    alt: '#22c55e',     // green-500 (alternative green)
  },

  // Primary/Info states
  primary: {
    DEFAULT: '#3b82f6', // blue-500
    light: '#60a5fa',   // blue-400
    dark: '#2563eb',    // blue-600
    hover: '#2563eb',   // blue-600
  },

  // Accent colors
  accent: {
    indigo: '#6366f1',  // indigo-500
    violet: '#8b5cf6',  // violet-500
    purple: '#a855f7',  // purple-500
    cyan: '#06b6d4',    // cyan-500
    teal: '#14b8a6',    // teal-500
    lime: '#84cc16',    // lime-500
  },

  // Neutral colors for UI elements
  neutral: {
    white: '#ffffff',
    black: '#000000',
    gray: {
      50: '#f9fafb',
      100: '#f3f4f6',
      200: '#e5e7eb',
      300: '#d1d5db',
      400: '#9ca3af',
      500: '#6b7280',
      600: '#4b5563',
      700: '#374151',
      800: '#1f2937',
      900: '#111827',
    },
  },
} as const;

// Status indicator colors
export const STATUS_COLORS = {
  online: COLORS.success.alt,   // #22c55e
  up: COLORS.success.DEFAULT,   // #10b981
  offline: COLORS.error.DEFAULT, // #ef4444
  down: COLORS.error.DEFAULT,    // #ef4444
  warning: COLORS.warning.DEFAULT, // #f59e0b
  error: COLORS.warning.DEFAULT,   // #f59e0b (for status, error shows as warning)
  unknown: COLORS.warning.DEFAULT, // #f59e0b
  pending: COLORS.neutral.gray[400], // #9ca3af
} as const;

// Toast notification colors
export const TOAST_COLORS = {
  success: COLORS.success.DEFAULT,
  error: COLORS.error.DEFAULT,
  warning: COLORS.warning.DEFAULT,
  info: COLORS.primary.DEFAULT,
} as const;

// Button variant colors
export const BUTTON_COLORS = {
  danger: {
    background: COLORS.error.DEFAULT,
    hover: COLORS.error.dark,
  },
  warning: {
    background: COLORS.warning.DEFAULT,
    hover: COLORS.warning.dark,
  },
  success: {
    background: COLORS.success.alt,
    hover: COLORS.success.dark,
  },
  primary: {
    background: COLORS.primary.DEFAULT,
    hover: COLORS.primary.dark,
  },
} as const;

// Modal type colors (for confirm modal, etc.)
export const MODAL_TYPE_COLORS = {
  danger: COLORS.error.DEFAULT,
  warning: COLORS.warning.DEFAULT,
  info: COLORS.primary.DEFAULT,
  success: COLORS.success.DEFAULT,
} as const;

// Gradient definitions for themes
export const GRADIENTS = {
  ocean: `linear-gradient(135deg, ${COLORS.accent.cyan} 0%, ${COLORS.primary.DEFAULT} 50%, ${COLORS.accent.violet} 100%)`,
  forest: `linear-gradient(135deg, ${COLORS.accent.teal} 0%, ${COLORS.success.DEFAULT} 50%, ${COLORS.accent.lime} 100%)`,
  sunset: `linear-gradient(135deg, #f97316 0%, #ef4444 50%, #ec4899 100%)`,
  purple: `linear-gradient(135deg, ${COLORS.accent.violet} 0%, ${COLORS.accent.indigo} 100%)`,
} as const;

// Helper function to get status color
export function getStatusColor(status: keyof typeof STATUS_COLORS): string {
  return STATUS_COLORS[status] || STATUS_COLORS.unknown;
}

// Helper function to get modal type color
export function getModalTypeColor(type: keyof typeof MODAL_TYPE_COLORS): string {
  return MODAL_TYPE_COLORS[type] || MODAL_TYPE_COLORS.info;
}

// Helper function to get toast color
export function getToastColor(type: keyof typeof TOAST_COLORS): string {
  return TOAST_COLORS[type] || TOAST_COLORS.info;
}

// Export color values as CSS custom properties format
export const CSS_VARIABLES = {
  '--color-error': COLORS.error.DEFAULT,
  '--color-error-dark': COLORS.error.dark,
  '--color-warning': COLORS.warning.DEFAULT,
  '--color-warning-dark': COLORS.warning.dark,
  '--color-success': COLORS.success.DEFAULT,
  '--color-success-dark': COLORS.success.dark,
  '--color-success-alt': COLORS.success.alt,
  '--color-primary': COLORS.primary.DEFAULT,
  '--color-primary-dark': COLORS.primary.dark,
  '--color-accent-indigo': COLORS.accent.indigo,
  '--color-accent-violet': COLORS.accent.violet,
  '--color-accent-cyan': COLORS.accent.cyan,
  '--color-accent-teal': COLORS.accent.teal,
  '--color-accent-lime': COLORS.accent.lime,
} as const;
