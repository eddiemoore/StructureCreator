import { useState, useEffect, useCallback, useRef } from "react";
import { XIcon, ChevronRightIcon, ChevronDownIcon, FolderIcon, FileIcon, LoaderIcon, AlertCircleIcon } from "./Icons";
import type { DiffResult, DiffNode, DiffAction, DiffHunk, DiffLineType } from "../types/schema";

interface DiffPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  diffResult: DiffResult | null;
  onProceed: () => void;
  isLoading: boolean;
  error?: string | null;
}

// Action styling configuration for tree nodes
const ACTION_STYLES: Record<DiffAction, { bg: string; text: string; badge: string; label: string }> = {
  create: {
    bg: "bg-system-green/10",
    text: "text-system-green",
    badge: "bg-system-green text-white",
    label: "NEW",
  },
  overwrite: {
    bg: "bg-system-red/10",
    text: "text-system-red",
    badge: "bg-system-red text-white",
    label: "OVERWRITE",
  },
  skip: {
    bg: "bg-system-orange/10",
    text: "text-system-orange",
    badge: "bg-system-orange text-white",
    label: "SKIP",
  },
  unchanged: {
    bg: "",
    text: "text-text-muted",
    badge: "",
    label: "",
  },
};

// Line styling configuration for diff hunks
const LINE_STYLES: Record<DiffLineType, { bg: string; text: string; prefix: string }> = {
  add: {
    bg: "bg-system-green/10",
    text: "text-system-green",
    prefix: "+",
  },
  remove: {
    bg: "bg-system-red/10",
    text: "text-system-red",
    prefix: "-",
  },
  context: {
    bg: "",
    text: "text-text-secondary",
    prefix: " ",
  },
  truncated: {
    bg: "bg-system-orange/10",
    text: "text-system-orange italic",
    prefix: "…",
  },
};

interface DiffTreeItemProps {
  node: DiffNode;
  depth: number;
  expandedNodes: Set<string>;
  selectedId: string | null;
  onToggle: (id: string) => void;
  onSelect: (node: DiffNode) => void;
}

