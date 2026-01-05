// Form validation utilities

export interface ValidationResult {
  valid: boolean;
  message?: string;
}

export interface FieldValidation {
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  pattern?: RegExp;
  custom?: (value: string) => ValidationResult;
}

/**
 * Validates a string value against validation rules
 */
export function validateField(value: string, rules: FieldValidation): ValidationResult {
  const trimmed = value?.trim() || '';

  if (rules.required && !trimmed) {
    return { valid: false, message: 'This field is required' };
  }

  if (rules.minLength && trimmed.length < rules.minLength) {
    return { valid: false, message: `Must be at least ${rules.minLength} characters` };
  }

  if (rules.maxLength && trimmed.length > rules.maxLength) {
    return { valid: false, message: `Must be no more than ${rules.maxLength} characters` };
  }

  if (rules.pattern && !rules.pattern.test(trimmed)) {
    return { valid: false, message: 'Invalid format' };
  }

  if (rules.custom) {
    return rules.custom(trimmed);
  }

  return { valid: true };
}

/**
 * Validates a URL string
 */
export function validateUrl(url: string, required = true): ValidationResult {
  const trimmed = url?.trim() || '';

  if (!trimmed) {
    return required
      ? { valid: false, message: 'URL is required' }
      : { valid: true };
  }

  // Allow relative URLs
  if (trimmed.startsWith('/')) {
    return { valid: true };
  }

  // Check for valid URL format
  try {
    // If no protocol, try with https
    const urlToTest = /^[a-z][a-z0-9+.-]*:/i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;
    new URL(urlToTest);
    return { valid: true };
  } catch {
    return { valid: false, message: 'Please enter a valid URL' };
  }
}

/**
 * Validates an email address
 */
export function validateEmail(email: string, required = true): ValidationResult {
  const trimmed = email?.trim() || '';

  if (!trimmed) {
    return required
      ? { valid: false, message: 'Email is required' }
      : { valid: true };
  }

  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(trimmed)) {
    return { valid: false, message: 'Please enter a valid email address' };
  }

  return { valid: true };
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

/**
 * Validates a name/title field
 */
export function validateName(name: string, fieldLabel = 'Name'): ValidationResult {
  return validateField(name, {
    required: true,
    minLength: 1,
    maxLength: 100,
    custom: (val) => {
      // Check for invalid characters
      if (/[<>]/.test(val)) {
        return { valid: false, message: `${fieldLabel} contains invalid characters` };
      }
      return { valid: true };
    }
  });
}

/**
 * Creates a validation state object for form fields
 */
export function createValidationState<T extends Record<string, string>>(
  initialValues: T
): {
  values: T;
  errors: Record<keyof T, string>;
  touched: Record<keyof T, boolean>;
  isValid: boolean;
} {
  const errors = {} as Record<keyof T, string>;
  const touched = {} as Record<keyof T, boolean>;

  for (const key of Object.keys(initialValues) as (keyof T)[]) {
    errors[key] = '';
    touched[key] = false;
  }

  return {
    values: { ...initialValues },
    errors,
    touched,
    isValid: true
  };
}

/**
 * Validates icon name format (Iconify format)
 */
export function validateIconName(icon: string): ValidationResult {
  if (!icon) {
    return { valid: true }; // Icons are optional
  }

  // Iconify format: prefix:name or prefix:name-variant
  const iconPattern = /^[a-z0-9-]+:[a-z0-9-]+$/i;
  if (!iconPattern.test(icon)) {
    return { valid: false, message: 'Icon should be in format: prefix:name (e.g., mdi:home)' };
  }

  return { valid: true };
}

/**
 * Validates a color value (hex format)
 */
export function validateColor(color: string): ValidationResult {
  if (!color) {
    return { valid: true }; // Colors are optional
  }

  const hexPattern = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;
  if (!hexPattern.test(color)) {
    return { valid: false, message: 'Color must be a valid hex code (e.g., #ff0000)' };
  }

  return { valid: true };
}
