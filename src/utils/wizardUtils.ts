/**
 * Wizard utility functions for validation, tree filtering, and type-safe parsing.
 *
 * @module wizardUtils
 */

import type {
  WizardConfig,
  WizardStep,
  WizardQuestion,
  WizardAnswers,
  WizardSchemaModifier,
  WizardChoice,
  SchemaNode,
  SchemaTree,
  ValidationRule,
} from "../types/schema";

// ============================================================================
// Constants
// ============================================================================

/** Valid wizard question types */
export const WIZARD_QUESTION_TYPES = ["boolean", "single", "multiple", "text", "select"] as const;

/** Valid schema modifier actions */
export const SCHEMA_MODIFIER_ACTIONS = ["include", "exclude", "set_variable"] as const;

/** Indentation size in pixels for tree nodes */
export const TREE_INDENT_SIZE = 16;

/** Base padding in pixels for tree nodes */
export const TREE_BASE_PADDING = 8;

/** Debounce delay for preview updates in milliseconds */
export const PREVIEW_DEBOUNCE_MS = 150;

/** Icon size in pixels for preview tree nodes */
export const PREVIEW_ICON_SIZE = 14;

/** Chevron size in pixels for expand/collapse buttons */
export const PREVIEW_CHEVRON_SIZE = 12;

/** Maximum number of steps allowed in a wizard config */
export const MAX_WIZARD_STEPS = 20;

/** Maximum number of questions per step */
export const MAX_QUESTIONS_PER_STEP = 50;

/** Maximum number of schema modifiers */
export const MAX_SCHEMA_MODIFIERS = 100;

/** Maximum number of choices per question */
export const MAX_CHOICES_PER_QUESTION = 50;

// ============================================================================
// Validation Messages (for i18n support)
// ============================================================================

export const VALIDATION_MESSAGES = {
  required: "This field is required",
  minLength: (min: number) => `Must be at least ${min} characters`,
  maxLength: (max: number) => `Must be at most ${max} characters`,
  invalidFormat: "Invalid format",
  selectOption: "Please select an option",
  selectAtLeastOne: "Please select at least one option",
} as const;

/** UI strings for wizard components (for i18n support) */
export const WIZARD_UI_STRINGS = {
  selectPlaceholder: "Select an option...",
  yes: "Yes",
  no: "No",
  back: "Back",
  next: "Next",
  create: "Create",
  close: "Close",
  previewTitle: "Preview",
  previewLoading: "Generating preview...",
  previewEmpty: "Preview will appear here",
  stepOf: (current: number, total: number) => `Step ${current} of ${total}`,
  completeRequiredFields: "Please complete all required fields",
  collapse: "Collapse",
  expand: "Expand",
} as const;

// ============================================================================
// Type Guards and Validators
// ============================================================================

/**
 * Type guard to check if a value is a valid WizardQuestionType.
 * @param type - The value to check
 * @returns True if the value is a valid question type
 */
export const isValidQuestionType = (type: unknown): type is WizardQuestion["type"] => {
  return typeof type === "string" && WIZARD_QUESTION_TYPES.includes(type as typeof WIZARD_QUESTION_TYPES[number]);
};

/**
 * Type guard to check if a value is a valid schema modifier action.
 * @param action - The value to check
 * @returns True if the value is a valid action
 */
const isValidModifierAction = (action: unknown): action is WizardSchemaModifier["action"] => {
  return typeof action === "string" && SCHEMA_MODIFIER_ACTIONS.includes(action as typeof SCHEMA_MODIFIER_ACTIONS[number]);
};

/**
 * Validates that an object has the required string property.
 * @param obj - The object to check
 * @param key - The property key
 * @returns True if the property exists and is a non-empty string
 */
const hasRequiredString = (obj: Record<string, unknown>, key: string): boolean => {
  return typeof obj[key] === "string" && obj[key] !== "";
};

/** Maximum string length to sanitize (prevents slow regex on huge strings) */
const MAX_SANITIZE_LENGTH = 100000;

/**
 * Sanitizes a string value for safe display and use.
 * Removes potentially dangerous content while preserving valid characters.
 *
 * Note: React auto-escapes content by default, so this is defense-in-depth
 * for cases where data might be used outside React's escaping context.
 *
 * @param value - The string to sanitize
 * @returns The sanitized string
 */
