/**
 * The web Target's Plan module (ADR-0004).
 *
 * `expand(tree, variables)` turns a parsed Schema plus a complete Variable
 * map into a Plan: a tree of resolved nodes with names substituted and
 * inline content fully rendered (templating via `processTemplate`, THEN
 * variable substitution — matching the create walkers on both Targets).
 * IO-dependent content is deferred as `download` / `generate` instructions
 * for the executor to dispatch.
 *
 * Pure and deterministic: no browser APIs, no filesystem, no clock, no
 * network. The caller supplies the complete variable map (built-ins like
 * `%DATE%` are injected at the edge). This is the unit the golden-vector
 * schema-structure contract pins (`fixtures/schema-structure.json`).
 *
 * Structural semantics (the create-walker spec, per ADR-0004):
 * - `<if var="X">` children emit when `%X%` is truthy — non-empty and not
 *   "false"/"0" (trimmed, case-insensitive).
 * - `<else>` pairs with the immediately preceding `<if>`.
 * - `<repeat count as>`: missing count defaults to 1; negative, non-numeric,
 *   or above-maximum counts and invalid iteration-variable names produce a
 *   loud error and skip the block; both `%i%` (0-indexed) and `%i_1%`
 *   (1-indexed) iteration variables are injected.
 */

import type { SchemaNode, SchemaTree } from "./types";
import { substituteVariables } from "./transforms";
import { processTemplate } from "./templating";

/** Maximum number of iterations allowed in a repeat block. */
export const MAX_REPEAT_COUNT = 10000;

/** Maximum schema nesting depth during expansion. */
export const MAX_SCHEMA_DEPTH = 100;

/** Where a Plan node came from, for diff display and debugging. */
export interface PlanProvenance {
  /** Set when the node was emitted by an `<if>`/`<else>` branch. */
  branch?: "if" | "else";
  /** The condition Variable name of the `<if>` that emitted the node. */
  conditionVar?: string;
  /** 0-based iteration index of the `<repeat>` that emitted the node. */
  repeatIndex?: number;
}

/** Resolved file content, or a deferred IO instruction for the executor. */
export type PlanContent =
  | {
      /** Fully rendered text: templating applied, then variables substituted. */
      kind: "inline";
      text: string;
    }
  | {
      /** Download instruction; `url` has variables substituted. */
      kind: "download";
      url: string;
      /**
       * The variable map in scope at this node (includes repeat iteration
       * variables), needed by the executor to substitute inside downloaded
       * text/archive content.
       */
      variables: Record<string, string>;
    }
  | {
      /** Generator instruction, dispatched to a Target's generator. */
      kind: "generate";
      generator: "image" | "sqlite";
      /** The schema node carrying generator attributes/spec. */
      spec: SchemaNode;
      /** The variable map in scope at this node. */
      variables: Record<string, string>;
    };

export interface PlanFolder {
  kind: "folder";
  /** Resolved name (variables substituted). */
  name: string;
  children: PlanNode[];
  provenance?: PlanProvenance;
}

export interface PlanFile {
  kind: "file";
  /** Resolved name (variables substituted). */
  name: string;
  content: PlanContent;
  provenance?: PlanProvenance;
}

export type PlanNode = PlanFolder | PlanFile;

/** A loud error collected during expansion (the offending block is skipped). */
export interface PlanError {
  /** Path of the nearest enclosing folder ("" for root level). */
  path: string;
  message: string;
  details?: string;
}

/** A non-fatal issue (e.g. template error with raw-content fallback). */
export interface PlanWarning {
  path: string;
  message: string;
  details?: string;
}

export interface Plan {
  /**
   * Resolved top-level nodes. A list, not a single root, because a control
   * node (if/repeat) at the schema root expands to zero or more nodes.
   */
  nodes: PlanNode[];
  errors: PlanError[];
  warnings: PlanWarning[];
}

interface ExpandState {
  errors: PlanError[];
  warnings: PlanWarning[];
}

/**
 * Expand a Schema plus complete Variable map into a Plan.
 */
export const expand = (
  tree: SchemaTree,
  variables: Record<string, string>
): Plan => {
  const state: ExpandState = { errors: [], warnings: [] };
  const nodes = expandChildren([tree.root], variables, "", 0, state, undefined);
  return { nodes, errors: state.errors, warnings: state.warnings };
};

/**
 * Flatten a Plan into the sorted list of relative paths (folders + files)
 * it would create. Used by the golden-vector contract test.
 */
export const toPaths = (plan: Plan): string[] => {
  const paths: string[] = [];
  const walk = (node: PlanNode, prefix: string): void => {
    const path = prefix ? `${prefix}/${node.name}` : node.name;
    paths.push(path);
    if (node.kind === "folder") {
      for (const child of node.children) {
        walk(child, path);
      }
    }
  };
  for (const node of plan.nodes) {
    walk(node, "");
  }
  return paths.sort();
};

