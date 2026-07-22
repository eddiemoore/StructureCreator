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
import type { ResultSummary } from "../types/schema";
import { SHORTCUT_EVENTS, getShortcutLabel } from "../constants/shortcuts";
import * as creationRun from "../lib/creationRun";
import type { CreationInputs, CreationReporter } from "../lib/creationRun";
import { supports } from "../lib/capabilities";

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
  const canWatch = schemaPath && schemaPath !== "new-schema" && !schemaPath.startsWith("template:") && supports("watch");
  const canUndo = canUndoCreation() && supports("undo");

  // Ref to hold the create handler for keyboard shortcut
  const handleCreateRef = useRef<(() => void) | null>(null);

  // Ref for the auto-create handler (used in watch mode callbacks)
  // Accepts optional overrides for tree/content to use newly parsed values before state updates
  const autoCreateHandlerRef = useRef<((overrides?: { tree?: typeof schemaTree; content?: string }) => Promise<void>) | null>(null);

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

  // Reporter wiring: the creation run emits logs/progress/errors, the store holds them
  const reporter: CreationReporter = {
    onLog: addLog,
    onProgress: setProgress,
    onValidationErrors: setValidationErrors,
    onDiffStart: () => {
      setDiffLoading(true);
      setDiffError(null);
      setDiffResult(null);
      setShowDiffModal(true);
    },
  };

  // Build creation-run inputs; overrides let watch mode pass a freshly parsed
  // tree/content before React state has updated
  const buildInputs = (overrides?: { tree?: typeof schemaTree; content?: string }): CreationInputs => ({
    tree: overrides?.tree ?? schemaTree,
    content: overrides?.content ?? schemaContent,
    variables,
    outputPath: outputPath!,
    projectName,
    overwrite,
    plugins,
    schemaPath,
  });

  // Run the creation and wire results into the store
  const runCreate = async (inputs: CreationInputs) => {
    const outcome = await creationRun.create(inputs, reporter);
    setSummary(outcome.summary);
    if (outcome.ok) {
      if (outcome.createdItems) {
        setLastCreation(outcome.createdItems);
      }
      try {
        const projects = await api.database.listRecentProjects();
        setRecentProjects(projects);
      } catch (e) {
        console.warn("Failed to refresh recent projects:", e);
      }
    }
  };

  // Handle undo confirmation
  const handleUndoConfirm = async () => {
    if (!lastCreation || lastCreation.length === 0) return;

    setUndoLoading(true);
    clearLogs();

    try {
      const outcome = await creationRun.undo(lastCreation, reporter);
      // The undo ran (possibly with partial errors) — its items are spent
      if (outcome.summary) {
        setLastCreation(null);
        setSummary(null);
      }
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

    // If dry run is enabled, preview the Plan against disk instead
    if (dryRun && schemaTree) {
      const outcome = await creationRun.preview(buildInputs(), reporter);
      setDiffLoading(false);
      if (outcome.ok) {
        setDiffResult(outcome.diff);
      } else if (outcome.stage === "diff") {
        // Modal is already open (onDiffStart) - show error in modal
        setDiffError(outcome.error ?? "Failed to generate diff preview");
      }
      // Validation failures never open the modal; errors are in the log
      return;
    }

    await runCreate(buildInputs());
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

    // Auto-create handler for watch mode - an ordinary creation-run caller.
    // Overrides carry the freshly parsed tree/content before state updates;
    // the run itself guards the output path and validates.
    autoCreateHandlerRef.current = async (overrides) => {
      const effectiveTree = overrides?.tree ?? schemaTree;
      const canExecuteNow = effectiveTree && outputPath && projectName;

      if (!canExecuteNow || progress.status === "running") {
        return;
      }

      await runCreate(buildInputs(overrides));
    };
  });

  // Handle proceeding from diff preview
  const handleProceedFromDiff = async () => {
    setShowDiffModal(false);
    setDiffResult(null);
    setDiffError(null);
    setDiffLoading(false);
    // Execute the actual creation (not dry run)
    await runCreate(buildInputs());
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