export const sanitizeString = (value: string): string => {
  // Truncate extremely long strings to prevent slow regex processing
  const truncated = value.length > MAX_SANITIZE_LENGTH
    ? value.slice(0, MAX_SANITIZE_LENGTH)
    : value;

  return truncated
    // Remove dangerous tags entirely (non-greedy, avoids ReDoS)
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, "")
    .replace(/<iframe[^>]*\/>/gi, "")
    .replace(/<object[^>]*>[\s\S]*?<\/object>/gi, "")
    .replace(/<embed[^>]*>/gi, "")
    // Remove event handlers (onclick, onerror, onload, etc.)
    .replace(/\bon\w+\s*=/gi, "data-removed=")
    // Remove dangerous protocols
    .replace(/javascript:/gi, "removed:")
    .replace(/vbscript:/gi, "removed:")
    .replace(/data:\s*text\/html/gi, "removed:")
    // Neutralize SVG event handlers but keep the tag
    .replace(/<svg([^>]*)on\w+=/gi, "<svg$1data-removed=")
    .trim();
};

/**
 * Sanitizes user input for variable substitution.
 * Only allows safe characters for file/folder names.
 *
 * Note: This is exported for use by consumer code (e.g., custom wizard implementations).
 * The built-in wizard relies on backend sanitization during structure creation.
 *
 * @param value - The input value
 * @returns The sanitized value
 */
export const sanitizeVariableInput = (value: string): string => {
  // Allow alphanumeric, hyphens, underscores, dots, and spaces
  return value.replace(/[^\w\s.-]/g, "").trim();
};

// ============================================================================
// Type-safe Wizard Config Parsing
// ============================================================================

/**
 * Validates and parses a wizard choice from JSON.
 * @param data - The raw choice data
 * @returns A valid WizardChoice or null if invalid
 */
const parseWizardChoice = (data: unknown): WizardChoice | null => {
  if (!data || typeof data !== "object") return null;

  const c = data as Record<string, unknown>;

  if (!hasRequiredString(c, "id") || !hasRequiredString(c, "label")) return null;

  return {
    id: c.id as string,
    label: sanitizeString(c.label as string),
    description: typeof c.description === "string" ? sanitizeString(c.description) : undefined,
  };
};

/**
 * Validates and parses a wizard question from JSON.
 * @param data - The raw question data
 * @returns A valid WizardQuestion or null if invalid
 */
const parseWizardQuestion = (data: unknown): WizardQuestion | null => {
  if (!data || typeof data !== "object") return null;

  const q = data as Record<string, unknown>;

  if (!hasRequiredString(q, "id")) return null;
  if (!isValidQuestionType(q.type)) return null;
  if (typeof q.question !== "string") return null;

  // Parse and validate choices if present (with size limit)
  let choices: WizardChoice[] | undefined;
  if (Array.isArray(q.choices)) {
    const parsedChoices = q.choices
      .slice(0, MAX_CHOICES_PER_QUESTION) // Limit choices to prevent DoS
      .map(parseWizardChoice)
      .filter((c): c is WizardChoice => c !== null);
    choices = parsedChoices.length > 0 ? parsedChoices : undefined;
  }

  // Validate showWhen structure if present
  let showWhen: WizardQuestion["showWhen"] | undefined;
  if (q.showWhen && typeof q.showWhen === "object") {
    const sw = q.showWhen as Record<string, unknown>;
    if (typeof sw.questionId === "string" && sw.value !== undefined) {
      // Validate that value is a valid type (string, boolean, or string array)
      const isValidValue =
        typeof sw.value === "string" ||
        typeof sw.value === "boolean" ||
        (Array.isArray(sw.value) && sw.value.every((v): v is string => typeof v === "string"));

      if (isValidValue) {
        showWhen = {
          questionId: sw.questionId,
          value: sw.value as string | boolean | string[],
        };
      }
    }
  }

  // Validate validation rules if present
  let validation: ValidationRule | undefined;
  if (q.validation && typeof q.validation === "object") {
    const v = q.validation as Record<string, unknown>;
    validation = {
      required: typeof v.required === "boolean" ? v.required : undefined,
      minLength: typeof v.minLength === "number" ? v.minLength : undefined,
      maxLength: typeof v.maxLength === "number" ? v.maxLength : undefined,
      pattern: typeof v.pattern === "string" ? v.pattern : undefined,
    };
  }

  // Validate defaultValue type based on question type
  let defaultValue: string | boolean | string[] | undefined;
  if (q.defaultValue !== undefined) {
    if (q.type === "boolean" && typeof q.defaultValue === "boolean") {
      defaultValue = q.defaultValue;
    } else if (q.type === "multiple" && Array.isArray(q.defaultValue)) {
      defaultValue = q.defaultValue.filter((v): v is string => typeof v === "string");
    } else if ((q.type === "text" || q.type === "single" || q.type === "select") && typeof q.defaultValue === "string") {
      defaultValue = q.defaultValue;
    } else {
      // Log warning for type mismatch to help template authors debug
      console.warn(
        `Wizard question "${q.id}": defaultValue type "${typeof q.defaultValue}" ` +
        `doesn't match question type "${q.type}", ignoring defaultValue`
      );
    }
  }

  // Validate that choice-based questions have choices
  const requiresChoices = q.type === "single" || q.type === "multiple" || q.type === "select";
  if (requiresChoices && (!choices || choices.length === 0)) {
    return null; // Invalid question - missing required choices
  }

  return {
    id: q.id as string,
    type: q.type,
    question: sanitizeString(q.question),
    helpText: typeof q.helpText === "string" ? sanitizeString(q.helpText) : undefined,
    choices,
    defaultValue,
    placeholder: typeof q.placeholder === "string" ? sanitizeString(q.placeholder) : undefined,
    validation,
    showWhen,
  };
};