const expandChildren = (
  children: SchemaNode[],
  variables: Record<string, string>,
  path: string,
  depth: number,
  state: ExpandState,
  provenance: PlanProvenance | undefined
): PlanNode[] => {
  if (depth >= MAX_SCHEMA_DEPTH) {
    state.errors.push({
      path,
      message: `Maximum schema depth (${MAX_SCHEMA_DEPTH}) exceeded`,
      details:
        "Schema nesting is too deep. This may indicate a malformed schema.",
    });
    return [];
  }

  const out: PlanNode[] = [];
  // Track the result of the most recent `<if>` so a sibling `<else>` knows
  // whether to emit. Any non-if/else node clears the state.
  let lastIfWasTrue: boolean | null = null;

  for (const child of children) {
    switch (child.type) {
      case "if": {
        const truthy = isTruthy(child.condition_var, variables);
        lastIfWasTrue = truthy;
        if (truthy) {
          out.push(
            ...expandChildren(child.children ?? [], variables, path, depth + 1, state, {
              ...provenance,
              branch: "if",
              conditionVar: child.condition_var,
            })
          );
        }
        break;
      }
      case "else": {
        if (lastIfWasTrue === false) {
          out.push(
            ...expandChildren(child.children ?? [], variables, path, depth + 1, state, {
              ...provenance,
              branch: "else",
            })
          );
        }
        lastIfWasTrue = null;
        break;
      }
      case "repeat": {
        out.push(...expandRepeat(child, variables, path, depth, state, provenance));
        lastIfWasTrue = null;
        break;
      }
      case "folder": {
        out.push(expandFolder(child, variables, path, depth, state, provenance));
        lastIfWasTrue = null;
        break;
      }
      case "file": {
        out.push(expandFile(child, variables, path, state, provenance));
        lastIfWasTrue = null;
        break;
      }
    }
  }

  return out;
};

const expandFolder = (
  node: SchemaNode,
  variables: Record<string, string>,
  path: string,
  depth: number,
  state: ExpandState,
  provenance: PlanProvenance | undefined
): PlanFolder => {
  const name = substituteVariables(node.name, variables);
  const folderPath = path ? `${path}/${name}` : name;
  const children = expandChildren(
    node.children ?? [],
    variables,
    folderPath,
    depth + 1,
    state,
    undefined
  );
  const folder: PlanFolder = { kind: "folder", name, children };
  if (provenance) {
    folder.provenance = provenance;
  }
  return folder;
};

const expandFile = (
  node: SchemaNode,
  variables: Record<string, string>,
  path: string,
  state: ExpandState,
  provenance: PlanProvenance | undefined
): PlanFile => {
  const name = substituteVariables(node.name, variables);
  const filePath = path ? `${path}/${name}` : name;

  let content: PlanContent;
  if (node.url) {
    content = {
      kind: "download",
      url: substituteVariables(node.url, variables),
      variables,
    };
  } else if (node.generate) {
    content = {
      kind: "generate",
      generator: node.generate,
      spec: node,
      variables,
    };
  } else if (node.content) {
    // Process template directives if template="true", THEN substitute
    // variables — the ordering both Targets' create walkers use.
    let text: string;
    if (node.template) {
      const templateResult = processTemplate(node.content, variables);
      if (templateResult.ok) {
        text = substituteVariables(templateResult.value, variables);
      } else {
        // Template error - warn and fall back to raw content with
        // variable substitution.
        state.warnings.push({
          path: filePath,
          message: `Template error in ${name}`,
          details: templateResult.error.message,
        });
        text = substituteVariables(node.content, variables);
      }
    } else {
      text = substituteVariables(node.content, variables);
    }
    content = { kind: "inline", text };
  } else {
    content = { kind: "inline", text: "" };
  }

  const file: PlanFile = { kind: "file", name, content };
  if (provenance) {
    file.provenance = provenance;
  }
  return file;
};

const expandRepeat = (
  node: SchemaNode,
  variables: Record<string, string>,
  path: string,
  depth: number,
  state: ExpandState,
  provenance: PlanProvenance | undefined
): PlanNode[] => {
  const iterName = node.repeat_as ?? "i";
  if (!isValidIterationName(iterName)) {
    state.errors.push({
      path,
      message: `Invalid repeat variable name: '${iterName}'`,
      details:
        "Iteration variable names must be non-empty, alphanumeric/underscore, and not start with a digit",
    });
    return [];
  }

  const raw = node.repeat_count ?? "1";
  const substituted = substituteVariables(raw, variables);
  const count = Number.parseInt(substituted.trim(), 10);
  if (!Number.isFinite(count) || String(count) !== substituted.trim()) {
    state.errors.push({
      path,
      message: `Invalid repeat count: '${substituted}'`,
      details: "Skipping repeat block",
    });
    return [];
  }
  if (count < 0) {
    state.errors.push({
      path,
      message: `Repeat count cannot be negative: '${substituted}'`,
      details: "Skipping repeat block",
    });
    return [];
  }
  if (count > MAX_REPEAT_COUNT) {
    state.errors.push({
      path,
      message: `Repeat count '${count}' exceeds maximum of ${MAX_REPEAT_COUNT}`,
      details: "Skipping repeat block to prevent resource exhaustion",
    });
    return [];
  }

  const out: PlanNode[] = [];
  for (let i = 0; i < count; i++) {
    const scoped: Record<string, string> = {
      ...variables,
      [`%${iterName}%`]: String(i),
      [`%${iterName}_1%`]: String(i + 1),
    };
    out.push(
      ...expandChildren(node.children ?? [], scoped, path, depth + 1, state, {
        ...provenance,
        repeatIndex: i,
      })
    );
  }
  return out;
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
