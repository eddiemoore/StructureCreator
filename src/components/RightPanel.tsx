import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../store/appStore";
import {
  FolderPlusIcon,
  CheckIcon,
  ClockIcon,
  AlertCircleIcon,
} from "./Icons";
import type { CreateResult, ResultSummary } from "../types/schema";

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
    outputPath,
    projectName,
    variables,
    progress,
    dryRun,
    overwrite,
    setDryRun,
    setOverwrite,
    setProgress,
    addLog,
    clearLogs,
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

  const handleCreate = async () => {
    if (!canExecute) return;

    clearLogs();
    setSummary(null);
    setExpandedErrors(new Set());
    setProgress({
      status: "running",
      current: 0,
      total: schemaTree!.stats.folders + schemaTree!.stats.files,
    });

    try {
      const varsMap: Record<string, string> = {};
      variables.forEach((v) => {
        varsMap[v.name] = v.value;
      });

      addLog({ type: "info", message: "Starting structure creation..." });

      let result: CreateResult;

      if (schemaContent) {
        result = await invoke<CreateResult>("cmd_create_structure", {
          content: schemaContent,
          outputPath,
          variables: varsMap,
          dryRun,
          overwrite,
        });
      } else if (schemaTree) {
        result = await invoke<CreateResult>("cmd_create_structure_from_tree", {
          tree: schemaTree,
          outputPath,
          variables: varsMap,
          dryRun,
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
        const successParts = ["Structure created successfully!"];
        if (result.summary.hooks_executed > 0) {
          successParts.push(`${result.summary.hooks_executed} hook(s) executed.`);
        }
        addLog({ type: "success", message: successParts.join(" ") });
      }
    } catch (e) {
      console.error("Failed to create structure:", e);
      setProgress({ status: "error" });
      addLog({ type: "error", message: `Fatal error: ${e}` });
    }
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
    </aside>
  );
};