/**
 * Validates and parses a wizard step from JSON.
 * @param data - The raw step data
 * @returns A valid WizardStep or null if invalid
 */
const parseWizardStep = (data: unknown): WizardStep | null => {
  if (!data || typeof data !== "object") return null;

  const s = data as Record<string, unknown>;

  if (!hasRequiredString(s, "id")) return null;
  if (!hasRequiredString(s, "title")) return null;
  if (!Array.isArray(s.questions)) return null;

  const questions = s.questions
    .slice(0, MAX_QUESTIONS_PER_STEP) // Limit questions per step to prevent DoS
    .map(parseWizardQuestion)
    .filter((q): q is WizardQuestion => q !== null);

  if (questions.length === 0) return null;

  return {
    id: s.id as string,
    title: sanitizeString(s.title as string),
    description: typeof s.description === "string" ? sanitizeString(s.description) : undefined,
    questions,
  };
};

/**
 * Validates and parses a schema modifier from JSON.
 * @param data - The raw modifier data
 * @returns A valid WizardSchemaModifier or null if invalid
 */
const parseSchemaModifier = (data: unknown): WizardSchemaModifier | null => {
  if (!data || typeof data !== "object") return null;

  const m = data as Record<string, unknown>;

  if (!hasRequiredString(m, "questionId")) return null;
  if (!isValidModifierAction(m.action)) return null;

  // Validate valueMap if present
  let valueMap: Record<string, string> | undefined;
  if (m.valueMap && typeof m.valueMap === "object" && !Array.isArray(m.valueMap)) {
    const vm = m.valueMap as Record<string, unknown>;
    const validated: Record<string, string> = {};
    let hasValidEntries = false;
    for (const [key, val] of Object.entries(vm)) {
      if (typeof val === "string") {
        validated[key] = val;
        hasValidEntries = true;
      }
    }
    valueMap = hasValidEntries ? validated : undefined;
  }

  const modifier: WizardSchemaModifier = {
    questionId: m.questionId as string,
    action: m.action,
    nodeConditionVar: typeof m.nodeConditionVar === "string" ? m.nodeConditionVar : undefined,
    variableName: typeof m.variableName === "string" ? m.variableName : undefined,
    valueMap,
  };

  // Warn about modifiers that won't have any effect
  if ((modifier.action === "include" || modifier.action === "exclude") && !modifier.nodeConditionVar) {
    console.warn(
      `Schema modifier for question "${modifier.questionId}": ` +
      `action "${modifier.action}" requires nodeConditionVar to have any effect`
    );
  }
  if (modifier.action === "set_variable" && !modifier.variableName) {
    console.warn(
      `Schema modifier for question "${modifier.questionId}": ` +
      `action "set_variable" requires variableName to have any effect`
    );
  }

  return modifier;
};

