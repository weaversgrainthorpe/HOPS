/**
 * Design tokens for consistent styling across the application
 * These mirror the CSS custom properties defined in app.css
 */

// Border radius tokens
export const RADIUS = {
  sm: '0.25rem',    // --radius-sm: 4px
  md: '0.375rem',   // --radius-md: 6px
  lg: '0.5rem',     // --radius-lg: 8px
  xl: '0.75rem',    // --radius-xl: 12px
  '2xl': '1rem',    // --radius-2xl: 16px
  full: '9999px',   // --radius-full: full circle
} as const;

// Spacing tokens (matches Tailwind scale)
export const SPACE = {
  1: '0.25rem',     // 4px
  2: '0.5rem',      // 8px
  3: '0.75rem',     // 12px
  4: '1rem',        // 16px
  5: '1.25rem',     // 20px
  6: '1.5rem',      // 24px
  8: '2rem',        // 32px
  10: '2.5rem',     // 40px
  12: '3rem',       // 48px
  16: '4rem',       // 64px
} as const;

// Shadow tokens
export const SHADOW = {
  sm: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
  md: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1)',
  lg: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1)',
  xl: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
  modal: '0 20px 25px -5px rgba(0, 0, 0, 0.3)',
} as const;

// Transition tokens
export const TRANSITION = {
  fast: '0.15s ease',
  normal: '0.2s ease',
  slow: '0.3s ease',
} as const;

// Export types
export type RadiusKey = keyof typeof RADIUS;
export type SpaceKey = keyof typeof SPACE;
export type ShadowKey = keyof typeof SHADOW;
export type TransitionKey = keyof typeof TRANSITION;
