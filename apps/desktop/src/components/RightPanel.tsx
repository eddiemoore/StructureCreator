import { useState, useRef, useLayoutEffect, useEffect, useMemo } from "react";
import { useAppStore } from "../store/appStore";
import { api } from "../lib/api";
import {
  FolderPlusIcon,
  CheckIcon,
  ClockIcon,
  AlertCircleIcon,
  EyeIcon,
  EyeOffIcon,
  WarningIcon,
  LoaderIcon,
  TrashIcon,
} from "./Icons";
import { DiffPreviewModal } from "./DiffPreviewModal";
import { ConfirmDialog } from "./ConfirmDialog";
import type { CreateResult, ResultSummary, ValidationRule, UndoResult } from "../types/schema";
import { SHORTCUT_EVENTS, getShortcutLabel } from "../constants/shortcuts";
import { getPluginRuntime, processTreeContent } from "../lib/plugins";

export const RightPanel = () => {
  const {
    schemaTree,
    schemaContent,
    schemaPath,
    outputPath,
    projectName,
    variables,
    progress,
    dryRun,
    overwrite,
    diffResult,
    diffLoading,
    diffError,
    showDiffModal,
    watchEnabled,
    watchAutoCreate,
    isWatching,
    setDryRun,
    setOverwrite,
    setDiffResult,
    setDiffLoading,
    setDiffError,
    setShowDiffModal,
    setProgress,
    addLog,
    clearLogs,
    setValidationErrors,
    setRecentProjects,
    setWatchEnabled,
    setWatchAutoCreate,
    setIsWatching,
    setSchemaContent,
    setSchemaTree,
    lastCreation,
    setLastCreation,
    canUndoCreation,
    plugins,
  } = useAppStore();

  const [summary, setSummary] = useState<ResultSummary | null>(null);
  const [expandedErrors, setExpandedErrors] = useState<Set<string>>(new Set());
  const [watchStarting, setWatchStarting] = useState(false);
  const [showUndoConfirm, setShowUndoConfirm] = useState(false);
  const [undoLoading, setUndoLoading] = useState(false);

  const canExecute = schemaTree && outputPath && projectName;
  const canWatch = schemaPath && schemaPath !== "new-schema" && !schemaPath.startsWith("template:") && api.isTauri();
  const canUndo = canUndoCreation() && api.isTauri();

  // Ref to hold the create handler for keyboard shortcut
  const handleCreateRef = useRef<(() => void) | null>(null);

  // Ref for the auto-create handler (used in watch mode callbacks)
  // Accepts optional overrides for tree/content/varsMap to use newly parsed values before state updates
  const autoCreateHandlerRef = useRef<((overrides?: { tree?: typeof schemaTree; content?: string; varsMap?: Record<string, string> }) => Promise<void>) | null>(null);

  // Keyboard shortcut subscription
  useEffect(() => {
    const handleShortcut = () => {
      if (handleCreateRef.current) {
        handleCreateRef.current();
      }
    };

    window.addEventListener(SHORTCUT_EVENTS.CREATE_STRUCTURE, handleShortcut);
    return () => {
      window.removeEventListener(SHORTCUT_EVENTS.CREATE_STRUCTURE, handleShortcut);
    };
  }, []);

  // Watch mode subscription - manages file watcher lifecycle
  useEffect(() => {
    if (!watchEnabled || !canWatch || !schemaPath) {
      return;
    }

    const unsubscribers: (() => void)[] = [];
    let mounted = true;

    // Show loading state while initializing
    setWatchStarting(true);

    // Subscribe to schema file changes
    const unsubChange = api.watch.onSchemaFileChanged(async (path, content) => {
      if (!mounted) return;

      addLog({ type: "info", message: `Schema file changed: ${path}` });

      // Parse and update the schema
      try {
        const tree = await api.schema.parseSchema(content);
        if (!mounted) return;

        setSchemaContent(content);
        setSchemaTree(tree);
        addLog({ type: "success", message: "Schema reloaded successfully" });

        // Auto-create if enabled and we have a valid setup
        // Pass the new tree/content directly since React state hasn't updated yet
        if (watchAutoCreate && autoCreateHandlerRef.current) {
          addLog({ type: "info", message: "Auto-creating structure..." });
          await autoCreateHandlerRef.current({ tree, content });
        }
      } catch (e) {
        if (!mounted) return;
        const errorMessage = e instanceof Error ? e.message : String(e);
        addLog({ type: "error", message: `Failed to parse schema: ${errorMessage}` });
      }
    });
    unsubscribers.push(unsubChange);

    // Subscribe to watch errors
    const unsubError = api.watch.onWatchError((error) => {
      if (!mounted) return;
      addLog({ type: "error", message: `Watch error: ${error}` });
      setIsWatching(false);
    });
    unsubscribers.push(unsubError);

    // Start watching the file
    api.watch.startWatch(schemaPath)
      .then(() => {
        if (!mounted) return;
        setIsWatching(true);
        setWatchStarting(false);
        addLog({ type: "success", message: `Now watching: ${schemaPath}` });
      })
      .catch((e) => {
        if (!mounted) return;
        const errorMessage = e instanceof Error ? e.message : String(e);
        addLog({ type: "error", message: `Failed to start watch: ${errorMessage}` });
        setWatchEnabled(false);
        setWatchStarting(false);
      });

    return () => {
      mounted = false;
      unsubscribers.forEach((unsub) => unsub());
      api.watch.stopWatch().catch(() => {
        // Ignore errors when stopping
      });
      setIsWatching(false);
      setWatchStarting(false);
    };
  }, [watchEnabled, schemaPath, canWatch, watchAutoCreate, addLog, setSchemaContent, setSchemaTree, setIsWatching, setWatchEnabled]);

  // Toggle watch mode
  const handleToggleWatch = () => {
    if (watchEnabled) {
      setWatchEnabled(false);
      addLog({ type: "info", message: "Watch mode disabled" });
    } else {
      setWatchEnabled(true);
    }
  };

  // Handle auto-create toggle with persistence
  const handleAutoCreateChange = async (checked: boolean) => {
    setWatchAutoCreate(checked);
    try {
      await api.database.setSetting("watchAutoCreate", String(checked));
    } catch (e) {
      console.warn("Failed to save watchAutoCreate setting:", e);
    }
  };

  const toggleErrorDetails = (id: string) => {
    setExpandedErrors((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Build variable maps from current variables
  const buildVariableMaps = () => {
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

  // Run validation and return true if valid
  const runValidation = async (varsMap: Record<string, string>, rulesMap: Record<string, ValidationRule>): Promise<boolean> => {
    if (Object.keys(rulesMap).length === 0) {
      return true;
    }

    addLog({ type: "info", message: "Validating variables..." });
    setProgress({ status: "running", current: 0, total: 0 });

    try {
      const errors = await api.validation.validateVariables(varsMap, rulesMap);

      if (errors.length > 0) {
        setValidationErrors(errors);
        addLog({
          type: "error",
          message: `Validation failed: ${errors.length} error${errors.length > 1 ? "s" : ""}. Check the Variables section to fix.`,
        });
        errors.forEach((err) => {
          addLog({
            type: "error",
            message: err.message,
            details: `Variable: ${err.variable_name}`,
          });
        });
        setProgress({ status: "error" });
        return false;
      }
      return true;
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      addLog({
        type: "error",
        message: `Validation failed: ${errorMessage}`,
      });
      setProgress({ status: "error" });
      return false;
    }
  };

  // Execute the actual structure creation
  // Optional overrides allow watch mode to pass the newly parsed tree/content
  // before React state has updated, and varsMap to avoid rebuilding it
  const executeCreate = async (
    isDryRun: boolean,
    overrides?: { tree?: typeof schemaTree; content?: string; varsMap?: Record<string, string> }
  ) => {
    const effectiveTree = overrides?.tree ?? schemaTree;
    const effectiveContent = overrides?.content ?? schemaContent;
    const { varsMap: builtVarsMap, rulesMap } = buildVariableMaps();
    const varsMap = overrides?.varsMap ?? builtVarsMap;

    setProgress({
      status: "running",
      current: 0,
      total: effectiveTree!.stats.folders + effectiveTree!.stats.files,
    });

    try {
      addLog({ type: "info", message: isDryRun ? "Starting dry run..." : "Starting structure creation..." });

      // Load and process plugins for file-processor capability
      const enabledFileProcessors = plugins.filter(
        (p) => p.isEnabled && p.capabilities.includes("file-processor")
      );

      let treeToCreate = effectiveTree;

      if (enabledFileProcessors.length > 0 && effectiveTree) {
        try {
          const runtime = getPluginRuntime();
          await runtime.loadPlugins(enabledFileProcessors);

          if (runtime.hasProcessors()) {
            addLog({ type: "info", message: `Processing files with ${enabledFileProcessors.length} plugin(s)...` });
            treeToCreate = await processTreeContent(effectiveTree, runtime, varsMap, projectName);
          }
        } catch (pluginError) {
          const message = pluginError instanceof Error ? pluginError.message : String(pluginError);
          addLog({ type: "warning", message: `Plugin processing warning: ${message}` });
          // Continue with original tree if plugin processing fails
        }
      }

      let result: CreateResult;

      if (effectiveContent) {
        result = await api.structureCreator.createStructure(effectiveContent, {
          outputPath: outputPath!,
          variables: varsMap,
          dryRun: isDryRun,
          overwrite,
          projectName,
        });
      } else if (treeToCreate) {
        result = await api.structureCreator.createStructureFromTree(treeToCreate, {
          outputPath: outputPath!,
          variables: varsMap,
          dryRun: isDryRun,
          overwrite,
          projectName,
        });
      } else {
        throw new Error("No schema available");
      }

      result.logs.forEach((log) => {
        addLog({
          type: log.log_type as "success" | "error" | "warning" | "info",
          message: log.message,
          details: log.details,
        });
      });

      setSummary(result.summary);

      const hasErrors = result.summary.errors > 0 || result.summary.hooks_failed > 0;
      if (hasErrors) {
        setProgress({ status: "error" });
        const errorParts = [];
        if (result.summary.errors > 0) {
          errorParts.push(`${result.summary.errors} error(s)`);
        }
        if (result.summary.hooks_failed > 0) {
          errorParts.push(`${result.summary.hooks_failed} hook(s) failed`);
        }
        addLog({
          type: "warning",
          message: `Completed with ${errorParts.join(" and ")}`,
        });
      } else {
        setProgress({ status: "completed" });
        const successParts = [isDryRun ? "Dry run completed!" : "Structure created successfully!"];
        if (result.summary.hooks_executed > 0) {
          successParts.push(`${result.summary.hooks_executed} hook(s) executed.`);
        }
        addLog({ type: "success", message: successParts.join(" ") });

        // Record to history for non-dry-run successful creations
        if (!isDryRun) {
          // Store created items for undo functionality
          if (result.created_items && result.created_items.length > 0) {
            setLastCreation(result.created_items);
          }

          try {
            // Get schema XML - use effectiveContent if available, or export from tree
            let schemaXml = effectiveContent || "";
            if (!schemaXml && effectiveTree) {
              schemaXml = await api.schema.exportSchemaXml(effectiveTree);
            }

            // Extract template info from schemaPath if it was loaded from a template
            let templateId: string | null = null;
            let templateName: string | null = null;
            if (schemaPath?.startsWith("template:")) {
              templateName = schemaPath.slice("template:".length);
            }

            await api.database.addRecentProject({
              projectName,
              outputPath: outputPath!,
              schemaXml,
              variables: varsMap,
              variableValidation: rulesMap,
              templateId,
              templateName,
              foldersCreated: result.summary.folders_created,
              filesCreated: result.summary.files_created,
            });

            // Refresh the recent projects list
            const projects = await api.database.listRecentProjects();
            setRecentProjects(projects);
          } catch (historyError) {
            // Don't fail the creation if history recording fails
            console.warn("Failed to record project to history:", historyError);
          }
        }
      }
    } catch (e) {
      console.error("Failed to create structure:", e);
      setProgress({ status: "error" });
      addLog({ type: "error", message: `Fatal error: ${e}` });
    }
  };

  // Handle undo confirmation
  const handleUndoConfirm = async () => {
    if (!lastCreation || lastCreation.length === 0) return;

    setUndoLoading(true);
    clearLogs();
    setProgress({ status: "running", current: 0, total: 0 });
    addLog({ type: "info", message: "Undoing last structure creation..." });

    try {
      const result: UndoResult = await api.structureCreator.undoStructure(lastCreation, false);

      // Log each operation
      result.logs.forEach((log) => {
        addLog({
          type: log.log_type as "success" | "error" | "warning" | "info",
          message: log.message,
          details: log.details,
        });
      });

      const hasErrors = result.summary.errors > 0;
      if (hasErrors) {
        setProgress({ status: "error" });
        addLog({
          type: "warning",
          message: `Undo completed with ${result.summary.errors} error(s)`,
        });
      } else {
        setProgress({ status: "completed" });
        addLog({
          type: "success",
          message: `Undo complete: ${result.summary.files_deleted} file(s) and ${result.summary.folders_deleted} folder(s) deleted`,
        });
      }

      // Clear the last creation after undo
      setLastCreation(null);
      setSummary(null);
    } catch (e) {
      console.error("Failed to undo structure:", e);
      setProgress({ status: "error" });
      addLog({ type: "error", message: `Undo failed: ${e}` });
    } finally {
      setUndoLoading(false);
      setShowUndoConfirm(false);
    }
  };

  // Memoized undo summary for dialog
  const undoSummary = useMemo(() => {
    if (!lastCreation) return { deletableFiles: 0, deletableFolders: 0, skippedCount: 0 };
    const deletable = lastCreation.filter((item) => !item.pre_existed);
    const deletableFiles = deletable.filter((item) => item.item_type === "file").length;
    const deletableFolders = deletable.filter((item) => item.item_type === "folder").length;
    const skippedCount = lastCreation.filter((item) => item.pre_existed).length;
    return { deletableFiles, deletableFolders, skippedCount };
  }, [lastCreation]);

  // Memoized undo confirmation message
  const undoConfirmMessage = useMemo(() => {
    const { deletableFiles, deletableFolders, skippedCount } = undoSummary;
    const total = deletableFiles + deletableFolders;
    let msg = `This will delete ${total} item(s) that were created:`;
    if (deletableFiles > 0) msg += ` ${deletableFiles} file(s)`;
    if (deletableFolders > 0) msg += `${deletableFiles > 0 ? " and" : ""} ${deletableFolders} folder(s)`;
    if (skippedCount > 0) {
      msg += `. ${skippedCount} overwritten item(s) will be preserved.`;
    }
    return msg;
  }, [undoSummary]);

  const handleCreate = async () => {
    if (!canExecute) return;

    clearLogs();
    setSummary(null);
    setExpandedErrors(new Set());
    setValidationErrors([]);

    const { varsMap, rulesMap } = buildVariableMaps();

    // Run schema validation first (XML syntax, undefined variables, etc.)
    if (schemaContent) {
      addLog({ type: "info", message: "Validating schema..." });
      setProgress({ status: "running", current: 0, total: 0 });

      try {
        const schemaValidation = await api.validation.validateSchema(schemaContent, varsMap);

        // Log any warnings (they don't block creation)
        for (const warning of schemaValidation.warnings) {
          addLog({
            type: "warning",
            message: warning.message,
            details: warning.nodePath ? `Path: ${warning.nodePath}` : undefined,
          });
        }

        // If there are errors, stop here
        if (!schemaValidation.isValid) {
          for (const error of schemaValidation.errors) {
            addLog({
              type: "error",
              message: error.message,
              details: error.nodePath ? `Path: ${error.nodePath}` : undefined,
            });
          }
          setProgress({ status: "error" });
          return;
        }
      } catch (e) {
        const errorMessage = e instanceof Error ? e.message : String(e);
        addLog({
          type: "error",
          message: `Schema validation failed: ${errorMessage}`,
        });
        setProgress({ status: "error" });
        return;
      }
    }

    // Run variable validation
    const isValid = await runValidation(varsMap, rulesMap);
    if (!isValid) return;

    // If dry run is enabled, generate diff preview instead
    if (dryRun && schemaTree) {
      setDiffLoading(true);
      setDiffError(null);
      setDiffResult(null);
      setShowDiffModal(true);

      try {
        const result = await api.structureCreator.generateDiffPreview(
          schemaTree,
          outputPath!,
          varsMap,
          overwrite
        );
        setDiffResult(result);
      } catch (e) {
        console.error("Failed to generate diff preview:", e);
        const errorMessage = e instanceof Error ? e.message : String(e);
        setDiffError(errorMessage);
        // Don't close modal - show error in modal instead
      } finally {
        setDiffLoading(false);
      }
      return;
    }

    // Otherwise, execute creation directly
    await executeCreate(false);
  };

  // Update refs so keyboard shortcut and watch mode can trigger create
  // Using useLayoutEffect to ensure refs are updated synchronously after render
  // before any effects that might use them. Empty deps intentional - we want this
  // to run on every render to capture the latest function references.
  useLayoutEffect(() => {
    handleCreateRef.current = () => {
      if (canExecute && progress.status !== "running") {
        handleCreate();
      }
    };

    // Auto-create handler for watch mode - skips validation UI and directly creates
    // Accepts optional overrides to use newly parsed tree/content before state updates
    autoCreateHandlerRef.current = async (overrides) => {
      // Check if we can execute - use override tree if provided for the check
      const effectiveTree = overrides?.tree ?? schemaTree;
      const canExecuteNow = effectiveTree && outputPath && projectName;

      if (!canExecuteNow || progress.status === "running") {
        return;
      }

      // Verify output path still exists before auto-creating
      try {
        const pathExists = await api.fileSystem.exists(outputPath!);
        if (!pathExists) {
          addLog({ type: "error", message: "Auto-create aborted: output path no longer exists" });
          return;
        }
      } catch (e) {
        const errorMessage = e instanceof Error ? e.message : String(e);
        addLog({ type: "error", message: `Auto-create aborted: failed to verify output path - ${errorMessage}` });
        return;
      }

      const { varsMap, rulesMap } = buildVariableMaps();

      // Run validation silently
      const isValid = await runValidation(varsMap, rulesMap);
      if (!isValid) {
        addLog({ type: "error", message: "Auto-create aborted due to validation errors" });
        return;
      }

      // Execute creation (not dry run for watch mode), passing overrides including varsMap
      await executeCreate(false, { ...overrides, varsMap });
    };
  });

  // Handle proceeding from diff preview
  const handleProceedFromDiff = async () => {
    setShowDiffModal(false);
    setDiffResult(null);
    setDiffError(null);
    setDiffLoading(false);
    // Execute the actual creation (not dry run)
    await executeCreate(false);
  };

  // Handle closing diff modal
  const handleCloseDiffModal = () => {
    setShowDiffModal(false);
    setDiffResult(null);
    setDiffError(null);
    setDiffLoading(false);
  };

  const errorCount = progress.logs.filter((l) => l.type === "error").length;

  return (
    <aside className="bg-mac-sidebar flex flex-col h-[calc(100vh-2rem)] overflow-hidden">
      {/* Action Card */}
      <div className="p-4 border-b border-border-muted">
        <div className="text-mac-xs font-medium text-text-muted mb-3">Execute</div>
        <button
          onClick={handleCreate}
          disabled={!canExecute || progress.status === "running"}
          className="mac-button-primary w-full py-3 flex items-center justify-center gap-2 text-mac-base"
          title={`Create Structure (${getShortcutLabel("CREATE_STRUCTURE")})`}
        >
          <FolderPlusIcon size={18} />
          Create Structure
        </button>
        <div className="mac-segment mt-3">
          <button
            onClick={() => setDryRun(!dryRun)}
            className={`mac-segment-button ${dryRun ? "active" : ""}`}
          >
            Dry Run
          </button>
          <button
            onClick={() => setOverwrite(!overwrite)}
            className={`mac-segment-button ${overwrite ? "active" : ""}`}
          >
            Overwrite
          </button>
        </div>

        {/* Watch Mode Controls */}
        {canWatch && (
          <div className="mt-3 pt-3 border-t border-border-subtle">
            <div className="flex items-center justify-between mb-2">
              <span className="text-mac-xs text-text-muted">Watch Mode</span>
              {watchStarting && (
                <span className="flex items-center gap-1 text-mac-xs text-system-blue">
                  <LoaderIcon size={12} className="animate-spin" />
                  Starting...
                </span>
              )}
              {isWatching && !watchStarting && (
                <span className="flex items-center gap-1 text-mac-xs text-system-green">
                  <span className="w-1.5 h-1.5 rounded-full bg-system-green animate-pulse-slow" />
                  Active
                </span>
              )}
            </div>
            <button
              onClick={handleToggleWatch}
              disabled={progress.status === "running" || watchStarting}
              className={`w-full py-2 px-3 flex items-center justify-center gap-2 text-mac-sm rounded-mac border transition-colors ${
                watchEnabled
                  ? "bg-system-blue/10 border-system-blue/30 text-system-blue"
                  : "bg-card-bg border-border-default text-text-secondary hover:bg-mac-bg-secondary"
              } ${watchStarting ? "opacity-70 cursor-not-allowed" : ""}`}
              title="Monitor schema file for changes and auto-recreate"
            >
              {watchStarting ? (
                <>
                  <LoaderIcon size={16} className="animate-spin" />
                  Starting...
                </>
              ) : watchEnabled ? (
                <>
                  <EyeIcon size={16} />
                  Stop Watching
                </>
              ) : (
                <>
                  <EyeOffIcon size={16} />
                  Watch Schema
                </>
              )}
            </button>
            {watchEnabled && (
              <label className="flex items-center gap-2 mt-2 text-mac-xs text-text-secondary cursor-pointer">
                <input
                  type="checkbox"
                  checked={watchAutoCreate}
                  onChange={(e) => handleAutoCreateChange(e.target.checked)}
                  className="rounded border-border-default"
                  disabled={watchStarting}
                />
                Auto-create on change
              </label>
            )}
          </div>
        )}

        {/* Undo Button */}
        {canUndo && (
          <div className="mt-3 pt-3 border-t border-border-subtle">
            <button
              onClick={() => setShowUndoConfirm(true)}
              disabled={progress.status === "running" || undoLoading}
              className="w-full py-2 px-3 flex items-center justify-center gap-2 text-mac-sm rounded-mac border border-system-red/30 bg-system-red/5 text-system-red hover:bg-system-red/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title="Undo the last structure creation"
            >
              <TrashIcon size={16} />
              Undo Last Creation
            </button>
            <p className="text-mac-xs text-text-muted mt-1 text-center">
              {`${undoSummary.deletableFiles} file(s), ${undoSummary.deletableFolders} folder(s)`}
            </p>
          </div>
        )}
      </div>

      {/* Summary Card */}
      {summary && (
        <div className="px-4 py-3 border-b border-border-muted">
          <div className={`grid gap-2 text-center ${(summary.hooks_executed > 0 || summary.hooks_failed > 0) ? "grid-cols-4" : "grid-cols-3"}`}>
            <div className="p-2 bg-card-bg rounded-mac border border-border-muted">
              <div className="text-mac-lg font-semibold text-system-green">
                {summary.folders_created + summary.files_created + summary.files_downloaded}
              </div>
              <div className="text-mac-xs text-text-muted">Created</div>
            </div>
            <div className="p-2 bg-card-bg rounded-mac border border-border-muted">
              <div className="text-mac-lg font-semibold text-system-orange">{summary.skipped}</div>
              <div className="text-mac-xs text-text-muted">Skipped</div>
            </div>
            <div className="p-2 bg-card-bg rounded-mac border border-border-muted">
              <div className={`text-mac-lg font-semibold ${summary.errors > 0 ? "text-system-red" : "text-text-muted"}`}>
                {summary.errors}
              </div>
              <div className="text-mac-xs text-text-muted">Errors</div>
            </div>
            {(summary.hooks_executed > 0 || summary.hooks_failed > 0) && (
              <div className="p-2 bg-card-bg rounded-mac border border-border-muted">
                <div className={`text-mac-lg font-semibold ${summary.hooks_failed > 0 ? "text-system-red" : "text-system-blue"}`}>
                  {summary.hooks_executed}/{summary.hooks_executed + summary.hooks_failed}
                </div>
                <div className="text-mac-xs text-text-muted">Hooks</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Progress Section */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-border-muted flex items-center justify-between bg-mac-bg-secondary">
          <span className="text-mac-xs font-medium text-text-muted">
            Activity Log
          </span>
          {progress.status === "running" && (
            <span className="flex items-center gap-1.5 text-mac-xs font-medium text-system-blue">
              <span className="w-1.5 h-1.5 rounded-full bg-system-blue animate-pulse-slow" />
              Creating...
            </span>
          )}
          {progress.status === "completed" && (
            <span className="flex items-center gap-1.5 text-mac-xs font-medium text-system-green">
              <CheckIcon size={12} />
              Completed
            </span>
          )}
          {progress.status === "error" && (
            <span className="flex items-center gap-1.5 text-mac-xs font-medium text-system-red">
              <AlertCircleIcon size={12} />
              {errorCount} Error{errorCount !== 1 ? "s" : ""}
            </span>
          )}
        </div>

        {/* Log Entries */}
        <div className="flex-1 overflow-auto px-4 py-3 mac-scroll bg-card-bg">
          {progress.logs.length === 0 ? (
            <div className="text-center text-text-muted text-mac-sm py-8">
              No activity yet
            </div>
          ) : (
            <div className="space-y-1">
              {progress.logs.map((log) => (
                <div
                  key={log.id}
                  className={`py-1.5 text-mac-xs border-b border-border-subtle last:border-0 ${
                    log.type === "error" ? "cursor-pointer" : ""
                  }`}
                  onClick={() => log.type === "error" && log.details && toggleErrorDetails(log.id)}
                >
                  <div className="flex items-start gap-2">
                    {log.type === "success" && (
                      <CheckIcon size={14} className="text-system-green flex-shrink-0 mt-0.5" />
                    )}
                    {log.type === "pending" && (
                      <ClockIcon size={14} className="text-system-orange flex-shrink-0 mt-0.5" />
                    )}
                    {log.type === "warning" && (
                      <WarningIcon size={14} className="text-system-orange flex-shrink-0 mt-0.5" />
                    )}
                    {log.type === "error" && (
                      <AlertCircleIcon size={14} className="text-system-red flex-shrink-0 mt-0.5" />
                    )}
                    {log.type === "info" && (
                      <div className="w-3.5 h-3.5 rounded-full border-2 border-border-default flex-shrink-0 mt-0.5" />
                    )}
                    <span
                      className={`flex-1 font-mono break-all ${
                        log.type === "error" ? "text-system-red" : "text-text-secondary"
                      }`}
                    >
                      {log.message}
                      {log.type === "error" && log.details && (
                        <span className="text-text-muted ml-1">
                          {expandedErrors.has(log.id) ? "▼" : "▶"}
                        </span>
                      )}
                    </span>
                  </div>
                  {log.type === "error" && log.details && expandedErrors.has(log.id) && (
                    <div className="mt-2 ml-6 p-2 bg-system-red/5 border border-system-red/20 rounded-mac text-mac-xs text-system-red font-mono whitespace-pre-wrap">
                      {log.details}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Diff Preview Modal - key forces remount to reset state on new diffResult */}
      <DiffPreviewModal
        key={diffResult?.root.id ?? "no-diff"}
        isOpen={showDiffModal}
        onClose={handleCloseDiffModal}
        diffResult={diffResult}
        onProceed={handleProceedFromDiff}
        isLoading={diffLoading}
        error={diffError}
      />

      {/* Undo Confirmation Dialog */}
      <ConfirmDialog
        isOpen={showUndoConfirm}
        onClose={() => setShowUndoConfirm(false)}
        onConfirm={handleUndoConfirm}
        title="Undo Last Creation"
        message={undoConfirmMessage}
        warning="This action cannot be undone. Files and folders will be permanently deleted."
        confirmLabel={undoLoading ? "Undoing..." : "Delete Items"}
        isDangerous
        isLoading={undoLoading}
      />
    </aside>
  );
};
