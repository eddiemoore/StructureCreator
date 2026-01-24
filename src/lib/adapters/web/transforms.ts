/**
 * Variable transformation and substitution for web mode.
 * Port of the Rust transforms.rs functionality.
 */

import type { ValidationError, ValidationRule } from "../../../types/schema";

// ============================================================================
// Case Transformations
// ============================================================================

/**
 * Convert string to UPPERCASE.
 */
const toUppercase = (s: string): string => s.toUpperCase();

/**
 * Convert string to lowercase.
 */
const toLowercase = (s: string): string => s.toLowerCase();

/**
 * Convert string to camelCase.
 */
const toCamelCase = (s: string): string => {
  const words = s.split(/[\s_-]+/);
  return words
    .map((word, index) => {
      if (index === 0) {
        return word.toLowerCase();
      }
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join("");
};

/**
 * Convert string to PascalCase.
 */
const toPascalCase = (s: string): string => {
  const words = s.split(/[\s_-]+/);
  return words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join("");
};

/**
 * Convert string to kebab-case.
 */
const toKebabCase = (s: string): string => {
  // Handle PascalCase and camelCase
  const withSpaces = s.replace(/([a-z])([A-Z])/g, "$1 $2");
  const words = withSpaces.split(/[\s_-]+/);
  return words.map((word) => word.toLowerCase()).join("-");
};

/**
 * Convert string to snake_case.
 */
const toSnakeCase = (s: string): string => {
  // Handle PascalCase and camelCase
  const withSpaces = s.replace(/([a-z])([A-Z])/g, "$1 $2");
  const words = withSpaces.split(/[\s_-]+/);
  return words.map((word) => word.toLowerCase()).join("_");
};

/**
 * Simple pluralization (basic English rules).
 */
const toPlural = (s: string): string => {
  if (s.length === 0) return s;

  const lower = s.toLowerCase();

  // Words ending in 's', 'x', 'z', 'ch', 'sh' add 'es'
  if (
    lower.endsWith("s") ||
    lower.endsWith("x") ||
    lower.endsWith("z") ||
    lower.endsWith("ch") ||
    lower.endsWith("sh")
  ) {
    return s + "es";
  }

  // Words ending in consonant + 'y' change to 'ies'
  if (lower.endsWith("y") && s.length > 1) {
    const beforeY = lower.charAt(lower.length - 2);
    if (!"aeiou".includes(beforeY)) {
      return s.slice(0, -1) + "ies";
    }
  }

  // Default: add 's'
  return s + "s";
};

/**
 * Get string length.
 */
const getLength = (s: string): string => s.length.toString();

// ============================================================================
// Date Formatting
// ============================================================================

const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/**
 * Format a date string using the specified format.
 * Supports: YYYY, YY, MMMM, MMM, MM, DD, D
 */
const formatDate = (dateStr: string, format: string): string => {
  // Try to parse the date
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) {
    return dateStr; // Return original if invalid
  }

  const year = date.getFullYear();
  const month = date.getMonth(); // 0-indexed
  const day = date.getDate();

  let result = format;

  // Replace tokens (order matters - longer tokens first)
  result = result.replace("YYYY", year.toString());
  result = result.replace("YY", (year % 100).toString().padStart(2, "0"));
  result = result.replace("MMMM", MONTHS_LONG[month]);
  result = result.replace("MMM", MONTHS_SHORT[month]);
  result = result.replace("MM", (month + 1).toString().padStart(2, "0"));
  result = result.replace("DD", day.toString().padStart(2, "0"));
  result = result.replace("D", day.toString());

  return result;
};

// ============================================================================
// Transform Application
// ============================================================================

/**
 * Parse and apply a transformation to a value.
 * Transformations are in the format: value|transform or value|transform(arg)
 */
const applyTransform = (value: string, transform: string): string => {
  // Check for format transform with argument
  const formatMatch = transform.match(/^format\((.+)\)$/);
  if (formatMatch) {
    return formatDate(value, formatMatch[1]);
  }

  // Simple transforms
  switch (transform.toLowerCase()) {
    case "uppercase":
      return toUppercase(value);
    case "lowercase":
      return toLowercase(value);
    case "camelcase":
      return toCamelCase(value);
    case "pascalcase":
      return toPascalCase(value);
    case "kebab-case":
      return toKebabCase(value);
    case "snake_case":
      return toSnakeCase(value);
    case "plural":
      return toPlural(value);
    case "length":
      return getLength(value);
    default:
      // Unknown transform, return original value
      return value;
  }
};

// ============================================================================
// Variable Substitution
// ============================================================================

/**
 * Regex to match variables: %NAME% or %NAME|transform%
 */
const VARIABLE_REGEX = /%([A-Z_][A-Z0-9_]*)(?::([^%]+))?%/gi;

/**
 * Substitute variables in a string.
 */
export const substituteVariables = (
  text: string,
  variables: Record<string, string>
): string => {
  return text.replace(VARIABLE_REGEX, (match, name, transform) => {
    // Build the variable key with % delimiters for lookup
    const key = `%${name.toUpperCase()}%`;
    const value = variables[key];

    if (value === undefined) {
      // Variable not found, keep original
      return match;
    }

    if (transform) {
      // Apply transform(s) - can be chained with |
      const transforms = transform.split("|");
      let result = value;
      for (const t of transforms) {
        result = applyTransform(result, t.trim());
      }
      return result;
    }

    return value;
  });
};

// ============================================================================
// Validation
// ============================================================================

/**
 * Validate variables against their rules.
 */
export const validateVariables = (
  variables: Record<string, string>,
  rules: Record<string, ValidationRule>
): ValidationError[] => {
  const errors: ValidationError[] = [];

  for (const [varName, rule] of Object.entries(rules)) {
    // Get the value - try both with and without % delimiters
    let value = variables[varName];
    if (value === undefined) {
      value = variables[`%${varName}%`] ?? "";
    }

    // Clean name for error reporting (without % delimiters)
    const cleanName = varName.replace(/^%|%$/g, "");

    // Check required
    if (rule.required && (!value || value.trim() === "")) {
      errors.push({
        variable_name: cleanName,
        message: `${cleanName} is required`,
      });
      continue; // Skip other validations if required check fails
    }

    // Skip other validations for empty non-required fields
    if (!value || value.trim() === "") {
      continue;
    }

    // Check minLength
    if (rule.minLength !== undefined && value.length < rule.minLength) {
      errors.push({
        variable_name: cleanName,
        message: `${cleanName} must be at least ${rule.minLength} characters`,
      });
    }

    // Check maxLength
    if (rule.maxLength !== undefined && value.length > rule.maxLength) {
      errors.push({
        variable_name: cleanName,
        message: `${cleanName} must be at most ${rule.maxLength} characters`,
      });
    }

    // Check pattern
    if (rule.pattern) {
      try {
        const regex = new RegExp(rule.pattern);
        if (!regex.test(value)) {
          errors.push({
            variable_name: cleanName,
            message: `${cleanName} does not match pattern: ${rule.pattern}`,
          });
        }
      } catch (e) {
        errors.push({
          variable_name: cleanName,
          message: `Invalid regex pattern for ${cleanName}: ${rule.pattern}`,
        });
      }
    }
  }

  return errors;
};
