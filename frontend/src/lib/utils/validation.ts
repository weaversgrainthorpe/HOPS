// Form validation utilities

export interface ValidationResult {
  valid: boolean;
  message?: string;
}

/**
 * Validates a password
 */
export function validatePassword(password: string, options: {
  minLength?: number;
  requireUppercase?: boolean;
  requireLowercase?: boolean;
  requireNumber?: boolean;
  requireSpecial?: boolean;
} = {}): ValidationResult {
  const {
    minLength = 8,
    requireUppercase = false,
    requireLowercase = false,
    requireNumber = false,
    requireSpecial = false
  } = options;

  if (!password) {
    return { valid: false, message: 'Password is required' };
  }

  if (password.length < minLength) {
    return { valid: false, message: `Password must be at least ${minLength} characters` };
  }

  if (requireUppercase && !/[A-Z]/.test(password)) {
    return { valid: false, message: 'Password must contain an uppercase letter' };
  }

  if (requireLowercase && !/[a-z]/.test(password)) {
    return { valid: false, message: 'Password must contain a lowercase letter' };
  }

  if (requireNumber && !/\d/.test(password)) {
    return { valid: false, message: 'Password must contain a number' };
  }

  if (requireSpecial && !/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
    return { valid: false, message: 'Password must contain a special character' };
  }

  return { valid: true };
}

/**
 * Validates that two values match (e.g., password confirmation)
 */
export function validateMatch(value: string, matchValue: string, fieldName = 'values'): ValidationResult {
  if (value !== matchValue) {
    return { valid: false, message: `The ${fieldName} do not match` };
  }
  return { valid: true };
}
