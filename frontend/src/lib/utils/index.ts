/**
 * Utility functions barrel export
 * @module utils
 */

// API utilities
export * from './api';

// URL validation and handling
export { isValidUrl, safeOpenUrl } from './url';

// Form validation (only the used ones)
export { validatePassword, validateMatch } from './validation';

// Focus management
export { focusTrap, createFocusTrap, type FocusTrapController } from './focusTrap';

// Color utilities (only the used ones)
export { getAutoTextColor, getTextColorValue } from './colorContrast';

// Grid keyboard navigation
export { createGridKeyboardHandler, gridNav, type GridNavOptions } from './gridKeyboardNav';
