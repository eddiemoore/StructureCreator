/**
 * Creation run (see CONTEXT.md): the sequence that turns user inputs into a
 * structure — validate (schema, then Variables), preview (compare the Plan
 * against disk), execute the creation, record history, and undo.
 *
 * Stateless: results are returned to the caller; the store holds them.
 * Watch auto-create and the keyboard shortcut are ordinary callers.
 */

import { api } from "./api";
import { getPluginRuntime, processTreeContent } from "./plugins";
import type {
  SchemaTree,
  Variable,
  ValidationRule,
  ValidationError,
  CreateResult,
  ResultSummary,
  CreatedItem,
  UndoSummary,
  DiffResult,
  LogEntry,
  CreationProgress,
  Plugin,
} from "../types/schema";

export interface CreationInputs {
  tree: SchemaTree | null;
  /** Raw schema XML when available; enables schema validation and content-based creation. */
  content: string | null;
  /** Clean Variable names (ADR-0001); maps are built internally. */
  variables: Variable[];
  outputPath: string;
  projectName: string;
  overwrite: boolean;
  plugins: Plugin[];
  /** Used to derive the template name recorded in history. */
  schemaPath?: string | null;
}

export interface CreationReporter {
  onLog: (entry: Omit<LogEntry, "id" | "timestamp">) => void;
  onProgress: (
    update: Partial<Pick<CreationProgress, "status" | "current" | "total">>
  ) => void;
  onValidationErrors: (errors: ValidationError[]) => void;
  /** Fired after validation passes, just before the diff is computed. */
  onDiffStart?: () => void;
}

export type PreviewOutcome =
  | { ok: true; diff: DiffResult }
  | { ok: false; stage: "validation" | "diff"; error?: string };

export interface CreateOutcome {
  ok: boolean;
  summary: ResultSummary | null;
  createdItems: CreatedItem[] | null;
}

export interface UndoOutcome {
  ok: boolean;
  summary: UndoSummary | null;
}

const buildVariableMaps = (variables: Variable[]) => {
  const varsMap: Record<string, string> = {};
  const rulesMap: Record<string, ValidationRule> = {};
  variables.forEach((v) => {
    varsMap[v.name] = v.value;
    if (v.validation) {
      rulesMap[v.name] = v.validation;
    }
  });
  return { varsMap, rulesMap };
};

const errorMessage = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);

/** Schema validation (when content is available), then Variable validation. */
const validateInputs = async (
  inputs: CreationInputs,
  reporter: CreationReporter,
  varsMap: Record<string, string>,
  rulesMap: Record<string, ValidationRule>
): Promise<boolean> => {
  if (inputs.content) {
    reporter.onLog({ type: "info", message: "Validating schema..." });
    reporter.onProgress({ status: "running", current: 0, total: 0 });

    try {
      const schemaValidation = await api.validation.validateSchema(
        inputs.content,
        varsMap
      );

      // Warnings don't block creation
      for (const warning of schemaValidation.warnings) {
        reporter.onLog({
          type: "warning",
          message: warning.message,
          details: warning.nodePath ? `Path: ${warning.nodePath}` : undefined,
        });
      }

      if (!schemaValidation.isValid) {
        for (const error of schemaValidation.errors) {
          reporter.onLog({
            type: "error",
            message: error.message,
            details: error.nodePath ? `Path: ${error.nodePath}` : undefined,
          });
        }
        reporter.onProgress({ status: "error" });
        return false;
      }
    } catch (e) {
      reporter.onLog({
        type: "error",
        message: `Schema validation failed: ${errorMessage(e)}`,
      });
      reporter.onProgress({ status: "error" });
      return false;
    }
  }

  if (Object.keys(rulesMap).length === 0) {
    return true;
  }

  reporter.onLog({ type: "info", message: "Validating variables..." });
  reporter.onProgress({ status: "running", current: 0, total: 0 });

  try {
    const errors = await api.validation.validateVariables(varsMap, rulesMap);

    if (errors.length > 0) {
      reporter.onValidationErrors(errors);
      reporter.onLog({
        type: "error",
        message: `Validation failed: ${errors.length} error${errors.length > 1 ? "s" : ""}. Check the Variables section to fix.`,
      });
      errors.forEach((err) => {
        reporter.onLog({
          type: "error",
          message: err.message,
          details: `Variable: ${err.variable_name}`,
        });
      });
      reporter.onProgress({ status: "error" });
      return false;
    }
    return true;
  } catch (e) {
    reporter.onLog({
      type: "error",
      message: `Validation failed: ${errorMessage(e)}`,
    });
    reporter.onProgress({ status: "error" });
    return false;
  }
};