/**
 * Safely parses and validates wizard_config JSON into a WizardConfig.
 * Returns null if the config is invalid or malformed.
 *
 * @param config - The raw config object (usually from JSON)
 * @returns A validated WizardConfig or null if invalid
 *
 * @example
 * ```typescript
 * const config = parseWizardConfig(template.wizard_config);
 * if (config) {
 *   // Safe to use config
 * }
 * ```
 */
export const parseWizardConfig = (config: unknown): WizardConfig | null => {
  if (!config || typeof config !== "object") return null;

  const c = config as Record<string, unknown>;

  // Validate required fields
  if (!hasRequiredString(c, "title")) return null;
  if (!Array.isArray(c.steps) || c.steps.length === 0) return null;
  if (!Array.isArray(c.schemaModifiers)) return null;

  // Parse steps (with size limit to prevent DoS)
  const steps = c.steps
    .slice(0, MAX_WIZARD_STEPS)
    .map(parseWizardStep)
    .filter((s): s is WizardStep => s !== null);

  if (steps.length === 0) return null;

  // Validate unique step IDs
  const stepIds = new Set<string>();
  for (const step of steps) {
    if (stepIds.has(step.id)) {
      console.warn(`Duplicate step ID "${step.id}" found in wizard config, this may cause unexpected behavior`);
    }
    stepIds.add(step.id);
  }

  // Validate unique question IDs across all steps
  const questionIds = new Set<string>();
  for (const step of steps) {
    for (const question of step.questions) {
      if (questionIds.has(question.id)) {
        console.warn(`Duplicate question ID "${question.id}" found in wizard config, this may cause answers to be shared`);
      }
      questionIds.add(question.id);
    }
  }

  // Parse modifiers (with size limit)
  const schemaModifiers = c.schemaModifiers
    .slice(0, MAX_SCHEMA_MODIFIERS)
    .map(parseSchemaModifier)
    .filter((m): m is WizardSchemaModifier => m !== null);

  return {
    title: sanitizeString(c.title as string),
    description: typeof c.description === "string" ? sanitizeString(c.description) : undefined,
    steps,
    schemaModifiers,
  };
};

// ============================================================================
// Wizard Answer Application
// ============================================================================

/**
 * Normalizes a variable name to include % delimiters.
 * @param name - The variable name (with or without %)
 * @returns The normalized name with % delimiters
 */
const normalizeVariableName = (name: string): string => {
  if (name.startsWith("%") && name.endsWith("%")) return name;
  return `%${name}%`;
};

/**
 * Apply wizard answers to generate condition variables and template variables.
 * Returns a map of variable names (with % delimiters) to their values.
 *
 * @param config - The wizard configuration
 * @param answers - The user's answers
 * @param existingVariables - Variables to merge with (lower priority)
 * @returns A record of variable names to values
 *
 * @example
 * ```typescript
 * const variables = applyWizardModifiers(config, answers, template.variables);
 * ```
 */
export const applyWizardModifiers = (
  config: WizardConfig,
  answers: WizardAnswers,
  existingVariables: Record<string, string>
): Record<string, string> => {
  const result = { ...existingVariables };

  for (const modifier of config.schemaModifiers) {
    const answer = answers[modifier.questionId];

    switch (modifier.action) {
      case "include":
      case "exclude": {
        if (modifier.nodeConditionVar) {
          const varName = normalizeVariableName(modifier.nodeConditionVar);

          if (modifier.valueMap && typeof answer === "string") {
            const mappedValue = modifier.valueMap[answer];
            result[varName] = mappedValue === "true" ? "true" : "";
          } else {
            const isTruthy = Array.isArray(answer)
              ? answer.length > 0
              : Boolean(answer);
            const shouldInclude = modifier.action === "include" ? isTruthy : !isTruthy;
            result[varName] = shouldInclude ? "true" : "";
          }
        }
        break;
      }
      case "set_variable": {
        if (modifier.variableName) {
          const varName = normalizeVariableName(modifier.variableName);
          let value = "";

          if (modifier.valueMap && typeof answer === "string") {
            value = modifier.valueMap[answer] ?? answer;
          } else if (typeof answer === "string") {
            value = answer;
          } else if (typeof answer === "boolean") {
            value = answer ? "true" : "false";
          } else if (Array.isArray(answer)) {
            value = answer.join(",");
          }

          result[varName] = value;
        }
        break;
      }
    }
  }

  return result;
};

