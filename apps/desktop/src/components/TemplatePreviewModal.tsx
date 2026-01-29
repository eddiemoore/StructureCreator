import { useState, useCallback, useRef, useEffect } from "react";
import {
  XIcon,
  FolderIcon,
  FileIcon,
  LoaderIcon,
  ChevronRightIcon,
  ChevronDownIcon,
} from "./Icons";
import type { Template, SchemaTree, SchemaNode } from "../types/schema";

interface TemplatePreviewModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** The template to preview */
  template: Template | null;
  /** Parsed schema tree */
  schemaTree: SchemaTree | null;
  /** Whether the tree is loading */
  isLoading: boolean;
  /** Called when the modal should close */
  onClose: () => void;
  /** Called when user wants to use the template */
  onUseTemplate: (template: Template) => void;
}

interface TreeNodeProps {
  node: SchemaNode;
  depth: number;
  expandedNodes: Set<string>;
  onToggle: (id: string) => void;
}

/**
 * Renders a single node in the tree view.
 */
function TreeNode({ node, depth, expandedNodes, onToggle }: TreeNodeProps) {
  const isFolder = node.type === "folder";
  const hasChildren = node.children && node.children.length > 0;
  const nodeId = node.id || `${depth}-${node.name}`;
  const isExpanded = expandedNodes.has(nodeId);

  const handleClick = useCallback(() => {
    if (hasChildren) {
      onToggle(nodeId);
    }
  }, [hasChildren, nodeId, onToggle]);

  return (
    <div role="treeitem" aria-expanded={hasChildren ? isExpanded : undefined}>
      <div
        className={`flex items-center gap-1.5 py-1 px-2 cursor-pointer rounded-mac transition-colors hover:bg-mac-bg-hover`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={handleClick}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleClick();
          }
        }}
      >
        {/* Expand/collapse chevron */}
        {hasChildren ? (
          <button
            className="w-4 h-4 flex items-center justify-center text-text-muted hover:text-text-primary"
            onClick={(e) => {
              e.stopPropagation();
              onToggle(nodeId);
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
          <FolderIcon size={14} className="text-system-blue flex-shrink-0" />
        ) : (
          <FileIcon size={14} className="text-text-muted flex-shrink-0" />
        )}

        {/* Name */}
        <span className="text-mac-sm text-text-primary truncate">{node.name}</span>

        {/* URL indicator */}
        {node.url && (
          <span className="text-[10px] text-system-purple bg-system-purple/10 px-1.5 py-0.5 rounded">
            URL
          </span>
        )}

        {/* Template indicator */}
        {node.template && (
          <span className="text-[10px] text-system-teal bg-system-teal/10 px-1.5 py-0.5 rounded">
            Template
          </span>
        )}

        {/* Repeat indicator */}
        {node.repeat_count && (
          <span className="text-[10px] text-system-orange bg-system-orange/10 px-1.5 py-0.5 rounded">
            ×{node.repeat_count}
          </span>
        )}
      </div>

      {/* Children */}
      {isExpanded && hasChildren && (
        <div role="group">
          {node.children!.map((child, index) => (
            <TreeNode
              key={child.id || `${depth + 1}-${child.name}-${index}`}
              node={child}
              depth={depth + 1}
              expandedNodes={expandedNodes}
              onToggle={onToggle}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Compute initial expanded nodes - expand root and first level
 */
function computeInitialExpanded(tree: SchemaTree | null): Set<string> {
  if (!tree) return new Set();
  const set = new Set<string>();
  const rootId = tree.root.id || `0-${tree.root.name}`;
  set.add(rootId);
  tree.root.children?.forEach((child, index) => {
    if (child.type === "folder") {
      const childId = child.id || `1-${child.name}-${index}`;
      set.add(childId);
    }
  });
  return set;
}

/**
 * Full preview modal for templates.
 * Shows complete tree view, stats, and variables.
 */
export function TemplatePreviewModal({
  isOpen,
  template,
  schemaTree,
  isLoading,
  onClose,
  onUseTemplate,
}: TemplatePreviewModalProps) {
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(() =>
    computeInitialExpanded(schemaTree)
  );
  const modalRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Reset expanded state when schema tree changes
  useEffect(() => {
    setExpandedNodes(computeInitialExpanded(schemaTree));
  }, [schemaTree]);

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

        if (focusableElements.length === 0) return;

        const firstElement = focusableElements[0] as HTMLElement;
        const lastElement = focusableElements[
          focusableElements.length - 1
        ] as HTMLElement;

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

  const handleUseTemplate = useCallback(() => {
    if (template) {
      onUseTemplate(template);
      onClose();
    }
  }, [template, onUseTemplate, onClose]);

  if (!isOpen || !template) return null;

  const variables = Object.entries(template.variables || {});

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="template-preview-title"
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
        className="relative bg-card-bg rounded-mac-lg shadow-mac-xl w-full max-w-[600px] mx-4 max-h-[80vh] overflow-hidden border border-border-muted flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-muted shrink-0">
          <div className="flex-1 min-w-0">
            <h2
              id="template-preview-title"
              className="text-mac-lg font-semibold text-text-primary truncate"
            >
              {template.name}
            </h2>
            {template.description && (
              <p className="text-mac-sm text-text-muted mt-0.5 truncate">
                {template.description}
              </p>
            )}
          </div>
          <button
            ref={closeButtonRef}
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-mac text-text-muted hover:bg-mac-bg-hover transition-colors ml-4"
            aria-label="Close dialog"
          >
            <XIcon size={16} />
          </button>
        </div>

        {/* Stats bar */}
        {schemaTree && (
          <div className="px-5 py-3 border-b border-border-muted bg-mac-bg-secondary shrink-0">
            <div className="flex items-center gap-4 text-mac-sm">
              <span className="flex items-center gap-1.5">
                <FolderIcon size={14} className="text-system-blue" />
                <span className="text-text-secondary">
                  {schemaTree.stats.folders} folder
                  {schemaTree.stats.folders !== 1 ? "s" : ""}
                </span>
              </span>
              <span className="flex items-center gap-1.5">
                <FileIcon size={14} className="text-text-muted" />
                <span className="text-text-secondary">
                  {schemaTree.stats.files} file
                  {schemaTree.stats.files !== 1 ? "s" : ""}
                </span>
              </span>
              {template.tags.length > 0 && (
                <>
                  <span className="text-text-muted">•</span>
                  <div className="flex gap-1">
                    {template.tags.map((tag) => (
                      <span
                        key={tag}
                        className="px-1.5 py-0.5 text-[10px] bg-border-muted text-text-muted rounded-full"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto mac-scroll min-h-0">
          {isLoading ? (
            <div
              className="flex items-center justify-center py-12"
              role="status"
              aria-live="polite"
            >
              <LoaderIcon size={32} className="text-accent animate-spin" />
              <span className="ml-3 text-text-secondary">Loading preview...</span>
            </div>
          ) : schemaTree ? (
            <div className="py-2" role="tree" aria-label="Template structure">
              <TreeNode
                node={schemaTree.root}
                depth={0}
                expandedNodes={expandedNodes}
                onToggle={handleToggle}
              />
            </div>
          ) : (
            <div className="flex items-center justify-center py-12 text-text-muted">
              Failed to load preview
            </div>
          )}
        </div>

        {/* Variables section */}
        {variables.length > 0 && (
          <div className="px-5 py-3 border-t border-border-muted bg-mac-bg-secondary shrink-0">
            <div className="text-mac-xs font-medium text-text-muted mb-2">
              Variables ({variables.length})
            </div>
            <div className="flex flex-wrap gap-2">
              {variables.map(([name, value]) => (
                <div
                  key={name}
                  className="flex items-center gap-1.5 px-2 py-1 bg-card-bg rounded-mac border border-border-muted"
                >
                  <span className="font-mono text-mac-xs text-system-orange">
                    %{name}%
                  </span>
                  {value && (
                    <>
                      <span className="text-text-muted text-mac-xs">=</span>
                      <span className="font-mono text-mac-xs text-text-secondary truncate max-w-[100px]">
                        {value}
                      </span>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-border-muted shrink-0">
          <button onClick={onClose} className="mac-button-secondary px-4 py-2">
            Close
          </button>
          <button
            onClick={handleUseTemplate}
            className="mac-button-primary px-4 py-2"
            disabled={isLoading}
          >
            Use Template
          </button>
        </div>
      </div>
    </div>
  );
}
