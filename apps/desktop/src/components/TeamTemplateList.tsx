import { useState, useCallback } from "react";
import { useAppStore } from "../store/appStore";
import { api } from "../lib/api";
import { LayersIcon } from "./Icons";
import type { TeamTemplate, DuplicateStrategy } from "../types/schema";

const DownloadIcon = ({ size = 24, className = "" }: { size?: number; className?: string }) => (
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
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

const CheckIcon = ({ size = 24, className = "" }: { size?: number; className?: string }) => (
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
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

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

  const handleImport = useCallback(async (template: TeamTemplate) => {
    if (!activeTeamLibrary) return;

    setImportingTemplates((prev) => new Set(prev).add(template.filePath));
    setImportStatuses((prev) => ({ ...prev, [template.filePath]: "idle" }));

    try {
      const strategy: DuplicateStrategy = "rename"; // Default to rename to avoid conflicts
      const result = await api.teamLibrary.importTeamTemplate(
        activeTeamLibrary,
        template.filePath,
        strategy
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
  }, [activeTeamLibrary, setTemplates, addLog]);

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