// ============================================================================
// Tree Filtering
// ============================================================================

/**
 * Check if a condition is met based on condition variables.
 * Handles the <if var="CONDITION"> pattern.
 *
 * @param conditionVar - The condition variable name (without % delimiters)
 * @param conditionVariables - Map of variable names to values
 * @returns True if the condition is met
 */
const isConditionMet = (
  conditionVar: string | undefined,
  conditionVariables: Record<string, string>
): boolean => {
  if (!conditionVar) return true;

  const normalizedName = normalizeVariableName(conditionVar);
  const value = conditionVariables[normalizedName];
  return value === "true";
};

/** Maximum tree depth to prevent excessive processing (practical schemas rarely exceed 50 levels) */
const MAX_TREE_DEPTH = 100;

/**
 * Filter a schema tree based on condition variables using iterative approach.
 * Removes nodes where <if var="..."> conditions are not met.
 * Uses post-order traversal to build filtered tree bottom-up.
 *
 * @param node - The node to filter
 * @param conditionVariables - Map of condition variable names to values
 * @returns The filtered node or null if it should be excluded
 */
const filterNode = (
  node: SchemaNode,
  conditionVariables: Record<string, string>
): SchemaNode | null => {
  // Map to store filtered results for each node
  const filteredResults = new Map<SchemaNode, SchemaNode | null>();

  // Stack entries: [node, visited, depth]
  // visited=false: first visit, push children
  // visited=true: children processed, compute result
  const stack: Array<[SchemaNode, boolean, number]> = [[node, false, 0]];

  while (stack.length > 0) {
    const [current, visited, depth] = stack.pop()!;

    // Depth protection
    if (depth > MAX_TREE_DEPTH) {
      console.warn(`Tree depth exceeds ${MAX_TREE_DEPTH}, truncating`);
      filteredResults.set(current, null);
      continue;
    }

    if (!visited) {
      // First visit - mark as visited and push children
      stack.push([current, true, depth]);

      // Push children in reverse order for correct processing order
      const children = current.children ?? [];
      for (let i = children.length - 1; i >= 0; i--) {
        stack.push([children[i], false, depth + 1]);
      }
    } else {
      // Second visit - all children have been processed, compute result
      const result = computeFilteredNode(current, conditionVariables, filteredResults);
      filteredResults.set(current, result);
    }
  }

  return filteredResults.get(node) ?? null;
};

/**
 * Compute the filtered result for a single node after its children have been processed.
 */
const computeFilteredNode = (
  node: SchemaNode,
  conditionVariables: Record<string, string>,
  filteredResults: Map<SchemaNode, SchemaNode | null>
): SchemaNode | null => {
  // Handle conditional nodes (if/else)
  if (node.type === "if") {
    const conditionMet = isConditionMet(node.condition_var, conditionVariables);

    if (conditionMet) {
      const filteredChildren = (node.children ?? [])
        .map(child => filteredResults.get(child) ?? null)
        .filter((child): child is SchemaNode => child !== null);

      if (filteredChildren.length === 0) return null;
      if (filteredChildren.length === 1) return filteredChildren[0];

      return { ...node, children: filteredChildren };
    } else {
      return null;
    }
  }

  if (node.type === "else") {
    const filteredChildren = (node.children ?? [])
      .map(child => filteredResults.get(child) ?? null)
      .filter((child): child is SchemaNode => child !== null);

    if (filteredChildren.length === 0) return null;
    return { ...node, children: filteredChildren };
  }

  // For regular nodes (folder, file), filter children
  if (node.children && node.children.length > 0) {
    const filteredChildren: SchemaNode[] = [];

    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];

      if (child.type === "if") {
        const conditionMet = isConditionMet(child.condition_var, conditionVariables);

        if (conditionMet) {
          // Get the filtered if node's children (already processed)
          const ifResult = filteredResults.get(child);
          if (ifResult) {
            // If the if node was reduced to a single child or kept its children
            if (ifResult.type === "if" && ifResult.children) {
              filteredChildren.push(...ifResult.children);
            } else {
              filteredChildren.push(ifResult);
            }
          }
        } else {
          // Check for else sibling
          const nextChild = node.children[i + 1];
          if (nextChild?.type === "else") {
            const elseResult = filteredResults.get(nextChild);
            if (elseResult && elseResult.children) {
              filteredChildren.push(...elseResult.children);
            }
            i++; // Skip the else node
          }
        }
      } else if (child.type === "else") {
        // Skip standalone else (should have been handled with preceding if)
        continue;
      } else {
        const filtered = filteredResults.get(child);
        if (filtered) {
          filteredChildren.push(filtered);
        }
      }
    }

    return { ...node, children: filteredChildren };
  }

  return node;
};

