/**
 * Validation utilities for schema editor inputs.
 *
 * Variable-name sanitization/validation lives in the shared variable-name
 * module (`@structure-creator/shared`, ADR-0001) — import from there.
 */

import { containsVariableToken, MAX_REPEAT_COUNT } from "@structure-creator/shared";

export { MAX_REPEAT_COUNT };

/**
 * Validate repeat count value.
 * Returns null if valid, or an error message string if invalid.
 * Valid values: positive integers or variable references like %VAR%
 */
export const validateRepeatCount = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed) return null; // Empty uses default

  // Variable references are validated at creation time
  if (containsVariableToken(trimmed)) {
    return null;
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