const mapBackendLogs = (
  result: { logs: CreateResult["logs"] },
  reporter: CreationReporter
) => {
  result.logs.forEach((log) => {
    reporter.onLog({
      type: log.log_type as "success" | "error" | "warning" | "info",
      message: log.message,
      details: log.details,
    });
  });
};

const recordHistory = async (
  inputs: CreationInputs,
  varsMap: Record<string, string>,
  rulesMap: Record<string, ValidationRule>,
  summary: ResultSummary
): Promise<void> => {
  try {
    let schemaXml = inputs.content || "";
    if (!schemaXml && inputs.tree) {
      schemaXml = await api.schema.exportSchemaXml(inputs.tree);
    }

    let templateName: string | null = null;
    if (inputs.schemaPath?.startsWith("template:")) {
      templateName = inputs.schemaPath.slice("template:".length);
    }

    await api.database.addRecentProject({
      projectName: inputs.projectName,
      outputPath: inputs.outputPath,
      schemaXml,
      variables: varsMap,
      variableValidation: rulesMap,
      templateId: null,
      templateName,
      foldersCreated: summary.folders_created,
      filesCreated: summary.files_created,
    });
  } catch (historyError) {
    // History is best-effort; never fail the creation over it
    console.warn("Failed to record project to history:", historyError);
  }
};

/**
 * Validate, then compute the diff of the Plan against disk.
 * Never writes. The caller owns the confirm gap before `create`.
 */
export const preview = async (
  inputs: CreationInputs,
  reporter: CreationReporter
): Promise<PreviewOutcome> => {
  const { varsMap, rulesMap } = buildVariableMaps(inputs.variables);

  if (!(await validateInputs(inputs, reporter, varsMap, rulesMap))) {
    return { ok: false, stage: "validation" };
  }

  if (!inputs.tree) {
    return { ok: false, stage: "diff", error: "No schema tree available" };
  }

  reporter.onDiffStart?.();

  try {
    const diff = await api.structureCreator.generateDiffPreview(
      inputs.tree,
      inputs.outputPath,
      varsMap,
      inputs.overwrite,
      inputs.projectName
    );
    return { ok: true, diff };
  } catch (e) {
    console.error("Failed to generate diff preview:", e);
    return { ok: false, stage: "diff", error: errorMessage(e) };
  }
};

/**
 * Validate and execute the creation: output-path guard, plugin file
 * processing, create, history record. `ok` means the run completed with no
 * errors and no failed hooks; `summary` is present whenever the backend ran.
 */
