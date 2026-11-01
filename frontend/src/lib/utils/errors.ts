// Standardized error handling utilities

/**
 * An answer that means the backend can't be reached, not that it answered: a proxy in front of it
 * says 502/503/504 when it is down.
 */
export function isBackendDownStatus(status: number): boolean {
  return status === 502 || status === 503 || status === 504;
}

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
