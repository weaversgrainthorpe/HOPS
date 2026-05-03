// Standardized error handling utilities

/**
 * Logs an error for debugging (only in development)
 */
export function logError(context: string, error: unknown): void {
  if (import.meta.env.DEV) {
    console.error(`[${context}]`, error);
  }
}

/**
 * Logs a warning for debugging (only in development)
 */
export function logWarn(message: string): void {
  if (import.meta.env.DEV) {
    console.warn(message);
  }
}