export const create = async (
  inputs: CreationInputs,
  reporter: CreationReporter
): Promise<CreateOutcome> => {
  const failed: CreateOutcome = { ok: false, summary: null, createdItems: null };

  try {
    if (!(await api.fileSystem.exists(inputs.outputPath))) {
      reporter.onLog({
        type: "error",
        message: "Create aborted: output path no longer exists",
      });
      reporter.onProgress({ status: "error" });
      return failed;
    }
  } catch (e) {
    reporter.onLog({
      type: "error",
      message: `Create aborted: failed to verify output path - ${errorMessage(e)}`,
    });
    reporter.onProgress({ status: "error" });
    return failed;
  }

  const { varsMap, rulesMap } = buildVariableMaps(inputs.variables);

  if (!(await validateInputs(inputs, reporter, varsMap, rulesMap))) {
    return failed;
  }

  const { tree, content } = inputs;

  reporter.onProgress({
    status: "running",
    current: 0,
    total: tree ? tree.stats.folders + tree.stats.files : 0,
  });

  try {
    reporter.onLog({ type: "info", message: "Starting structure creation..." });

    const enabledFileProcessors = inputs.plugins.filter(
      (p) => p.is_enabled && p.capabilities.includes("file-processor")
    );

    let treeToCreate = tree;

    if (enabledFileProcessors.length > 0 && tree) {
      try {
        const runtime = getPluginRuntime();
        // Reload plugins to ensure we have the latest code from disk
        await runtime.loadPlugins(enabledFileProcessors, true);

        if (runtime.hasProcessors()) {
          reporter.onLog({
            type: "info",
            message: `Processing files with ${enabledFileProcessors.length} plugin(s)...`,
          });
          treeToCreate = await processTreeContent(
            tree,
            runtime,
            varsMap,
            inputs.projectName
          );
        }
      } catch (pluginError) {
        reporter.onLog({
          type: "warning",
          message: `Plugin processing warning: ${errorMessage(pluginError)}`,
        });
        // Continue with original tree if plugin processing fails
      }
    }

    let result: CreateResult;

    // Tree-based creation carries plugin modifications (like headers)
    const useTreeCreation = treeToCreate && (treeToCreate !== tree || !content);

    if (useTreeCreation) {
      result = await api.structureCreator.createStructureFromTree(treeToCreate!, {
        outputPath: inputs.outputPath,
        variables: varsMap,
        dryRun: false,
        overwrite: inputs.overwrite,
        projectName: inputs.projectName,
      });
    } else if (content) {
      result = await api.structureCreator.createStructure(content, {
        outputPath: inputs.outputPath,
        variables: varsMap,
        dryRun: false,
        overwrite: inputs.overwrite,
        projectName: inputs.projectName,
      });
    } else {
      throw new Error("No schema available");
    }

    mapBackendLogs(result, reporter);

    const summary = result.summary;
    const hasErrors = summary.errors > 0 || summary.hooks_failed > 0;

    if (hasErrors) {
      reporter.onProgress({ status: "error" });
      const errorParts = [];
      if (summary.errors > 0) {
        errorParts.push(`${summary.errors} error(s)`);
      }
      if (summary.hooks_failed > 0) {
        errorParts.push(`${summary.hooks_failed} hook(s) failed`);
      }
      reporter.onLog({
        type: "warning",
        message: `Completed with ${errorParts.join(" and ")}`,
      });
      return { ok: false, summary, createdItems: null };
    }

    reporter.onProgress({ status: "completed" });
    const successParts = ["Structure created successfully!"];
    if (summary.hooks_executed > 0) {
      successParts.push(`${summary.hooks_executed} hook(s) executed.`);
    }
    reporter.onLog({ type: "success", message: successParts.join(" ") });

    await recordHistory(inputs, varsMap, rulesMap, summary);

    return {
      ok: true,
      summary,
      createdItems:
        result.created_items && result.created_items.length > 0
          ? result.created_items
          : null,
    };
  } catch (e) {
    console.error("Failed to create structure:", e);
    reporter.onProgress({ status: "error" });
    reporter.onLog({ type: "error", message: `Fatal error: ${e}` });
    return failed;
  }
};

/** Undo a previous creation by deleting the items it created. */
export const undo = async (
  items: CreatedItem[],
  reporter: CreationReporter
): Promise<UndoOutcome> => {
  reporter.onProgress({ status: "running", current: 0, total: 0 });
  reporter.onLog({ type: "info", message: "Undoing last structure creation..." });

  try {
    const result = await api.structureCreator.undoStructure(items, false);

    mapBackendLogs(result, reporter);

    const hasErrors = result.summary.errors > 0;
    if (hasErrors) {
      reporter.onProgress({ status: "error" });
      reporter.onLog({
        type: "warning",
        message: `Undo completed with ${result.summary.errors} error(s)`,
      });
    } else {
      reporter.onProgress({ status: "completed" });
      reporter.onLog({
        type: "success",
        message: `Undo complete: ${result.summary.files_deleted} file(s) and ${result.summary.folders_deleted} folder(s) deleted`,
      });
    }

    return { ok: !hasErrors, summary: result.summary };
  } catch (e) {
    console.error("Failed to undo structure:", e);
    reporter.onProgress({ status: "error" });
    reporter.onLog({ type: "error", message: `Undo failed: ${e}` });
    return { ok: false, summary: null };
  }
};
