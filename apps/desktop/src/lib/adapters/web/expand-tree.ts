import type { SchemaNode, SchemaTree } from "@structure-creator/shared";

/**
 * Case-preserving variable substitution for path/name expansion. Mirrors the
 * Rust target's substitution: looks the captured name up verbatim, so a
 * lowercase iteration var (`%i%`) resolves against a `%i%`-keyed entry. This
 * is distinct from the web engine's `substituteVariables`, which uppercases
 * the lookup key for user-facing tokens.
 */
const substituteInName = (
  text: string,
  variables: Record<string, string>
): string =>
  text.replace(
    /%([A-Za-z_][A-Za-z0-9_]*)%/g,
    (match, name) => variables[`%${name}%`] ?? match
  );

/**
 * Pure tree expander: given a parsed schema and variable map, return the
 * relative paths (folders + files) that would result from creating the
 * structure. No filesystem access; mirrors the planning semantics used by
 * the Rust target's `generate_diff_preview` so the golden-vector contract
 * (ADR-0002, issue #101) can compare the two.
 *
 * Supports: folder, file, variable substitution in names, `<if var="X">`
 * conditional evaluation (truthy = non-empty and not "false"/"0"), `<else>`
 * sibling of the immediately preceding `<if>`, and `<repeat count as>`
 * iteration with the iteration variable available to children.
 */
export const expandTreeToPaths = (
  tree: SchemaTree,
  variables: Record<string, string>
): string[] => {
  const paths: string[] = [];
  walk(tree.root, "", paths, variables);
  return paths;
};

const walk = (
  node: SchemaNode,
  prefix: string,
  paths: string[],
  variables: Record<string, string>
): void => {
  const name = substituteInName(node.name, variables);
  const path = prefix ? `${prefix}/${name}` : name;

  if (node.type === "folder") {
    paths.push(path);
    walkChildren(node.children ?? [], path, paths, variables);
    return;
  }

  if (node.type === "file") {
    paths.push(path);
    return;
  }
};

const walkChildren = (
  children: SchemaNode[],
  prefix: string,
  paths: string[],
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
        walkChildren(child.children ?? [], prefix, paths, variables);
      }
      continue;
    }

    if (child.type === "else") {
      if (lastIfWasTrue === false) {
        walkChildren(child.children ?? [], prefix, paths, variables);
      }
      lastIfWasTrue = null;
      continue;
    }

    if (child.type === "repeat") {
      const count = parseRepeatCount(child.repeat_count, variables);
      const iterName = child.repeat_as ?? "i";
      for (let i = 0; i < count; i++) {
        const scoped: Record<string, string> = {
          ...variables,
          [`%${iterName}%`]: String(i),
        };
        walkChildren(child.children ?? [], prefix, paths, scoped);
      }
      lastIfWasTrue = null;
      continue;
    }

    walk(child, prefix, paths, variables);
    lastIfWasTrue = null;
  }
};

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

const parseRepeatCount = (
  raw: string | undefined,
  variables: Record<string, string>
): number => {
  if (!raw) return 0;
  const substituted = substituteInName(raw, variables);
  const n = Number.parseInt(substituted, 10);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
};