/**
 * Count folders, files, and downloads in a schema node tree.
 * Uses iterative approach to avoid stack overflow on deeply nested trees.
 *
 * @param node - The root node to count from
 * @returns Object with folders, files, and downloads counts
 */
export const countTreeNodes = (node: SchemaNode): { folders: number; files: number; downloads: number } => {
  let folders = 0;
  let files = 0;
  let downloads = 0;

  // Use a stack for iterative traversal
  const stack: SchemaNode[] = [node];

  while (stack.length > 0) {
    const current = stack.pop()!;

    if (current.type === "folder") folders++;
    if (current.type === "file") files++;
    if (current.url) downloads++;

    // Add children to stack (reverse order to maintain traversal order)
    if (current.children) {
      for (let i = current.children.length - 1; i >= 0; i--) {
        stack.push(current.children[i]);
      }
    }
  }

  return { folders, files, downloads };
};

/**
 * Filter a schema tree based on wizard condition variables.
 * Returns a new tree with only the nodes that match the conditions.
 *
 * @param tree - The original schema tree
 * @param conditionVariables - Map of condition variable names to values
 * @returns A new filtered tree with recalculated stats
 *
 * @example
 * ```typescript
 * const filteredTree = filterTreeByConditions(tree, { "%INCLUDE_TESTS%": "true" });
 * ```
 */
export const filterTreeByConditions = (
  tree: SchemaTree,
  conditionVariables: Record<string, string>
): SchemaTree => {
  const filteredRoot = filterNode(tree.root, conditionVariables);

  if (!filteredRoot) {
    return {
      root: { ...tree.root, children: [] },
      stats: { folders: 0, files: 0, downloads: 0 },
    };
  }

  const stats = countTreeNodes(filteredRoot);

  return {
    root: filteredRoot,
    stats,
  };
};

// ============================================================================
// Step Validation
// ============================================================================

/**
 * Validation result for a single question.
 */
export interface QuestionValidationResult {
  questionId: string;
  isValid: boolean;
  error: string | null;
}

/**
 * Validation result for a wizard step.
 */
export interface StepValidationResult {
  isValid: boolean;
  errors: QuestionValidationResult[];
}

/**
 * Check if a question should be shown based on its showWhen condition.
 *
 * @param question - The question to check
 * @param answers - The current answers
 * @returns True if the question should be displayed
 */
export const shouldShowQuestion = (
  question: WizardQuestion,
  answers: WizardAnswers
): boolean => {
  if (!question.showWhen) return true;

  const { questionId, value: expectedValue } = question.showWhen;
  const actualValue = answers[questionId];

  if (actualValue === undefined) return false;

  if (Array.isArray(expectedValue)) {
    // Empty expected array means "show when any value is selected"
    // This is a reasonable default - if you want "never show", don't use showWhen
    if (expectedValue.length === 0) {
      return Array.isArray(actualValue) ? actualValue.length > 0 : Boolean(actualValue);
    }
    if (Array.isArray(actualValue)) {
      return expectedValue.some((v) => actualValue.includes(v));
    }
    return expectedValue.includes(actualValue as string);
  }

  if (Array.isArray(actualValue)) {
    return actualValue.includes(expectedValue as string);
  }

  return actualValue === expectedValue;
};

/** Maximum allowed length for regex patterns to prevent ReDoS */
const MAX_PATTERN_LENGTH = 500;

/** Maximum allowed length for values to validate */
const MAX_VALUE_LENGTH = 10000;