const DiffTreeItem = ({
  node,
  depth,
  expandedNodes,
  selectedId,
  onToggle,
  onSelect,
}: DiffTreeItemProps) => {
  const isExpanded = expandedNodes.has(node.id);
  const isSelected = selectedId === node.id;
  const hasChildren = node.children && node.children.length > 0;
  const style = ACTION_STYLES[node.action];
  const isFolder = node.node_type === "folder";

  // Shared activation handler for click and keyboard
  const handleActivate = useCallback(() => {
    if (node.children && node.children.length > 0) {
      onToggle(node.id);
    }
    if (node.node_type === "file") {
      onSelect(node);
    }
  }, [node, onToggle, onSelect]);

  return (
    <div
      role="treeitem"
      aria-expanded={hasChildren ? isExpanded : undefined}
      aria-selected={isSelected}
      aria-label={`${node.name}${style.label ? `, ${style.label}` : ""}`}
    >
      <div
        className={`flex items-center gap-1.5 py-1 px-2 cursor-pointer rounded-mac transition-colors ${
          isSelected ? "bg-accent/20" : style.bg || "hover:bg-mac-bg-hover"
        }`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={handleActivate}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleActivate();
          }
        }}
      >
        {/* Expand/collapse chevron */}
        {hasChildren ? (
          <button
            className="w-4 h-4 flex items-center justify-center text-text-muted hover:text-text-primary"
            onClick={(e) => {
              e.stopPropagation();
              onToggle(node.id);
            }}
            tabIndex={-1}
            aria-hidden="true"
          >
            {isExpanded ? (
              <ChevronDownIcon size={12} />
            ) : (
              <ChevronRightIcon size={12} />
            )}
          </button>
        ) : (
          <span className="w-4" aria-hidden="true" />
        )}

        {/* Icon */}
        {isFolder ? (
          <FolderIcon size={14} className={style.text || "text-system-blue"} aria-hidden="true" />
        ) : (
          <FileIcon size={14} className={style.text || "text-text-muted"} aria-hidden="true" />
        )}

        {/* Name */}
        <span className={`text-mac-sm truncate flex-1 ${style.text}`}>
          {node.name}
        </span>

        {/* Action badge */}
        {style.label && (
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${style.badge}`} aria-hidden="true">
            {style.label}
          </span>
        )}
      </div>

      {/* Children */}
      {isExpanded && hasChildren && (
        <div role="group">
          {node.children!.map((child) => (
            <DiffTreeItem
              key={child.id}
              node={child}
              depth={depth + 1}
              expandedNodes={expandedNodes}
              selectedId={selectedId}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
};

interface DiffContentViewerProps {
  node: DiffNode | null;
}

const DiffContentViewer = ({ node }: DiffContentViewerProps) => {
  if (!node) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted text-mac-sm">
        Select a file to view details
      </div>
    );
  }

  if (node.is_binary) {
    return (
      <div className="p-4">
        <div className="text-text-muted text-mac-sm">
          Binary file - diff not available
        </div>
      </div>
    );
  }

  if (node.url) {
    return (
      <div className="p-4">
        <div className="text-mac-sm mb-2 font-medium text-text-primary">
          Content from URL:
        </div>
        <div className="font-mono text-mac-xs text-system-blue break-all">
          {node.url}
        </div>
      </div>
    );
  }

  // Show diff hunks for overwrites
  if (node.action === "overwrite" && node.diff_hunks && node.diff_hunks.length > 0) {
    return (
      <div className="p-2 overflow-auto">
        <div className="font-mono text-mac-xs">
          {node.diff_hunks.map((hunk) => (
            <DiffHunkView key={`${hunk.old_start}-${hunk.new_start}`} hunk={hunk} />
          ))}
        </div>
      </div>
    );
  }

  // Show new content for creates
  if (node.action === "create" && node.new_content) {
    return (
      <div className="p-2 overflow-auto">
        <div className="text-mac-xs text-text-muted mb-2">New file content:</div>
        <pre className="font-mono text-mac-xs text-system-green whitespace-pre-wrap break-all bg-system-green/5 p-2 rounded-mac">
          {node.new_content}
        </pre>
      </div>
    );
  }

  // Show skip info
  if (node.action === "skip") {
    return (
      <div className="p-4">
        <div className="text-text-muted text-mac-sm">
          File exists and will be skipped (overwrite is disabled)
        </div>
      </div>
    );
  }

  // Show empty file creation message
  if (node.action === "create" && !node.new_content) {
    return (
      <div className="p-4">
        <div className="text-text-muted text-mac-sm">
          Empty file will be created
        </div>
      </div>
    );
  }

  // Show overwrite without diff (identical content or diff unavailable)
  if (node.action === "overwrite") {
    return (
      <div className="p-4">
        <div className="text-text-muted text-mac-sm">
          File will be overwritten (content identical or diff unavailable)
        </div>
      </div>
    );
  }

  return (
    <div className="p-4">
      <div className="text-text-muted text-mac-sm">
        No content changes to display
      </div>
    </div>
  );
};

const DiffHunkView = ({ hunk }: { hunk: DiffHunk }) => {
  return (
    <div className="mb-4">
      <div className="text-text-muted text-[10px] mb-1 font-medium">
        @@ -{hunk.old_start},{hunk.old_count} +{hunk.new_start},{hunk.new_count} @@
      </div>
      <div className="border border-border-muted rounded-mac overflow-hidden">
        {hunk.lines.map((line, lineIndex) => {
          const style = LINE_STYLES[line.line_type];
          return (
            <div
              key={`${line.line_type}-${lineIndex}`}
              className={`${style.bg} ${style.text} px-2 py-0.5 whitespace-pre-wrap break-all`}
            >
              <span className="select-none opacity-50 mr-2">{style.prefix}</span>
              {line.content.replace(/\n$/, "")}
            </div>
          );
        })}
      </div>
    </div>
  );
};

// Compute initial expanded nodes for a diff result
const computeInitialExpanded = (result: DiffResult | null): Set<string> => {
  if (!result) return new Set<string>();
  const set = new Set<string>();
  set.add(result.root.id);
  result.root.children?.forEach((child) => {
    if (child.node_type === "folder") {
      set.add(child.id);
    }
  });
  return set;
};

export const DiffPreviewModal = ({
  isOpen,
  onClose,
  diffResult,
  onProceed,
  isLoading,
  error,
}: DiffPreviewModalProps) => {
  // State initialized via lazy initializer - use key prop in parent to reset on new diffResult
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(() =>
    computeInitialExpanded(diffResult)
  );
  const [selectedNode, setSelectedNode] = useState<DiffNode | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Focus trap and escape key handling
  useEffect(() => {
    if (!isOpen) return;

    // Focus the close button when modal opens
    closeButtonRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }

      // Simple focus trap - Tab cycles within modal
      if (e.key === "Tab" && modalRef.current) {
        const focusableElements = modalRef.current.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );

        // Guard against empty focusable elements
        if (focusableElements.length === 0) return;

        const firstElement = focusableElements[0] as HTMLElement;
        const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;

        if (e.shiftKey && document.activeElement === firstElement) {
          e.preventDefault();
          lastElement?.focus();
        } else if (!e.shiftKey && document.activeElement === lastElement) {
          e.preventDefault();
          firstElement?.focus();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const handleToggle = useCallback((id: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleSelect = useCallback((node: DiffNode) => {
    setSelectedNode(node);
  }, []);

  if (!isOpen) return null;

  const summary = diffResult?.summary;
  const hasChanges = summary ? (summary.creates > 0 || summary.overwrites > 0) : false;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="diff-preview-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal */}
      <div
        ref={modalRef}
        className="relative bg-card-bg rounded-mac-lg shadow-mac-xl w-full max-w-[800px] mx-4 max-h-[85vh] overflow-hidden border border-border-muted flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-muted shrink-0">
          <h2 id="diff-preview-title" className="text-mac-lg font-semibold text-text-primary">
            Diff Preview
          </h2>
          <button
            ref={closeButtonRef}
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-mac text-text-muted hover:bg-mac-bg-hover transition-colors"
            aria-label="Close dialog"
          >
            <XIcon size={16} />
          </button>
        </div>

        {/* Loading state */}
        {isLoading && (
          <div className="flex-1 flex items-center justify-center p-8" role="status" aria-live="polite">
            <LoaderIcon size={32} className="text-accent animate-spin" />
            <span className="ml-3 text-text-secondary">Analyzing changes...</span>
          </div>
        )}

        {/* Error state */}
        {!isLoading && error && (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
            <AlertCircleIcon size={48} className="text-system-red mb-4" />
            <h3 className="text-mac-base font-medium text-text-primary mb-2">
              Failed to generate diff preview
            </h3>
            <p className="text-mac-sm text-text-muted max-w-md mb-4">
              {error}
            </p>
            <button
              onClick={onClose}
              className="mac-button-secondary px-4 py-2"
            >
              Close
            </button>
          </div>
        )}

        {/* Content */}
        {!isLoading && !error && diffResult && (
          <>
            {/* Summary bar */}
            <div className="px-5 py-3 border-b border-border-muted bg-mac-bg-secondary shrink-0">
              <div className="flex items-center gap-4 text-mac-sm">
                {/* Show total count */}
                {summary && (
                  <span className="text-text-muted">
                    {summary.total_items} item{summary.total_items !== 1 ? "s" : ""}:
                  </span>
                )}
                {summary && summary.creates > 0 && (
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-system-green" aria-hidden="true" />
                    <span className="text-text-secondary">
                      {summary.creates} new {summary.creates === 1 ? "file" : "files"}
                    </span>
                  </span>
                )}
                {summary && summary.overwrites > 0 && (
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-system-red" aria-hidden="true" />
                    <span className="text-text-secondary">
                      {summary.overwrites} to overwrite
                    </span>
                  </span>
                )}
                {summary && summary.skips > 0 && (
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-system-orange" aria-hidden="true" />
                    <span className="text-text-secondary">
                      {summary.skips} skipped
                    </span>
                  </span>
                )}
                {summary && summary.unchanged_folders > 0 && (
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-text-muted" aria-hidden="true" />
                    <span className="text-text-muted">
                      {summary.unchanged_folders} existing {summary.unchanged_folders === 1 ? "folder" : "folders"}
                    </span>
                  </span>
                )}
                {/* Show message when no actionable changes */}
                {summary && summary.creates === 0 && summary.overwrites === 0 && summary.skips === 0 && (
                  <span className="text-text-muted italic">No changes to make</span>
                )}
              </div>
              {/* Warnings */}
              {summary && summary.warnings && summary.warnings.length > 0 && (
                <div className="mt-2 text-mac-xs text-system-orange">
                  {summary.warnings.map((warning, idx) => (
                    <div key={`warning-${idx}`} className="flex items-start gap-1.5">
                      <AlertCircleIcon size={12} className="flex-shrink-0 mt-0.5" aria-hidden="true" />
                      <span>{warning}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Split pane */}
            <div className="flex-1 flex min-h-0">
              {/* Tree panel */}
              <div
                className="w-[320px] min-w-[200px] shrink-0 border-r border-border-muted overflow-y-auto mac-scroll"
                role="tree"
                aria-label="File changes tree"
              >
                <div className="py-2">
                  <DiffTreeItem
                    node={diffResult.root}
                    depth={0}
                    expandedNodes={expandedNodes}
                    selectedId={selectedNode?.id ?? null}
                    onToggle={handleToggle}
                    onSelect={handleSelect}
                  />
                </div>
              </div>

              {/* Content panel */}
              <div
                className="flex-1 overflow-y-auto mac-scroll bg-mac-bg"
                role="region"
                aria-label="File content preview"
              >
                <DiffContentViewer node={selectedNode} />
              </div>
            </div>
          </>
        )}

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-border-muted shrink-0">
          <button
            onClick={onClose}
            className="mac-button-secondary px-4 py-2"
            disabled={isLoading}
          >
            Cancel
          </button>
          <button
            onClick={onProceed}
            className="mac-button-primary px-4 py-2"
            disabled={isLoading || !diffResult || !hasChanges}
            title={!hasChanges ? "No changes to apply" : undefined}
          >
            Proceed
          </button>
        </div>
      </div>
    </div>
  );
};
