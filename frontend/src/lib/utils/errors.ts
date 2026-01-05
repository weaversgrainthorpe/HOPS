// Standardized error handling utilities

import { toast } from '$lib/stores/toast';

/**
 * Custom API error class with additional context
 */
export class ApiError extends Error {
  public readonly status: number;
  public readonly statusText: string;
  public readonly details?: string;

  constructor(status: number, statusText: string, details?: string) {
    super(`API error: ${status} ${statusText}${details ? ` - ${details}` : ''}`);
    this.name = 'ApiError';
    this.status = status;
    this.statusText = statusText;
    this.details = details;
  }

  /**
   * Returns a user-friendly error message
   */
  getUserMessage(): string {
    switch (this.status) {
      case 400:
        return this.details || 'Invalid request. Please check your input.';
      case 401:
        return 'Authentication required. Please log in.';
      case 403:
        return 'Access denied. You do not have permission for this action.';
      case 404:
        return this.details || 'The requested resource was not found.';
      case 409:
        return this.details || 'A conflict occurred. The resource may already exist.';
      case 413:
        return 'The file is too large.';
      case 422:
        return this.details || 'The request could not be processed.';
      case 429:
        return 'Too many requests. Please try again later.';
      case 500:
        return 'An internal server error occurred. Please try again.';
      case 502:
      case 503:
      case 504:
        return 'The server is temporarily unavailable. Please try again later.';
      default:
        return this.details || 'An unexpected error occurred.';
    }
  }
}

/**
 * Network error for when the request fails to reach the server
 */
export class NetworkError extends Error {
  constructor(message: string = 'Network error. Please check your connection.') {
    super(message);
    this.name = 'NetworkError';
  }
}

/**
 * Parses an error from various sources into a standardized format
 */
export function parseError(error: unknown): Error {
  if (error instanceof ApiError || error instanceof NetworkError) {
    return error;
  }

  if (error instanceof Error) {
    // Check for network-related errors
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      return new NetworkError();
    }
    return error;
  }

  if (typeof error === 'string') {
    return new Error(error);
  }

  return new Error('An unknown error occurred');
}

/**
 * Gets a user-friendly message from any error
 */
export function getErrorMessage(error: unknown): string {
  const parsed = parseError(error);

  if (parsed instanceof ApiError) {
    return parsed.getUserMessage();
  }

  if (parsed instanceof NetworkError) {
    return parsed.message;
  }

  // For generic errors, use the message but sanitize it
  const message = parsed.message;

  // Don't expose technical details to users
  if (message.includes('API error:') ||
      message.includes('fetch') ||
      message.includes('undefined') ||
      message.includes('null')) {
    return 'An unexpected error occurred. Please try again.';
  }

  return message;
}

/**
 * Shows an error toast with a user-friendly message
 */
export function showError(error: unknown, fallbackMessage?: string): void {
  const message = getErrorMessage(error);
  toast.error(fallbackMessage || message);
}

/**
 * Shows a success toast
 */
export function showSuccess(message: string): void {
  toast.success(message);
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
 * Wraps an async function with standardized error handling
 */
export async function handleAsync<T>(
  operation: () => Promise<T>,
  options: {
    onError?: (error: Error) => void;
    showToast?: boolean;
    context?: string;
    rethrow?: boolean;
  } = {}
): Promise<T | null> {
  const {
    onError,
    showToast = true,
    context = 'Operation',
    rethrow = false
  } = options;

  try {
    return await operation();
  } catch (error) {
    const parsed = parseError(error);

    logError(context, parsed);

    if (showToast) {
      showError(parsed);
    }

    if (onError) {
      onError(parsed);
    }

    if (rethrow) {
      throw parsed;
    }

    return null;
  }
}

/**
 * Creates an API response handler with proper error handling
 */
export async function handleApiResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let details: string | undefined;
    try {
      const body = await response.text();
      // Try to parse JSON error response
      try {
        const json = JSON.parse(body);
        details = json.message || json.error || body;
      } catch {
        details = body;
      }
    } catch {
      // Ignore parsing errors
    }

    throw new ApiError(response.status, response.statusText, details);
  }

  // Handle empty responses
  const contentType = response.headers.get('content-type');
  if (!contentType || !contentType.includes('application/json')) {
    return {} as T;
  }

  return response.json();
}