/**
 * Check if a regex pattern contains potentially dangerous constructs that could cause ReDoS.
 * This is a heuristic check - it may have false positives but should catch common ReDoS patterns.
 *
 * Common ReDoS patterns:
 * - Nested quantifiers: (a+)+ , (a*)*
 * - Overlapping alternations with quantifiers: (a|aa)+
 * - Quantified groups with overlapping patterns: (.*a){10}
 * - Wildcard followed by overlapping suffix: .+a+
 *
 * @param pattern - The regex pattern to check
 * @returns True if pattern appears safe, false if potentially dangerous
 */
const isPatternSafe = (pattern: string): boolean => {
  // Check for nested quantifiers - most common ReDoS cause
  // Matches patterns like (x+)+, (x*)+, (x+)*, etc.
  const nestedQuantifiers = /\([^)]*[+*][^)]*\)[+*{]/;
  if (nestedQuantifiers.test(pattern)) {
    return false;
  }

  // Check for overlapping alternation with quantifier (backreference pattern)
  // Matches patterns like (a|a)+ where alternates are identical
  const overlappingAlternationBackref = /\(([^|)]+)\|\1[^)]*\)[+*{]/;
  if (overlappingAlternationBackref.test(pattern)) {
    return false;
  }

  // Check for alternations where one option is a prefix/suffix of another
  // Matches patterns like (a|aa)+, (x|xy)+, (ab|a)+
  const overlappingAlternationPrefix = /\(([a-zA-Z0-9]+)\|(\1[a-zA-Z0-9]+|[a-zA-Z0-9]+\1)\)[+*{]/;
  if (overlappingAlternationPrefix.test(pattern)) {
    return false;
  }

  // Check for excessive quantifier repetition like {100,}
  const excessiveRepetition = /\{\s*(\d+)\s*,?\s*\}/;
  const match = pattern.match(excessiveRepetition);
  if (match && parseInt(match[1], 10) > 100) {
    return false;
  }

  // Check for .* or .+ followed by another pattern (potential backtracking)
  // But only if it's in a quantified group
  const quantifiedWildcard = /\([^)]*\.\*[^)]*\)[+*{]/;
  if (quantifiedWildcard.test(pattern)) {
    return false;
  }

  // Check for wildcard quantifier followed by overlapping character class
  // Matches patterns like .+a+, .*\w+, .+[a-z]+
  const wildcardOverlap = /\.\+[a-zA-Z0-9\[\]\\]+[+*{]/;
  if (wildcardOverlap.test(pattern)) {
    return false;
  }

  // Check for .* followed by quantified content (backtracking risk)
  const wildcardBacktrack = /\.\*[^)]*[+*{]/;
  if (wildcardBacktrack.test(pattern)) {
    return false;
  }

  return true;
};

/**
 * Safely test a regex pattern against a value with protection against ReDoS.
 * Returns true if the pattern matches, false if it doesn't match or if the pattern is unsafe.
 *
 * @param pattern - The regex pattern string
 * @param value - The value to test
 * @returns True if matches, false otherwise (including on error/timeout)
 */
const safeRegexTest = (pattern: string, value: string): boolean => {
  // Reject overly long patterns
  if (pattern.length > MAX_PATTERN_LENGTH) {
    console.warn(`Regex pattern exceeds max length (${MAX_PATTERN_LENGTH}), skipping validation`);
    return true; // Allow value to pass if we can't validate
  }

  // Reject overly long values to limit worst-case execution time
  if (value.length > MAX_VALUE_LENGTH) {
    console.warn(`Value exceeds max length (${MAX_VALUE_LENGTH}), skipping regex validation`);
    return true;
  }

  // Check for dangerous patterns before executing
  if (!isPatternSafe(pattern)) {
    console.warn("Regex pattern contains potentially dangerous constructs, skipping validation");
    return true; // Allow value to pass if pattern is unsafe
  }

  try {
    const regex = new RegExp(pattern);
    return regex.test(value);
  } catch {
    // Invalid regex pattern - allow the value to pass
    return true;
  }
};

/**
 * Validate a single text question value.
 *
 * @param value - The text value to validate
 * @param validation - The validation rules
 * @returns Error message or null if valid
 */
const validateTextQuestion = (
  value: string,
  validation: ValidationRule | undefined
): string | null => {
  if (!validation) return null;

  if (validation.required && !value.trim()) {
    return VALIDATION_MESSAGES.required;
  }

  if (validation.minLength && value.length < validation.minLength) {
    return VALIDATION_MESSAGES.minLength(validation.minLength);
  }

  if (validation.maxLength && value.length > validation.maxLength) {
    return VALIDATION_MESSAGES.maxLength(validation.maxLength);
  }

  if (validation.pattern) {
    if (!safeRegexTest(validation.pattern, value)) {
      return VALIDATION_MESSAGES.invalidFormat;
    }
  }

  return null;
};

/**
 * Validate a single question's answer.
 *
 * @param question - The question to validate
 * @param answers - All current answers
 * @returns Validation result for the question
 */
const validateQuestion = (
  question: WizardQuestion,
  answers: WizardAnswers
): QuestionValidationResult => {
  const value = answers[question.id];
  const effectiveValue = value ?? question.defaultValue;

  // Boolean questions don't have required validation in the same way
  if (question.type === "boolean") {
    return { questionId: question.id, isValid: true, error: null };
  }

  // For single/select, check if a value is selected when required
  if (question.type === "single" || question.type === "select") {
    if (question.validation?.required && !effectiveValue) {
      return {
        questionId: question.id,
        isValid: false,
        error: VALIDATION_MESSAGES.selectOption,
      };
    }
    return { questionId: question.id, isValid: true, error: null };
  }

  // For multiple choice
  if (question.type === "multiple") {
    const arr = effectiveValue as string[] | undefined;
    if (question.validation?.required && (!arr || arr.length === 0)) {
      return {
        questionId: question.id,
        isValid: false,
        error: VALIDATION_MESSAGES.selectAtLeastOne,
      };
    }
    return { questionId: question.id, isValid: true, error: null };
  }

  // For text questions
  if (question.type === "text") {
    const textValue = (effectiveValue as string) ?? "";
    const error = validateTextQuestion(textValue, question.validation);
    return {
      questionId: question.id,
      isValid: error === null,
      error,
    };
  }

  return { questionId: question.id, isValid: true, error: null };
};

/**
 * Validate all visible questions in a wizard step.
 * Returns validation results for each question.
 *
 * @param step - The wizard step to validate
 * @param answers - The current answers
 * @returns Validation result with all errors
 */
export const validateWizardStep = (
  step: WizardStep,
  answers: WizardAnswers
): StepValidationResult => {
  const visibleQuestions = step.questions.filter(q => shouldShowQuestion(q, answers));
  const errors = visibleQuestions.map(q => validateQuestion(q, answers));
  const isValid = errors.every(e => e.isValid);

  return { isValid, errors };
};

// ============================================================================
// Node ID Generation
// ============================================================================

/**
 * Generate a consistent ID for a schema node.
 * Used for React keys and expanded state tracking.
 *
 * @param node - The schema node
 * @param index - The index of the node in its parent
 * @returns A stable ID string
 */
export const generateNodeId = (node: SchemaNode, index: number): string => {
  if (node.id) return node.id;
  return `${node.type}-${node.name}-${index}`;
};

/**
 * Generate a stable tree signature for comparison.
 * Uses iterative approach to avoid stack overflow on deeply nested trees.
 *
 * @param tree - The schema tree
 * @returns A string signature representing the tree structure
 */
export const getTreeSignature = (tree: SchemaTree | null): string => {
  if (!tree) return "";

  // Use iterative post-order traversal to build signatures bottom-up
  const signatures = new Map<SchemaNode, string>();

  // Stack entries: [node, visited] - visited indicates children have been processed
  const stack: Array<[SchemaNode, boolean]> = [[tree.root, false]];

  while (stack.length > 0) {
    const [node, visited] = stack.pop()!;

    if (visited) {
      // Children have been processed, build this node's signature
      // Include URL to detect file content source changes
      const childSigs = (node.children ?? [])
        .map((child) => signatures.get(child) ?? "")
        .join(",");
      const urlPart = node.url ? `@${node.url}` : "";
      signatures.set(node, `${node.type}:${node.name}${urlPart}[${childSigs}]`);
    } else {
      // First visit - push self back (marked visited) then push children
      stack.push([node, true]);
      // Push children in reverse order so they're processed left-to-right
      const children = node.children ?? [];
      for (let i = children.length - 1; i >= 0; i--) {
        stack.push([children[i], false]);
      }
    }
  }

  return signatures.get(tree.root) ?? "";
};

