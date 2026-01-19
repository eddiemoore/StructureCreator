import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../store/appStore";
import {
  BoltIcon,
  FolderPlusIcon,
  CheckIcon,
  ClockIcon,
  AlertCircleIcon,
} from "./Icons";
import type { CreateResult, ResultSummary, SchemaTree } from "../types/schema";

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
        // Use XML content directly
        result = await invoke<CreateResult>("cmd_create_structure", {
          content: schemaContent,
          outputPath,
          variables: varsMap,
          dryRun,
          overwrite,
        });
      } else if (schemaTree) {
        // Use schema tree directly (preserves file contents from folder scan)
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

      // Process logs from backend
      result.logs.forEach((log) => {
        addLog({
          type: log.log_type as "success" | "error" | "warning" | "info",
          message: log.message,
          details: log.details,
        });
      });

      setSummary(result.summary);

      if (result.summary.errors > 0) {
        setProgress({ status: "error" });
        addLog({
          type: "warning",
          message: `Completed with ${result.summary.errors} error(s)`,
        });
      } else {
        setProgress({ status: "completed" });
        addLog({ type: "success", message: "Structure created successfully!" });
      }
    } catch (e) {
      console.error("Failed to create structure:", e);
      setProgress({ status: "error" });
      addLog({ type: "error", message: `Fatal error: ${e}` });
    }
  };

  const errorCount = progress.logs.filter((l) => l.type === "error").length;

  return (
    <aside className="bg-bg-primary flex flex-col overflow-hidden">
      {/* Action Card */}
      <div className="p-5 border-b border-border-muted">
        <div className="flex items-center gap-2.5 text-sm font-semibold mb-4">
          <BoltIcon size={18} />
          Execute
        </div>
        <button
          onClick={handleCreate}
          disabled={!canExecute || progress.status === "running"}
          className="w-full py-3.5 px-5 bg-gradient-to-r from-cyan-primary to-cyan-muted text-bg-deep font-semibold rounded-lg flex items-center justify-center gap-2.5 hover:shadow-[0_4px_20px_rgba(34,211,238,0.15),0_0_40px_rgba(34,211,238,0.15)] hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none"
        >
          <FolderPlusIcon size={18} />
          Create Structure
        </button>
        <div className="flex gap-2 mt-3">
          <button
            onClick={() => setDryRun(!dryRun)}
            className={`flex-1 py-2.5 text-[11px] font-medium rounded-md border transition-all ${
              dryRun
                ? "bg-cyan-primary/10 border-cyan-muted text-cyan-primary"
                : "bg-bg-secondary border-border-default text-text-secondary hover:border-cyan-muted"
            }`}
          >
            Dry Run
          </button>
          <button
            onClick={() => setOverwrite(!overwrite)}
            className={`flex-1 py-2.5 text-[11px] font-medium rounded-md border transition-all ${
              overwrite
                ? "bg-cyan-primary/10 border-cyan-muted text-cyan-primary"
                : "bg-bg-secondary border-border-default text-text-secondary hover:border-cyan-muted"
            }`}
          >
            Overwrite
          </button>
        </div>
      </div>

      {/* Summary Card */}
      {summary && (
        <div className="px-4 py-3 border-b border-border-muted">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="p-2 bg-bg-secondary rounded-md">
              <div className="text-lg font-bold text-green-400">
                {summary.folders_created + summary.files_created + summary.files_downloaded}
              </div>
              <div className="text-[10px] text-text-muted">Created</div>
            </div>
            <div className="p-2 bg-bg-secondary rounded-md">
              <div className="text-lg font-bold text-amber-400">{summary.skipped}</div>
              <div className="text-[10px] text-text-muted">Skipped</div>
            </div>
            <div className="p-2 bg-bg-secondary rounded-md">
              <div className={`text-lg font-bold ${summary.errors > 0 ? "text-red-400" : "text-text-muted"}`}>
                {summary.errors}
              </div>
              <div className="text-[10px] text-text-muted">Errors</div>
            </div>
          </div>
        </div>
      )}

      {/* Progress Section */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-border-muted flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
            Activity Log
          </span>
          {progress.status === "running" && (
            <span className="flex items-center gap-1.5 text-[11px] font-medium text-cyan-primary">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-primary animate-pulse-slow" />
              Creating...
            </span>
          )}
          {progress.status === "completed" && (
            <span className="flex items-center gap-1.5 text-[11px] font-medium text-green-400">
              <CheckIcon size={12} />
              Completed
            </span>
          )}
          {progress.status === "error" && (
            <span className="flex items-center gap-1.5 text-[11px] font-medium text-red-400">
              <AlertCircleIcon size={12} />
              {errorCount} Error{errorCount !== 1 ? "s" : ""}
            </span>
          )}
        </div>

        {/* Log Entries */}
        <div className="flex-1 overflow-auto px-4 py-3">
          {progress.logs.length === 0 ? (
            <div className="text-center text-text-muted text-xs py-8">
              No activity yet
            </div>
          ) : (
            <div className="space-y-1">
              {progress.logs.map((log) => (
                <div
                  key={log.id}
                  className={`py-1.5 text-[11px] border-b border-border-muted last:border-0 ${
                    log.type === "error" ? "cursor-pointer" : ""
                  }`}
                  onClick={() => log.type === "error" && log.details && toggleErrorDetails(log.id)}
                >
                  <div className="flex items-start gap-2">
                    {log.type === "success" && (
                      <CheckIcon size={14} className="text-green-400 flex-shrink-0 mt-0.5" />
                    )}
                    {log.type === "pending" && (
                      <ClockIcon size={14} className="text-amber-400 flex-shrink-0 mt-0.5" />
                    )}
                    {log.type === "warning" && (
                      <WarningIcon size={14} className="text-amber-400 flex-shrink-0 mt-0.5" />
                    )}
                    {log.type === "error" && (
                      <AlertCircleIcon size={14} className="text-red-400 flex-shrink-0 mt-0.5" />
                    )}
                    {log.type === "info" && (
                      <div className="w-3.5 h-3.5 rounded-full border-2 border-text-muted flex-shrink-0 mt-0.5" />
                    )}
                    <span
                      className={`flex-1 font-mono break-all ${
                        log.type === "error" ? "text-red-300" : "text-text-secondary"
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
                  {/* Expanded error details */}
                  {log.type === "error" && log.details && expandedErrors.has(log.id) && (
                    <div className="mt-2 ml-6 p-2 bg-red-950/30 border border-red-900/50 rounded text-[10px] text-red-200 font-mono whitespace-pre-wrap">
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
