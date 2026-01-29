import { useRef, useLayoutEffect, useState } from "react";
import { FolderIcon, FileIcon, LoaderIcon } from "./Icons";
import type { Template, SchemaTree, SchemaNode } from "../types/schema";

interface TemplateHoverPreviewProps {
  /** The template to preview */
  template: Template;
  /** Parsed schema tree */
  schemaTree: SchemaTree | null;
  /** Whether the tree is loading */
  isLoading: boolean;
  /** The anchor element to position against */
  anchorEl: HTMLElement | null;
  /** Called when mouse enters the popover */
  onMouseEnter: () => void;
  /** Called when mouse leaves the popover */
  onMouseLeave: () => void;
}

/** Maximum depth to show in the mini tree */
const MAX_DEPTH = 2;

/** Maximum items to show at any level */
const MAX_ITEMS_PER_LEVEL = 4;

/**
 * Renders a mini tree node for the hover preview.
 */
function MiniTreeNode({
  node,
  depth,
}: {
  node: SchemaNode;
  depth: number;
}) {
  const isFolder = node.type === "folder";
  const children = node.children || [];
  const showChildren = depth < MAX_DEPTH && children.length > 0;
  // Filter to only show folder/file nodes, not control nodes
  const displayableChildren = children.filter(c => c.type === "folder" || c.type === "file");
  const visibleChildren = displayableChildren.slice(0, MAX_ITEMS_PER_LEVEL);
  const hiddenCount = displayableChildren.length - MAX_ITEMS_PER_LEVEL;

  return (
    <div>
      <div
        className="flex items-center gap-1.5 py-0.5"
        style={{ paddingLeft: `${depth * 12}px` }}
      >
        {isFolder ? (
          <FolderIcon size={12} className="text-system-blue flex-shrink-0" />
        ) : (
          <FileIcon size={12} className="text-text-muted flex-shrink-0" />
        )}
        <span className="text-mac-xs text-text-primary truncate">
          {node.name}
        </span>
      </div>
      {showChildren && (
        <div>
          {visibleChildren.map((child) => (
            <MiniTreeNode key={child.id} node={child} depth={depth + 1} />
          ))}
          {hiddenCount > 0 && (
            <div
              className="text-[10px] text-text-muted italic py-0.5"
              style={{ paddingLeft: `${(depth + 1) * 12}px` }}
            >
              +{hiddenCount} more...
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Floating popover that appears on hover over a template card.
 * Shows template details, mini tree, stats, and variables.
 */
export function TemplateHoverPreview({
  template,
  schemaTree,
  isLoading,
  anchorEl,
  onMouseEnter,
  onMouseLeave,
}: TemplateHoverPreviewProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  // Calculate position based on anchor element
  useLayoutEffect(() => {
    if (!anchorEl || !popoverRef.current) return;

    const anchorRect = anchorEl.getBoundingClientRect();
    const popoverRect = popoverRef.current.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;

    // Default: position below the anchor
    let top = anchorRect.bottom + 4;
    let left = anchorRect.left;

    // If it would overflow below, position above
    if (top + popoverRect.height > viewportHeight - 16) {
      top = anchorRect.top - popoverRect.height - 4;
    }

    // Keep within horizontal bounds
    if (left + popoverRect.width > viewportWidth - 16) {
      left = viewportWidth - popoverRect.width - 16;
    }
    if (left < 16) {
      left = 16;
    }

    // Ensure we don't go above viewport
    if (top < 16) {
      top = 16;
    }

    setPosition({ top, left });
  }, [anchorEl]);

  // Get first 3 variables with defaults
  const variableEntries = Object.entries(template.variables || {}).slice(0, 3);
  const totalVariables = Object.keys(template.variables || {}).length;

  return (
    <div
      ref={popoverRef}
      className="fixed z-50 w-[280px] max-h-[300px] bg-card-bg rounded-mac border border-border-muted shadow-mac-lg overflow-hidden"
      style={{
        top: position?.top ?? -9999,
        left: position?.left ?? -9999,
        opacity: position ? 1 : 0,
        transition: "opacity 150ms ease-out",
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {/* Header */}
      <div className="px-3 py-2 border-b border-border-muted">
        <div className="text-mac-sm font-medium text-text-primary truncate">
          {template.name}
        </div>
        {template.description && (
          <div className="text-mac-xs text-text-muted line-clamp-2 mt-0.5">
            {template.description}
          </div>
        )}
      </div>

      {/* Tree preview */}
      <div className="px-3 py-2 border-b border-border-muted max-h-[140px] overflow-y-auto mac-scroll">
        {isLoading ? (
          <div className="flex items-center justify-center py-4">
            <LoaderIcon size={20} className="text-accent animate-spin" />
          </div>
        ) : schemaTree ? (
          <MiniTreeNode node={schemaTree.root} depth={0} />
        ) : (
          <div className="text-mac-xs text-text-muted text-center py-2">
            Failed to load preview
          </div>
        )}
      </div>

      {/* Stats and variables */}
      <div className="px-3 py-2 text-mac-xs">
        {/* Stats row */}
        {schemaTree && (
          <div className="flex items-center gap-2 text-text-secondary">
            <span className="flex items-center gap-1">
              <FolderIcon size={10} className="text-system-blue" />
              {schemaTree.stats.folders} folders
            </span>
            <span className="text-text-muted">•</span>
            <span className="flex items-center gap-1">
              <FileIcon size={10} className="text-text-muted" />
              {schemaTree.stats.files} files
            </span>
          </div>
        )}

        {/* Variables preview */}
        {variableEntries.length > 0 && (
          <div className="mt-1.5 pt-1.5 border-t border-border-muted">
            <span className="text-text-muted">Variables: </span>
            <span className="text-text-secondary">
              {variableEntries.map(([name]) => `%${name}%`).join(", ")}
              {totalVariables > 3 && ` +${totalVariables - 3} more`}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
