import { useState } from "react";
import { useAppStore } from "../store/appStore";
import { api } from "../lib/api";
import {
  FolderPlusIcon,
  CheckIcon,
  ClockIcon,
  AlertCircleIcon,
} from "./Icons";
import { DiffPreviewModal } from "./DiffPreviewModal";
import type { CreateResult, ResultSummary, ValidationRule } from "../types/schema";

const WarningIcon = ({ size = 24, className = "" }: { size?: number; className?: string }) => (
  <svg
    className={className}
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

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
  } = useAppStore();

  const [summary, setSummary] = useState<ResultSummary | null>(null);
  const [expandedErrors, setExpandedErrors] = useState<Set<string>>(new Set());

  const canExecute = schemaTree && outputPath && projectName;

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
  const executeCreate = async (isDryRun: boolean) => {
    const { varsMap, rulesMap } = buildVariableMaps();

    setProgress({
      status: "running",
      current: 0,
      total: schemaTree!.stats.folders + schemaTree!.stats.files,
    });

    try {
      addLog({ type: "info", message: isDryRun ? "Starting dry run..." : "Starting structure creation..." });

      let result: CreateResult;

      if (schemaContent) {
        result = await api.structureCreator.createStructure(schemaContent, {
          outputPath: outputPath!,
          variables: varsMap,
          dryRun: isDryRun,
          overwrite,
        });
      } else if (schemaTree) {
        result = await api.structureCreator.createStructureFromTree(schemaTree, {
          outputPath: outputPath!,
          variables: varsMap,
          dryRun: isDryRun,
          overwrite,
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
          try {
            // Get schema XML - use schemaContent if available, or export from tree
            let schemaXml = schemaContent || "";
            if (!schemaXml && schemaTree) {
              schemaXml = await api.schema.exportSchemaXml(schemaTree);
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

  const handleCreate = async () => {
    if (!canExecute) return;

    clearLogs();
    setSummary(null);
    setExpandedErrors(new Set());
    setValidationErrors([]);

    const { varsMap, rulesMap } = buildVariableMaps();

    // Run validation first
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
    <aside className="bg-mac-sidebar flex flex-col overflow-hidden">
      {/* Action Card */}
      <div className="p-4 border-b border-border-muted">
        <div className="text-mac-xs font-medium text-text-muted mb-3">Execute</div>
        <button
          onClick={handleCreate}
          disabled={!canExecute || progress.status === "running"}
          className="mac-button-primary w-full py-3 flex items-center justify-center gap-2 text-mac-base"
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
    </aside>
  );
};
