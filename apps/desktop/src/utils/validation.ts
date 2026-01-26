/**
 * Validation utilities for schema editor inputs.
 */

/** Maximum allowed repeat count (must match backend MAX_REPEAT_COUNT in lib.rs) */
export const MAX_REPEAT_COUNT = 10000;

/**
 * Sanitize variable name: strip %, allow only alphanumeric and underscore, limit length.
 * Used for both condition variables and repeat iteration variables.
 */
export const sanitizeVariableName = (value: string): string => {
  return value
    .trim()
    .replace(/%/g, "") // Strip % signs if user accidentally includes them
    .replace(/[^a-zA-Z0-9_]/g, "") // Only allow alphanumeric and underscore
    .slice(0, 50); // Max 50 characters
};

/**
 * Validate variable name for use as iteration variable.
 * Returns null if valid, or an error message string if invalid.
 *
 * Iteration variable names must start with a letter or underscore (not a digit).
 * This is stricter than condition variables which allow any alphanumeric start.
 *
 * Note: condition_var (for if blocks) intentionally does NOT apply this validation
 * because the backend accepts any variable format for conditions. Only repeat_as
 * (iteration variables) require the leading non-digit constraint.
 */
export const validateVariableName = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed) return null; // Empty uses default

  const firstChar = trimmed.charAt(0);
  if (/^[0-9]/.test(firstChar)) {
    return "Variable name cannot start with a digit";
  }
  return null;
};

/**
 * Validate repeat count value.
 * Returns null if valid, or an error message string if invalid.
 * Valid values: positive integers or variable references like %VAR%
 */
export const validateRepeatCount = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed) return null; // Empty uses default

  // Check if it's a variable reference (contains %...%)
  // Variable must start with letter or underscore, followed by alphanumeric/underscore
  if (/%[A-Za-z_][A-Za-z0-9_]*%/.test(trimmed)) {
    return null; // Variable references are validated at creation time
  }

  // Must be a positive integer
  const num = parseInt(trimmed, 10);
  if (isNaN(num) || !Number.isInteger(num) || num.toString() !== trimmed) {
    return "Must be a positive integer or variable reference";
  }
  if (num < 0) {
    return "Count cannot be negative";
  }
  if (num > MAX_REPEAT_COUNT) {
    return `Count cannot exceed ${MAX_REPEAT_COUNT}`;
  }
  return null;
};
