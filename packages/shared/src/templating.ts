/**
 * Template processing module for file content.
 *
 * Provides conditional and loop constructs for file content when `template="true"` attribute is set.
 * This is opt-in to avoid conflicts with Handlebars/Mustache files.
 *
 * Supported syntax:
 * - `{{if VAR}}...{{endif}}` - conditional inclusion
 * - `{{if VAR}}...{{else}}...{{endif}}` - conditional with alternative
 * - `{{for item in VAR}}...{{endfor}}` - loop over comma-separated values
 * - `{{item}}` - loop variable reference (inside for loops)
 *
 * Note: `%VAR%` substitution should be handled separately after template processing.
 */

/** Maximum nesting depth for template blocks to prevent runaway recursion */
const MAX_NESTING_DEPTH = 20;

/** Error types for template processing */
export type TemplateErrorType =
  | "UnclosedIf"
  | "UnclosedFor"
  | "UnexpectedEndif"
  | "UnexpectedEndfor"
  | "UnexpectedElse"
  | "MaxDepthExceeded";

export interface TemplateError {
  type: TemplateErrorType;
  message: string;
  var?: string;
  item?: string;
}

export type TemplateResult =
  | { ok: true; value: string }
  | { ok: false; error: TemplateError };

/** Pre-compiled regex patterns for template directives */
const IF_REGEX = /\{\{if\s+([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/;
const IF_REGEX_GLOBAL = /\{\{if\s+([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;
const ELSE_REGEX = /\{\{else\}\}/;
const ENDIF_REGEX = /\{\{endif\}\}/;
const FOR_REGEX = /\{\{for\s+([a-z_][a-z0-9_]*)\s+in\s+([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/;
const FOR_REGEX_GLOBAL = /\{\{for\s+([a-z_][a-z0-9_]*)\s+in\s+([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;
const ENDFOR_REGEX = /\{\{endfor\}\}/;

/** Regex for extracting template variables from content (for variable detection) */
const TEMPLATE_VAR_REGEX = /\{\{(?:if|for\s+[a-z_][a-z0-9_]*\s+in)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

/**
 * Check if a variable is truthy.
 * A variable is truthy if it exists, is non-empty, is not "false", and is not "0".
 */
function isTruthy(variables: Record<string, string>, varName: string): boolean {
  const key = `%${varName}%`;
  const value = variables[key];
  if (value === undefined) {
    return false;
  }
  const trimmed = value.trim().toLowerCase();
  return trimmed !== "" && trimmed !== "false" && trimmed !== "0";
}

/**
 * Get a variable's value as a list (split by comma).
 */
function getList(variables: Record<string, string>, varName: string): string[] {
  const key = `%${varName}%`;
  const value = variables[key];
  if (value === undefined) {
    return [];
  }
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

/**
 * Find the position of the matching {{endfor}} for a {{for}} block.
 * Handles nested for loops.
 */
function findMatchingEndfor(
  content: string,
  itemVar: string,
  sourceVar: string
): { ok: true; position: number } | { ok: false; error: TemplateError } {
  let depth = 1;
  let pos = 0;

  while (pos < content.length) {
    const remaining = content.slice(pos);

    // Check for nested for
    const forMatch = remaining.match(FOR_REGEX);
    const endforMatch = remaining.match(ENDFOR_REGEX);

    if (forMatch && endforMatch) {
      if (forMatch.index! < endforMatch.index!) {
        // Found a nested for before endfor
        depth += 1;
        pos += forMatch.index! + forMatch[0].length;
        continue;
      }
    }

    // Check for endfor
    if (endforMatch) {
      depth -= 1;
      if (depth === 0) {
        return { ok: true, position: pos + endforMatch.index! };
      }
      pos += endforMatch.index! + endforMatch[0].length;
    } else {
      // No more endfor found
      break;
    }
  }

  return {
    ok: false,
    error: {
      type: "UnclosedFor",
      message: `Unclosed {{for ${itemVar} in ${sourceVar}}} block`,
      var: sourceVar,
      item: itemVar,
    },
  };
}

/**
 * Process all {{for}} loops in the content
 */
function processForLoops(
  content: string,
  variables: Record<string, string>,
  depth: number
): TemplateResult {
  if (depth > MAX_NESTING_DEPTH) {
    return {
      ok: false,
      error: {
        type: "MaxDepthExceeded",
        message: `Maximum nesting depth (${MAX_NESTING_DEPTH}) exceeded`,
      },
    };
  }

  let result = content;

  // Keep processing until no more for loops are found
  while (true) {
    const forMatch = result.match(FOR_REGEX);
    if (!forMatch) {
      break;
    }

    const forStart = forMatch.index!;
    const forEnd = forStart + forMatch[0].length;
    const itemVar = forMatch[1];
    const sourceVar = forMatch[2];

    // Find the matching endfor
    const remaining = result.slice(forEnd);
    const endforResult = findMatchingEndfor(remaining, itemVar, sourceVar);
    if (!endforResult.ok) {
      return endforResult;
    }

    const endforPos = endforResult.position;
    const blockContent = remaining.slice(0, endforPos);
    const endforEnd = forEnd + endforPos + "{{endfor}}".length;

    // Get the list items
    const items = getList(variables, sourceVar);

    // Expand the loop
    let expanded = "";
    for (const itemValue of items) {
      // Replace {{item_var}} with the item value
      const itemPattern = new RegExp(`\\{\\{${itemVar}\\}\\}`, "g");
      const iteration = blockContent.replace(itemPattern, itemValue);
      expanded += iteration;
    }

    // Replace the entire for block with the expanded content
    result = result.slice(0, forStart) + expanded + result.slice(endforEnd);
  }

  // Check for orphan endfor
  if (ENDFOR_REGEX.test(result)) {
    return {
      ok: false,
      error: {
        type: "UnexpectedEndfor",
        message: "Unexpected {{endfor}} without matching {{for}}",
      },
    };
  }

  return { ok: true, value: result };
}

/**
 * Find the parts of an if block: then content, optional else content, and end position.
 */
function findIfBlockParts(
  content: string,
  conditionVar: string
):
  | { ok: true; thenContent: string; elseContent: string | null; endPosition: number }
  | { ok: false; error: TemplateError } {
  let depth = 1;
  let pos = 0;
  let elsePos: number | null = null;

  while (pos < content.length) {
    const remaining = content.slice(pos);

    // Find next relevant token
    const ifMatch = remaining.match(IF_REGEX);
    const elseMatch = remaining.match(ELSE_REGEX);
    const endifMatch = remaining.match(ENDIF_REGEX);

    // Build list of tokens with positions
    const tokens: Array<{ position: number; type: "if" | "else" | "endif"; length: number }> = [];

    if (ifMatch) {
      tokens.push({ position: ifMatch.index!, type: "if", length: ifMatch[0].length });
    }
    if (elseMatch) {
      tokens.push({ position: elseMatch.index!, type: "else", length: elseMatch[0].length });
    }
    if (endifMatch) {
      tokens.push({ position: endifMatch.index!, type: "endif", length: endifMatch[0].length });
    }

    if (tokens.length === 0) {
      break;
    }

    // Sort by position to find earliest
    tokens.sort((a, b) => a.position - b.position);
    const token = tokens[0];

    switch (token.type) {
      case "if":
        depth += 1;
        pos += token.position + token.length;
        break;
      case "else":
        if (depth === 1 && elsePos === null) {
          elsePos = pos + token.position;
        }
        pos += token.position + token.length;
        break;
      case "endif":
        depth -= 1;
        if (depth === 0) {
          const endifStart = pos + token.position;
          const endifEnd = pos + token.position + token.length;

          if (elsePos !== null) {
            const thenContent = content.slice(0, elsePos);
            const elseContentStart = elsePos + "{{else}}".length;
            const elseContent = content.slice(elseContentStart, endifStart);
            return { ok: true, thenContent, elseContent, endPosition: endifEnd };
          } else {
            const thenContent = content.slice(0, endifStart);
            return { ok: true, thenContent, elseContent: null, endPosition: endifEnd };
          }
        }
        pos += token.position + token.length;
        break;
    }
  }

  return {
    ok: false,
    error: {
      type: "UnclosedIf",
      message: `Unclosed {{if ${conditionVar}}} block`,
      var: conditionVar,
    },
  };
}

/**
 * Process all {{if}} conditionals in the content
 */
function processIfConditionals(
  content: string,
  variables: Record<string, string>,
  depth: number
): TemplateResult {
  if (depth > MAX_NESTING_DEPTH) {
    return {
      ok: false,
      error: {
        type: "MaxDepthExceeded",
        message: `Maximum nesting depth (${MAX_NESTING_DEPTH}) exceeded`,
      },
    };
  }

  let result = content;

  // Keep processing until no more if blocks are found
  while (true) {
    const ifMatch = result.match(IF_REGEX);
    if (!ifMatch) {
      break;
    }

    const ifStart = ifMatch.index!;
    const ifEnd = ifStart + ifMatch[0].length;
    const conditionVar = ifMatch[1];

    // Find the matching endif (and optional else)
    const remaining = result.slice(ifEnd);
    const blockResult = findIfBlockParts(remaining, conditionVar);
    if (!blockResult.ok) {
      return blockResult;
    }

    const { thenContent, elseContent, endPosition } = blockResult;
    const endifEnd = ifEnd + endPosition;

    // Evaluate the condition
    const conditionResult = isTruthy(variables, conditionVar);

    // Choose the appropriate content
    const chosenContent = conditionResult ? thenContent : (elseContent ?? "");

    // Replace the entire if block with the chosen content
    result = result.slice(0, ifStart) + chosenContent + result.slice(endifEnd);
  }

  // Check for orphan endif/else
  if (ENDIF_REGEX.test(result)) {
    return {
      ok: false,
      error: {
        type: "UnexpectedEndif",
        message: "Unexpected {{endif}} without matching {{if}}",
      },
    };
  }
  if (ELSE_REGEX.test(result)) {
    return {
      ok: false,
      error: {
        type: "UnexpectedElse",
        message: "Unexpected {{else}} without matching {{if}}",
      },
    };
  }

  return { ok: true, value: result };
}

/**
 * Process template directives in content.
 *
 * Processing order:
 * 1. Process `{{for}}` loops first (expands iterations)
 * 2. Process `{{if}}` conditionals second
 *
 * Note: Standard `%VAR%` substitution should be done separately after this.
 */
export function processTemplate(
  content: string,
  variables: Record<string, string>
): TemplateResult {
  // Process for loops first (they may contain if blocks)
  const forResult = processForLoops(content, variables, 0);
  if (!forResult.ok) {
    return forResult;
  }

  // Then process if conditionals
  return processIfConditionals(forResult.value, variables, 0);
}

/**
 * Extract variable names used in template directives.
 * Returns uppercase variable names (with % delimiters) used in {{if VAR}} and {{for item in VAR}}.
 */
export function extractTemplateVariables(content: string): string[] {
  const vars = new Set<string>();

  let match;
  while ((match = TEMPLATE_VAR_REGEX.exec(content)) !== null) {
    const varName = match[1];
    // Only include uppercase variables
    if (/^[A-Z_][A-Z0-9_]*$/.test(varName)) {
      vars.add(`%${varName}%`);
    }
  }

  // Reset regex lastIndex for future use
  TEMPLATE_VAR_REGEX.lastIndex = 0;

  return Array.from(vars);
}

/**
 * Convenience function that processes a template and returns the result or throws.
 * Useful when you want exception-style error handling.
 */
export function processTemplateOrThrow(
  content: string,
  variables: Record<string, string>
): string {
  const result = processTemplate(content, variables);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.value;
}
