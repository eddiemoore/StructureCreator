import { useState, useEffect, useRef, useCallback } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";
import {
  XIcon,
  ImportIcon,
  ExportIcon,
  LinkIcon,
  CheckIcon,
  LayersIcon,
} from "./Icons";
import { sanitizeFilename } from "../utils/filename";
import { URL_IMPORT_RATE_LIMIT_MS } from "../utils/constants";
import type { Template, ImportResult, DuplicateStrategy } from "../types/schema";

interface ImportExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  mode: "import" | "export" | "bulk-export";
  templates: Template[];
  selectedTemplateId?: string;
  onComplete: () => void;
}

type ImportTab = "file" | "url";

export const ImportExportModal = ({
  isOpen,
  onClose,
  mode,
  templates,
  selectedTemplateId,
  onComplete,
}: ImportExportModalProps) => {
  // Export state
  const [includeVariables, setIncludeVariables] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    selectedTemplateId ? new Set([selectedTemplateId]) : new Set(templates.map((t) => t.id))
  );

  // Import state
  const [importTab, setImportTab] = useState<ImportTab>("file");
  const [importUrl, setImportUrl] = useState("");
  const [duplicateStrategy, setDuplicateStrategy] = useState<DuplicateStrategy>("skip");
  const [importIncludeVariables, setImportIncludeVariables] = useState(true);

  // Status state
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exportSuccess, setExportSuccess] = useState<string | null>(null);

  // Track previous isOpen to detect when modal opens
  const prevIsOpenRef = useRef(false);

  // Ref for focus trap
  const modalRef = useRef<HTMLDivElement>(null);
  const lastUrlImportTime = useRef<number>(0);

  // Reset state only when modal opens (not on every templates/selection change)
  useEffect(() => {
    if (isOpen && !prevIsOpenRef.current) {
      // Modal just opened - reset all state
      setError(null);
      setResult(null);
      setExportSuccess(null);
      setImportUrl("");
      setImportTab("file");
      setDuplicateStrategy("skip");
      setImportIncludeVariables(true);
      setIncludeVariables(true);
      setSelectedIds(
        selectedTemplateId
          ? new Set([selectedTemplateId])
          : new Set(templates.map((t) => t.id))
      );
      lastUrlImportTime.current = 0; // Reset rate limit on modal open
    }
    prevIsOpenRef.current = isOpen;
  }, [isOpen, selectedTemplateId, templates]);

  // Body scroll lock when modal is open
  useEffect(() => {
    if (isOpen) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [isOpen]);

  // Handle keyboard events (escape to close, tab for focus trap)
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isProcessing) {
        onClose();
        return;
      }

      // Focus trap - keep Tab navigation within modal
      if (e.key === "Tab" && modalRef.current) {
        const focusableElements = modalRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (e.shiftKey && document.activeElement === firstElement) {
          e.preventDefault();
          lastElement?.focus();
        } else if (!e.shiftKey && document.activeElement === lastElement) {
          e.preventDefault();
          firstElement?.focus();
        }
      }
    },
    [onClose, isProcessing]
  );

  useEffect(() => {
    if (isOpen) {
      document.addEventListener("keydown", handleKeyDown);

      // Focus first focusable element when modal opens
      setTimeout(() => {
        if (modalRef.current) {
          const firstFocusable = modalRef.current.querySelector<HTMLElement>(
            'button:not([disabled]), input:not([disabled]), select:not([disabled])'
          );
          firstFocusable?.focus();
        }
      }, 0);

      return () => {
        document.removeEventListener("keydown", handleKeyDown);
      };
    }
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  const handleExport = async () => {
    setIsProcessing(true);
    setError(null);
    setExportSuccess(null);

    try {
      let jsonContent: string;
      let defaultFilename: string;
      let exportedCount: number;

      if (mode === "export" && selectedTemplateId) {
        // Single template export
        jsonContent = await invoke<string>("cmd_export_template", {
          templateId: selectedTemplateId,
          includeVariables,
        });
        const template = templates.find((t) => t.id === selectedTemplateId);
        defaultFilename = `${sanitizeFilename(template?.name || "template")}.sct`;
        exportedCount = 1;
      } else {
        // Bulk export
        const ids = Array.from(selectedIds);
        jsonContent = await invoke<string>("cmd_export_templates_bulk", {
          templateIds: ids,
          includeVariables,
        });
        defaultFilename = ids.length === 1
          ? `${sanitizeFilename(templates.find((t) => t.id === ids[0])?.name || "template")}.sct`
          : `templates-bundle.sct`;
        exportedCount = ids.length;
      }

      const savePath = await save({
        filters: [{ name: "Structure Creator Template", extensions: ["sct"] }],
        defaultPath: defaultFilename,
      });

      if (savePath) {
        await writeTextFile(savePath, jsonContent);
        onComplete();
        // Show success message
        setExportSuccess(
          exportedCount === 1
            ? "Template exported successfully"
            : `${exportedCount} templates exported successfully`
        );
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleImportFromFile = async () => {
    setIsProcessing(true);
    setError(null);
    setResult(null);

    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "Structure Creator Template", extensions: ["sct", "json"] }],
      });

      if (selected) {
        const jsonContent = await readTextFile(selected as string);
        const importResult = await invoke<ImportResult>("cmd_import_templates_from_json", {
          jsonContent,
          duplicateStrategy,
          includeVariables: importIncludeVariables,
        });
        setResult(importResult);
        onComplete();
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleImportFromUrl = async () => {
    if (!importUrl.trim()) return;

    // Rate limiting: minimum interval between URL imports
    const now = Date.now();
    const timeSinceLastImport = now - lastUrlImportTime.current;

    if (timeSinceLastImport < URL_IMPORT_RATE_LIMIT_MS) {
      const waitSeconds = Math.ceil((URL_IMPORT_RATE_LIMIT_MS - timeSinceLastImport) / 1000);
      setError(`Please wait ${waitSeconds} second(s) before importing again`);
      return;
    }

    setIsProcessing(true);
    setError(null);
    setResult(null);
    lastUrlImportTime.current = now;

    try {
      const importResult = await invoke<ImportResult>("cmd_import_templates_from_url", {
        url: importUrl.trim(),
        duplicateStrategy,
        includeVariables: importIncludeVariables,
      });
      setResult(importResult);
      onComplete();
    } catch (e) {
      setError(String(e));
    } finally {
      setIsProcessing(false);
    }
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === templates.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(templates.map((t) => t.id)));
    }
  };

  const toggleTemplate = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const renderExportContent = () => {
    // Show success state after export
    if (exportSuccess) {
      return (
        <div className="space-y-4">
          <div className="p-4 bg-card-bg rounded-mac border border-border-muted text-center">
            <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-system-green/10 flex items-center justify-center text-system-green">
              <CheckIcon size={24} />
            </div>
            <div className="text-mac-base font-medium text-text-primary mb-1">
              Export Complete
            </div>
            <div className="text-mac-sm text-text-muted">
              {exportSuccess}
            </div>
          </div>
          <div className="flex justify-end pt-2">
            <button
              onClick={onClose}
              className="mac-button-primary px-4 py-2"
            >
              Done
            </button>
          </div>
        </div>
      );
    }

    const isSingleExport = mode === "export" && selectedTemplateId;
    const template = isSingleExport
      ? templates.find((t) => t.id === selectedTemplateId)
      : null;

    return (
      <div className="space-y-4">
        {isSingleExport && template ? (
          <div className="p-3 bg-card-bg rounded-mac border border-border-muted">
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-mac flex items-center justify-center"
                style={{
                  backgroundColor: `${template.icon_color || "#0a84ff"}15`,
                  color: template.icon_color || "#0a84ff",
                }}
              >
                <LayersIcon size={20} />
              </div>
              <div>
                <div className="font-medium text-text-primary">{template.name}</div>
                <div className="text-mac-xs text-text-muted">
                  {template.description || "No description"}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-mac-sm text-text-secondary">
                Select templates to export
              </span>
              <button
                onClick={toggleSelectAll}
                className="text-mac-xs text-accent hover:underline"
              >
                {selectedIds.size === templates.length ? "Deselect All" : "Select All"}
              </button>
            </div>
            <div className="max-h-48 overflow-auto mac-scroll border border-border-muted rounded-mac">
              {templates.map((template) => (
                <label
                  key={template.id}
                  className="flex items-center gap-3 p-2 hover:bg-mac-bg-hover cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.has(template.id)}
                    onChange={() => toggleTemplate(template.id)}
                    className="w-4 h-4 rounded border-border-default text-accent focus:ring-accent"
                  />
                  <div
                    className="w-6 h-6 rounded flex items-center justify-center flex-shrink-0"
                    style={{
                      backgroundColor: `${template.icon_color || "#0a84ff"}15`,
                      color: template.icon_color || "#0a84ff",
                    }}
                  >
                    <LayersIcon size={12} />
                  </div>
                  <span className="text-mac-sm text-text-primary truncate">
                    {template.name}
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={includeVariables}
            onChange={(e) => setIncludeVariables(e.target.checked)}
            className="w-4 h-4 rounded border-border-default text-accent focus:ring-accent"
          />
          <span className="text-mac-sm text-text-secondary">Include variable values</span>
        </label>

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            className="mac-button-secondary px-4 py-2"
          >
            Cancel
          </button>
          <button
            onClick={handleExport}
            disabled={isProcessing || (mode === "bulk-export" && selectedIds.size === 0)}
            className="mac-button-primary px-4 py-2 flex items-center gap-2"
          >
            <ExportIcon size={16} />
            {isProcessing ? "Exporting..." : "Export"}
          </button>
        </div>
      </div>
    );
  };

  const renderImportContent = () => {
    if (result) {
      const totalProcessed = result.imported.length + result.skipped.length + result.errors.length;
      return (
        <div className="space-y-4">
          <div className="p-4 bg-card-bg rounded-mac border border-border-muted text-center">
            <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-system-green/10 flex items-center justify-center text-system-green">
              <CheckIcon size={24} />
            </div>
            <div className="text-mac-base font-medium text-text-primary mb-1">
              Import Complete
            </div>
            <div className="text-mac-sm text-text-muted">
              Processed {totalProcessed} template{totalProcessed !== 1 ? "s" : ""}
            </div>
          </div>

          <div className="space-y-2">
            {result.imported.length > 0 && (
              <div className="text-mac-sm">
                <span className="text-system-green font-medium">
                  {result.imported.length} imported:
                </span>{" "}
                <span className="text-text-muted">
                  {result.imported.join(", ")}
                </span>
              </div>
            )}
            {result.skipped.length > 0 && (
              <div className="text-mac-sm">
                <span className="text-system-orange font-medium">
                  {result.skipped.length} skipped:
                </span>{" "}
                <span className="text-text-muted">
                  {result.skipped.join(", ")}
                </span>
              </div>
            )}
            {result.errors.length > 0 && (
              <div className="text-mac-sm">
                <span className="text-system-red font-medium">
                  {result.errors.length} errors:
                </span>
                <ul className="list-disc list-inside text-text-muted mt-1">
                  {result.errors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="flex justify-end pt-2">
            <button
              onClick={onClose}
              className="mac-button-primary px-4 py-2"
            >
              Done
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        {/* Import Source Tabs */}
        <div className="mac-segment">
          <button
            onClick={() => setImportTab("file")}
            className={`mac-segment-button ${importTab === "file" ? "active" : ""}`}
          >
            From File
          </button>
          <button
            onClick={() => setImportTab("url")}
            className={`mac-segment-button ${importTab === "url" ? "active" : ""}`}
          >
            From URL
          </button>
        </div>

        {importTab === "file" ? (
          <div className="p-6 border-2 border-dashed border-border-muted rounded-mac text-center">
            <ImportIcon size={32} className="mx-auto mb-2 text-text-muted opacity-60" />
            <div className="text-mac-sm text-text-secondary mb-1">
              Select a .sct file to import
            </div>
            <div className="text-mac-xs text-text-muted">
              Supports single templates and bundles
            </div>
          </div>
        ) : (
          <div>
            <label className="block text-mac-xs font-medium text-text-secondary mb-1">
              Template URL
            </label>
            <div className="relative">
              <LinkIcon
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none"
              />
              <input
                type="url"
                value={importUrl}
                onChange={(e) => setImportUrl(e.target.value)}
                placeholder="https://example.com/template.sct"
                className="mac-input w-full !pl-10"
              />
            </div>
          </div>
        )}

        {/* Duplicate Handling */}
        <div>
          <label className="block text-mac-xs font-medium text-text-secondary mb-1">
            If template name already exists
          </label>
          <div className="relative">
            <select
              value={duplicateStrategy}
              onChange={(e) => setDuplicateStrategy(e.target.value as DuplicateStrategy)}
              className="mac-input w-full appearance-none cursor-pointer pr-8"
            >
              <option value="skip">Skip duplicate</option>
              <option value="replace">Replace existing</option>
              <option value="rename">Import as new (add suffix)</option>
            </select>
            <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-text-muted">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 4.5L6 7.5L9 4.5" />
              </svg>
            </div>
          </div>
        </div>

        {/* Include Variables */}
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={importIncludeVariables}
            onChange={(e) => setImportIncludeVariables(e.target.checked)}
            className="w-4 h-4 rounded border-border-default text-accent focus:ring-accent"
          />
          <span className="text-mac-sm text-text-secondary">Import variable values</span>
        </label>

        {error && (
          <div className="p-3 bg-system-red/10 border border-system-red/20 rounded-mac text-system-red text-mac-sm">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            className="mac-button-secondary px-4 py-2"
          >
            Cancel
          </button>
          <button
            onClick={importTab === "file" ? handleImportFromFile : handleImportFromUrl}
            disabled={isProcessing || (importTab === "url" && !importUrl.trim())}
            className="mac-button-primary px-4 py-2 flex items-center gap-2"
          >
            <ImportIcon size={16} />
            {isProcessing ? "Importing..." : "Import"}
          </button>
        </div>
      </div>
    );
  };

  const title = mode === "import" ? "Import Templates" : "Export Templates";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-export-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={() => !isProcessing && onClose()}
        aria-hidden="true"
      />

      {/* Modal */}
      <div
        ref={modalRef}
        className="relative bg-mac-sidebar border border-border-muted rounded-mac-lg shadow-2xl w-full max-w-md mx-4"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border-muted">
          <h2
            id="import-export-modal-title"
            className="text-mac-base font-semibold text-text-primary"
          >
            {title}
          </h2>
          <button
            onClick={() => !isProcessing && onClose()}
            disabled={isProcessing}
            aria-label="Close modal"
            className="w-6 h-6 flex items-center justify-center rounded text-text-muted hover:text-text-primary hover:bg-mac-bg-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <XIcon size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="p-4">
          {mode === "import" ? renderImportContent() : renderExportContent()}
        </div>
      </div>
    </div>
  );
};
