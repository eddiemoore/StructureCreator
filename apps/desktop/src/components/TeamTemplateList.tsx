import { useState, useCallback } from "react";
import { useAppStore } from "../store/appStore";
import { api } from "../lib/api";
import { LayersIcon, DownloadIcon, CheckIcon, ChevronDownIcon } from "./Icons";
import type { TeamTemplate, DuplicateStrategy } from "../types/schema";

const STRATEGY_OPTIONS: { value: DuplicateStrategy; label: string; description: string }[] = [
  { value: "rename", label: "Rename", description: "Create with unique name if exists" },
  { value: "skip", label: "Skip", description: "Skip if template already exists" },
  { value: "replace", label: "Replace", description: "Overwrite existing template" },
];

interface TeamTemplateItemProps {
  template: TeamTemplate;
  onImport: (template: TeamTemplate) => void;
  isImporting: boolean;
  importStatus: "idle" | "success" | "error";
}

const TeamTemplateItem = ({
  template,
  onImport,
  isImporting,
  importStatus,
}: TeamTemplateItemProps) => {
  // Format file size
  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Format date
  const formatDate = (isoDate: string): string => {
    try {
      const date = new Date(isoDate);
      return date.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch {
      return isoDate;
    }
  };

  return (
    <div className="flex items-center gap-2 p-2 bg-card-bg border border-border-muted rounded-mac hover:border-border-default transition-colors group">
      <div className="w-7 h-7 bg-system-purple/10 rounded-mac flex items-center justify-center text-system-purple flex-shrink-0">
        <LayersIcon size={14} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-mac-sm font-medium text-text-primary truncate">
          {template.name}
        </div>
        <div className="text-[10px] text-text-muted truncate">
          {formatSize(template.sizeBytes)} &middot; {formatDate(template.modifiedAt)}
        </div>
      </div>
      <button
        onClick={() => onImport(template)}
        disabled={isImporting}
        className={`flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded transition-all ${
          importStatus === "success"
            ? "bg-system-green/10 text-system-green"
            : importStatus === "error"
            ? "bg-system-red/10 text-system-red"
            : "bg-accent/10 text-accent hover:bg-accent/20 opacity-0 group-hover:opacity-100"
        } disabled:opacity-50`}
        title="Import to My Templates"
      >
        {isImporting ? (
          "Importing..."
        ) : importStatus === "success" ? (
          <>
            <CheckIcon size={10} />
            Imported
          </>
        ) : importStatus === "error" ? (
          "Failed"
        ) : (
          <>
            <DownloadIcon size={10} />
            Import
          </>
        )}
      </button>
    </div>
  );
};

export const TeamTemplateList = () => {
  const {
    activeTeamLibrary,
    teamTemplates,
    teamTemplatesLoading,
    setTemplates,
    addLog,
  } = useAppStore();

  const [importingTemplates, setImportingTemplates] = useState<Set<string>>(new Set());
  const [importStatuses, setImportStatuses] = useState<Record<string, "idle" | "success" | "error">>({});
  const [duplicateStrategy, setDuplicateStrategy] = useState<DuplicateStrategy>("rename");

  const handleImport = useCallback(async (template: TeamTemplate) => {
    if (!activeTeamLibrary) return;

    setImportingTemplates((prev) => new Set(prev).add(template.filePath));
    setImportStatuses((prev) => ({ ...prev, [template.filePath]: "idle" }));

    try {
      const result = await api.teamLibrary.importTeamTemplate(
        activeTeamLibrary,
        template.filePath,
        duplicateStrategy
      );

      if (result.imported.length > 0) {
        setImportStatuses((prev) => ({ ...prev, [template.filePath]: "success" }));
        addLog({
          type: "success",
          message: `Imported "${result.imported.join(", ")}"`,
        });
        // Refresh local templates
        const templates = await api.database.listTemplates();
        setTemplates(templates);
      } else if (result.skipped.length > 0) {
        setImportStatuses((prev) => ({ ...prev, [template.filePath]: "idle" }));
        addLog({
          type: "info",
          message: `Skipped "${result.skipped.join(", ")}" (already exists)`,
        });
      } else if (result.errors.length > 0) {
        setImportStatuses((prev) => ({ ...prev, [template.filePath]: "error" }));
        addLog({
          type: "error",
          message: "Import failed",
          details: result.errors.join(", "),
        });
      }

      // Clear status after a delay
      setTimeout(() => {
        setImportStatuses((prev) => ({ ...prev, [template.filePath]: "idle" }));
      }, 3000);
    } catch (e) {
      console.error("Failed to import template:", e);
      setImportStatuses((prev) => ({ ...prev, [template.filePath]: "error" }));
      addLog({
        type: "error",
        message: `Failed to import "${template.name}"`,
        details: e instanceof Error ? e.message : String(e),
      });

      // Clear error status after a delay
      setTimeout(() => {
        setImportStatuses((prev) => ({ ...prev, [template.filePath]: "idle" }));
      }, 3000);
    } finally {
      setImportingTemplates((prev) => {
        const next = new Set(prev);
        next.delete(template.filePath);
        return next;
      });
    }
  }, [activeTeamLibrary, duplicateStrategy, setTemplates, addLog]);

  if (teamTemplatesLoading) {
    return (
      <div className="ml-4 mt-1 text-mac-xs text-text-muted">
        Scanning for templates...
      </div>
    );
  }

  if (teamTemplates.length === 0) {
    return (
      <div className="ml-4 mt-1 text-mac-xs text-text-muted">
        No .sct files found in this folder
      </div>
    );
  }

  return (
    <div className="ml-4 mt-1 space-y-1">
      {/* Duplicate Strategy Selector */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] text-text-muted">If exists:</span>
        <div className="relative">
          <select
            value={duplicateStrategy}
            onChange={(e) => setDuplicateStrategy(e.target.value as DuplicateStrategy)}
            className="appearance-none bg-card-bg border border-border-muted rounded px-2 py-0.5 pr-5 text-[10px] text-text-secondary cursor-pointer hover:border-border-default focus:border-accent focus:outline-none"
            title={STRATEGY_OPTIONS.find((o) => o.value === duplicateStrategy)?.description}
          >
            {STRATEGY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value} title={option.description}>
                {option.label}
              </option>
            ))}
          </select>
          <ChevronDownIcon
            size={10}
            className="absolute right-1 top-1/2 -translate-y-1/2 pointer-events-none text-text-muted"
          />
        </div>
      </div>

      {teamTemplates.map((template) => (
        <TeamTemplateItem
          key={template.filePath}
          template={template}
          onImport={handleImport}
          isImporting={importingTemplates.has(template.filePath)}
          importStatus={importStatuses[template.filePath] || "idle"}
        />
      ))}
    </div>
  );
};
