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
 *
 * Uses a single-pass regex replacement to avoid edge cases where
 * shorter tokens could match within already-replaced longer tokens.
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

  // Token values - order in regex matters (longer tokens first)
  const tokens: Record<string, string> = {
    "YYYY": year.toString(),
    "MMMM": MONTHS_LONG[month],
    "MMM": MONTHS_SHORT[month],
    "MM": (month + 1).toString().padStart(2, "0"),
    "DD": day.toString().padStart(2, "0"),
    "YY": (year % 100).toString().padStart(2, "0"),
    "D": day.toString(),
  };

  // Single-pass replacement using regex with alternation
  // Order: longest tokens first to ensure greedy matching works correctly
  const tokenPattern = /YYYY|MMMM|MMM|MM|DD|YY|D/g;

  return format.replace(tokenPattern, (match) => tokens[match] ?? match);
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
 * Regex to match variables: %NAME% or %NAME:transform% or %NAME:transform|transform2%
 * - Variable names must start with a letter or underscore
 * - Transforms are separated from the name by `:` and can be chained with `|`
 */
const VARIABLE_REGEX = /%([A-Z_][A-Z0-9_]*)(?::([^%]+))?%/gi;

/**
 * Built-in variables that should not be extracted as user-defined variables.
 * NOTE: Keep in sync with BUILTIN_VARIABLES in apps/desktop/src-tauri/src/transforms.rs
 */
const BUILTIN_VARIABLES = new Set([
  "%DATE%",
  "%YEAR%",
  "%MONTH%",
  "%DAY%",
  "%PROJECT_NAME%",
]);

/**
 * Check if a variable name is all uppercase (letters, digits, underscores).
 * This distinguishes user-defined variables (%PROJECT_NAME%) from repeat loop variables (%i%, %item%).
 */
const isUppercaseVariable = (name: string): boolean => {
  return /^[A-Z_][A-Z0-9_]*$/.test(name);
};

/**
 * Regex for condition variables in if/else blocks: var="VARNAME" or var='VARNAME'
 */
const CONDITION_VAR_REGEX = /<(?:if|else)\s+var\s*=\s*["']([A-Za-z_][A-Za-z0-9_]*)["']/gi;

/**
 * Extract unique user-defined variable names from content.
 * Returns variable names like "%NAME%", "%VERSION%", excluding built-in variables.
 *
 * Detects variables from:
 * - %VAR% patterns in names, content, URLs
 * - <if var="VAR"> and <else var="VAR"> condition attributes
 *
 * Only UPPERCASE variables are detected - lowercase variables (like %i% or %item% in repeat blocks)
 * are ignored as they are typically loop variables, not user-defined.
 */
export const extractVariablesFromContent = (content: string): string[] => {
  // Reset regex lastIndex to ensure we match from the beginning
  VARIABLE_REGEX.lastIndex = 0;
  CONDITION_VAR_REGEX.lastIndex = 0;
  const seen = new Set<string>();
  const variables: string[] = [];

  // Extract %VAR% pattern variables
  let match;
  while ((match = VARIABLE_REGEX.exec(content)) !== null) {
    const varName = match[1]; // Original case from the match

    // Only include UPPERCASE variables (not loop variables like %i% or %item%)
    if (!isUppercaseVariable(varName)) {
      continue;
    }

    const baseName = `%${varName}%`;
    if (!BUILTIN_VARIABLES.has(baseName) && !seen.has(baseName)) {
      seen.add(baseName);
      variables.push(baseName);
    }
  }

  // Extract condition variables from <if var="..."> and <else var="...">
  while ((match = CONDITION_VAR_REGEX.exec(content)) !== null) {
    const varName = match[1];

    // Only include uppercase condition variables
    if (!isUppercaseVariable(varName)) {
      continue;
    }

    const baseName = `%${varName}%`;
    if (!BUILTIN_VARIABLES.has(baseName) && !seen.has(baseName)) {
      seen.add(baseName);
      variables.push(baseName);
    }
  }

  return variables;
};

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
 * Maximum length for values being validated against regex patterns.
 * Prevents ReDoS attacks by limiting input size.
 */
const MAX_REGEX_INPUT_LENGTH = 1000;

/**
 * Maximum length for regex patterns from imported templates.
 * Excessively long patterns are more likely to be malicious.
 */
const MAX_REGEX_PATTERN_LENGTH = 500;

/**
 * Detect potentially dangerous regex patterns that could cause ReDoS.
 * Looks for nested quantifiers and other problematic constructs.
 */
const isPotentiallyDangerousRegex = (pattern: string): boolean => {
  // Reject excessively long patterns
  if (pattern.length > MAX_REGEX_PATTERN_LENGTH) {
    return true;
  }

  // Detect nested quantifiers: (a+)+, (a*)+, (a+)*, (a?)+, etc.
  // These are the most common cause of catastrophic backtracking
  if (/\([^)]*[+*][^)]*\)[+*]/.test(pattern)) {
    return true;
  }

  // Detect overlapping alternations with quantifiers: (a|a)+, (a|ab)+
  // Simplified check: alternation inside a quantified group
  if (/\([^)]*\|[^)]*\)[+*]/.test(pattern)) {
    return true;
  }

  // Detect repeated capturing groups with backreferences
  if (/\([^)]+\)[+*].*\\1/.test(pattern)) {
    return true;
  }

  return false;
};

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
      // Check for potentially dangerous regex patterns (ReDoS prevention)
      if (isPotentiallyDangerousRegex(rule.pattern)) {
        errors.push({
          variable_name: cleanName,
          message: `Validation pattern for ${cleanName} was rejected for security reasons`,
        });
        continue;
      }

      try {
        const regex = new RegExp(rule.pattern);
        // Limit input length for regex testing to prevent ReDoS
        const testValue = value.length > MAX_REGEX_INPUT_LENGTH
          ? value.slice(0, MAX_REGEX_INPUT_LENGTH)
          : value;
        if (!regex.test(testValue)) {
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
