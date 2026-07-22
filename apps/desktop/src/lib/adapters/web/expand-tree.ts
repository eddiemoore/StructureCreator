import type { SchemaNode, SchemaTree } from "@structure-creator/shared";
import { substituteVariables } from "./transforms";
import { MAX_REPEAT_COUNT } from "./constants";

/**
 * Pure tree expander: given a parsed schema and variable map, return the
 * relative paths (folders + files) that would result from creating the
 * structure, plus any loud errors. No filesystem access; mirrors the Plan
 * semantics pinned by the golden-vector contract (ADR-0002, ADR-0004) so
 * the two targets can be compared.
 *
 * Supports: folder, file, variable substitution in names, `<if var="X">`
 * conditional evaluation (truthy = non-empty and not "false"/"0"), `<else>`
 * sibling of the immediately preceding `<if>`, and `<repeat count as>`
 * iteration with 0-indexed (`%i%`) and 1-indexed (`%i_1%`) iteration
 * variables available to children.
 *
 * Repeat edge semantics (ADR-0004, create-walker spec): missing count
 * defaults to 1; negative, non-numeric, or above-maximum counts and invalid
 * iteration-variable names produce a loud error and skip the block.
 */
export interface ExpandResult {
  paths: string[];
  errors: string[];
}

export const expandTree = (
  tree: SchemaTree,
  variables: Record<string, string>
): ExpandResult => {
  const result: ExpandResult = { paths: [], errors: [] };
  walk(tree.root, "", result, variables);
  return result;
};

export const expandTreeToPaths = (
  tree: SchemaTree,
  variables: Record<string, string>
): string[] => expandTree(tree, variables).paths;

const walk = (
  node: SchemaNode,
  prefix: string,
  result: ExpandResult,
  variables: Record<string, string>
): void => {
  const name = substituteVariables(node.name, variables);
  const path = prefix ? `${prefix}/${name}` : name;

  if (node.type === "folder") {
    result.paths.push(path);
    walkChildren(node.children ?? [], path, result, variables);
    return;
  }

  if (node.type === "file") {
    result.paths.push(path);
    return;
  }
};

const walkChildren = (
  children: SchemaNode[],
  prefix: string,
  result: ExpandResult,
  variables: Record<string, string>
): void => {
  // Track the result of the most recent `<if>` so a sibling `<else>` knows
  // whether to emit. Any non-if/else node clears the state.
  let lastIfWasTrue: boolean | null = null;

  for (const child of children) {
    if (child.type === "if") {
      const truthy = isTruthy(child.condition_var, variables);
      lastIfWasTrue = truthy;
      if (truthy) {
        walkChildren(child.children ?? [], prefix, result, variables);
      }
      continue;
    }

    if (child.type === "else") {
      if (lastIfWasTrue === false) {
        walkChildren(child.children ?? [], prefix, result, variables);
      }
      lastIfWasTrue = null;
      continue;
    }

    if (child.type === "repeat") {
      walkRepeat(child, prefix, result, variables);
      lastIfWasTrue = null;
      continue;
    }

    walk(child, prefix, result, variables);
    lastIfWasTrue = null;
  }
};

const walkRepeat = (
  node: SchemaNode,
  prefix: string,
  result: ExpandResult,
  variables: Record<string, string>
): void => {
  const iterName = node.repeat_as ?? "i";
  if (!isValidIterationName(iterName)) {
    result.errors.push(`Invalid repeat variable name: '${iterName}'`);
    return;
  }

  const raw = node.repeat_count ?? "1";
  const substituted = substituteVariables(raw, variables);
  const count = Number.parseInt(substituted.trim(), 10);
  if (!Number.isFinite(count) || String(count) !== substituted.trim()) {
    result.errors.push(`Invalid repeat count: '${substituted}'`);
    return;
  }
  if (count < 0) {
    result.errors.push(`Repeat count cannot be negative: '${substituted}'`);
    return;
  }
  if (count > MAX_REPEAT_COUNT) {
    result.errors.push(
      `Repeat count '${count}' exceeds maximum of ${MAX_REPEAT_COUNT}`
    );
    return;
  }

  for (let i = 0; i < count; i++) {
    const scoped: Record<string, string> = {
      ...variables,
      [`%${iterName}%`]: String(i),
      [`%${iterName}_1%`]: String(i + 1),
    };
    walkChildren(node.children ?? [], prefix, result, scoped);
  }
};

const isValidIterationName = (name: string): boolean =>
  name.length > 0 &&
  !/^\d/.test(name) &&
  [...name].every((c) => /[a-zA-Z0-9_]/.test(c));

const isTruthy = (
  conditionVar: string | undefined,
  variables: Record<string, string>
): boolean => {
  if (!conditionVar) return false;
  const value = variables[`%${conditionVar}%`];
  if (value === undefined) return false;
  const trimmed = value.trim().toLowerCase();
  return trimmed !== "" && trimmed !== "false" && trimmed !== "0";
};
