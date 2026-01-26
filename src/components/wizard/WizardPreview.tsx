import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import type { SchemaTree, SchemaNode } from "../../types/schema";
import { FolderIcon, FileIcon, ChevronRightIcon, ChevronDownIcon, HelpCircleIcon } from "../Icons";
import {
  generateNodeId,
  getTreeSignature,
  TREE_INDENT_SIZE,
  TREE_BASE_PADDING,
  PREVIEW_ICON_SIZE,
  PREVIEW_CHEVRON_SIZE,
  WIZARD_UI_STRINGS,
} from "../../utils/wizardUtils";

interface WizardPreviewProps {
  tree: SchemaTree | null;
  isLoading?: boolean;
}

/** Maximum depth to render to prevent stack overflow */
const MAX_RENDER_DEPTH = 100;

interface PreviewNodeProps {
  node: SchemaNode;
  depth: number;
  index: number;
  expandedNodes: Set<string>;
  onToggle: (id: string) => void;
}

/**
 * Get the appropriate icon for a node type.
 * Extracted as a pure function to avoid recreation on every render.
 */
const getNodeIcon = (nodeType: string) => {
  if (nodeType === "folder") {
    return <FolderIcon size={PREVIEW_ICON_SIZE} className="text-system-blue flex-shrink-0" aria-hidden="true" />;
  }
  if (nodeType === "file") {
    return <FileIcon size={PREVIEW_ICON_SIZE} className="text-text-muted flex-shrink-0" aria-hidden="true" />;
  }
  // Unknown type - show a generic icon
  return <HelpCircleIcon size={PREVIEW_ICON_SIZE} className="text-text-muted flex-shrink-0" aria-hidden="true" />;
};

/**
 * Renders a single node in the preview tree.
 * Handles folders, files, and unknown node types gracefully.
 * Note: Control flow nodes (if/else/repeat) are filtered out before reaching this component.
 *
 * @param node - The schema node to render
 * @param depth - The nesting depth (for indentation)
 * @param index - The sibling index (for stable ID generation)
 * @param expandedNodes - Set of expanded node IDs
 * @param onToggle - Callback to toggle expand/collapse
 */
const PreviewNode = ({ node, depth, index, expandedNodes, onToggle }: PreviewNodeProps) => {
  // Use sibling index for stable ID generation, not depth
  const nodeId = node.id || generateNodeId(node, index);
  const isExpanded = expandedNodes.has(nodeId);
  const hasChildren = node.children && node.children.length > 0;

  // Prevent stack overflow on very deep trees
  if (depth > MAX_RENDER_DEPTH) {
    return (
      <div
        className="text-mac-xs text-text-muted italic"
        style={{ paddingLeft: `${depth * TREE_INDENT_SIZE + TREE_BASE_PADDING}px` }}
      >
        ... (nested content truncated)
      </div>
    );
  }

  // Note: Control flow nodes (if/else/repeat) are filtered out by filterTreeByConditions
  // before the tree reaches this component, so we don't need to handle them here.

  return (
    <div>
      <div
        className="flex items-center gap-1.5 py-1 px-2 rounded-mac hover:bg-mac-bg-hover cursor-pointer focus:outline-none focus:ring-2 focus:ring-accent focus:ring-inset"
        style={{ paddingLeft: `${depth * TREE_INDENT_SIZE + TREE_BASE_PADDING}px` }}
        onClick={() => hasChildren && onToggle(nodeId)}
        role="treeitem"
        aria-expanded={hasChildren ? isExpanded : undefined}
        aria-selected={false}
        tabIndex={0}
        data-node-id={nodeId}
      >
        {/* Expand/collapse chevron */}
        {hasChildren ? (
          <button
            type="button"
            className="w-4 h-4 flex items-center justify-center text-text-muted"
            onClick={(e) => {
              e.stopPropagation();
              onToggle(nodeId);
            }}
            aria-label={isExpanded ? WIZARD_UI_STRINGS.collapse : WIZARD_UI_STRINGS.expand}
            tabIndex={-1}
          >
            {isExpanded ? (
              <ChevronDownIcon size={PREVIEW_CHEVRON_SIZE} />
            ) : (
              <ChevronRightIcon size={PREVIEW_CHEVRON_SIZE} />
            )}
          </button>
        ) : (
          <span className="w-4" aria-hidden="true" />
        )}

        {/* Icon */}
        {getNodeIcon(node.type)}

        {/* Name */}
        <span className="text-mac-xs text-text-primary truncate">{node.name}</span>
      </div>

      {/* Children */}
      {isExpanded && hasChildren && (
        <div role="group">
          {node.children!.map((child, childIndex) => (
            <PreviewNode
              key={child.id || generateNodeId(child, childIndex)}
              node={child}
              depth={depth + 1}
              index={childIndex}
              expandedNodes={expandedNodes}
              onToggle={onToggle}
            />
          ))}
        </div>
      )}
    </div>
  );
};

/**
 * Get the default expanded nodes for a tree (root + first-level folders).
 */
const getDefaultExpandedNodes = (tree: SchemaTree | null): Set<string> => {
  const set = new Set<string>();
  if (tree?.root) {
    const rootId = tree.root.id || generateNodeId(tree.root, 0);
    set.add(rootId);
    tree.root.children?.forEach((child, index) => {
      if (child.type === "folder") {
        const childId = child.id || generateNodeId(child, index);
        set.add(childId);
      }
    });
  }
  return set;
};

/**
 * WizardPreview - Displays a live preview of the schema tree structure.
 *
 * Uses tree signature comparison to detect meaningful changes and reset
 * expanded state only when the tree structure actually changes.
 */
export const WizardPreview = ({ tree, isLoading }: WizardPreviewProps) => {
  // Compute signature once per tree change using useMemo
  const treeSignature = useMemo(() => getTreeSignature(tree), [tree]);

  // Track previous signature to detect changes
  const prevTreeSignatureRef = useRef<string>(treeSignature);

  // Ref to scroll container for resetting scroll position
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Initialize expanded nodes - only computed once on mount
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(() => getDefaultExpandedNodes(tree));

  // Live region announcement for screen readers (avoids announcing entire tree)
  const [liveAnnouncement, setLiveAnnouncement] = useState<string>("");

  // Reset expanded nodes and scroll position when tree structure changes
  // Uses useEffect to properly handle the state update lifecycle
  useEffect(() => {
    if (treeSignature !== prevTreeSignatureRef.current) {
      prevTreeSignatureRef.current = treeSignature;
      setExpandedNodes(getDefaultExpandedNodes(tree));
      // Scroll to top when tree changes for consistent experience
      scrollContainerRef.current?.scrollTo({ top: 0 });
      // Announce update to screen readers
      if (tree) {
        setLiveAnnouncement(`Preview updated: ${tree.stats.folders} folders, ${tree.stats.files} files`);
      } else {
        setLiveAnnouncement("");
      }
    }
  }, [tree, treeSignature]);

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

  // Handle keyboard navigation for tree (follows WAI-ARIA tree pattern)
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const treeContainer = e.currentTarget;
    const focusableItems = treeContainer.querySelectorAll<HTMLElement>('[role="treeitem"]');
    const focusedElement = document.activeElement as HTMLElement;
    const currentIndex = Array.from(focusableItems).indexOf(focusedElement);

    if (currentIndex === -1 || focusableItems.length === 0) return;

    const nodeId = focusedElement.getAttribute("data-node-id");
    const isExpanded = nodeId ? expandedNodes.has(nodeId) : false;
    const hasChildren = focusedElement.getAttribute("aria-expanded") !== null;

    switch (e.key) {
      case "ArrowDown": {
        // Move to next visible item
        e.preventDefault();
        const nextIndex = Math.min(currentIndex + 1, focusableItems.length - 1);
        focusableItems[nextIndex]?.focus();
        break;
      }
      case "ArrowUp": {
        // Move to previous visible item
        e.preventDefault();
        const prevIndex = Math.max(currentIndex - 1, 0);
        focusableItems[prevIndex]?.focus();
        break;
      }
      case "ArrowRight": {
        e.preventDefault();
        if (hasChildren && !isExpanded) {
          // Expand closed node
          if (nodeId) handleToggle(nodeId);
        } else if (hasChildren && isExpanded) {
          // Move to first child (next visible item)
          const nextIndex = currentIndex + 1;
          if (nextIndex < focusableItems.length) {
            focusableItems[nextIndex]?.focus();
          }
        }
        // If leaf node, do nothing
        break;
      }
      case "ArrowLeft": {
        e.preventDefault();
        if (hasChildren && isExpanded) {
          // Collapse open node
          if (nodeId) handleToggle(nodeId);
        } else {
          // Move toward parent - in a flat list representation, we move to the previous item
          // which is typically the parent or a sibling. For a fully correct implementation,
          // we would need to track parent-child relationships in the DOM.
          const prevIndex = Math.max(currentIndex - 1, 0);
          focusableItems[prevIndex]?.focus();
        }
        break;
      }
      case "Home": {
        // Move to first item
        e.preventDefault();
        focusableItems[0]?.focus();
        break;
      }
      case "End": {
        // Move to last visible item
        e.preventDefault();
        focusableItems[focusableItems.length - 1]?.focus();
        break;
      }
      case "Enter":
      case " ": {
        // Toggle expand/collapse
        e.preventDefault();
        if (nodeId && hasChildren) {
          handleToggle(nodeId);
        }
        break;
      }
    }
  }, [expandedNodes, handleToggle]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted text-mac-sm relative">
        {/* Screen reader loading announcement - visually hidden */}
        <div
          role="status"
          aria-live="polite"
          style={{
            position: "absolute",
            width: "1px",
            height: "1px",
            padding: 0,
            margin: "-1px",
            overflow: "hidden",
            clip: "rect(0, 0, 0, 0)",
            whiteSpace: "nowrap",
            border: 0,
          }}
        >
          {WIZARD_UI_STRINGS.previewLoading}
        </div>
        <div className="flex items-center gap-2">
          <div
            className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin"
            aria-hidden="true"
          />
          <span>{WIZARD_UI_STRINGS.previewLoading}</span>
        </div>
      </div>
    );
  }

  if (!tree) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted text-mac-sm">
        <span>{WIZARD_UI_STRINGS.previewEmpty}</span>
      </div>
    );
  }

  return (
    <div ref={scrollContainerRef} className="h-full overflow-auto mac-scroll relative">
      {/* Screen reader announcement - visually hidden */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        style={{
          position: "absolute",
          width: "1px",
          height: "1px",
          padding: 0,
          margin: "-1px",
          overflow: "hidden",
          clip: "rect(0, 0, 0, 0)",
          whiteSpace: "nowrap",
          border: 0,
        }}
      >
        {liveAnnouncement}
      </div>

      <div
        className="py-2"
        role="tree"
        aria-label="Structure preview"
        onKeyDown={handleKeyDown}
      >
        <PreviewNode
          node={tree.root}
          depth={0}
          index={0}
          expandedNodes={expandedNodes}
          onToggle={handleToggle}
        />
      </div>

      {/* Stats */}
      <div className="px-4 py-2 border-t border-border-muted text-mac-xs text-text-muted">
        {tree.stats.folders} folder{tree.stats.folders !== 1 ? "s" : ""},{" "}
        {tree.stats.files} file{tree.stats.files !== 1 ? "s" : ""}
        {tree.stats.downloads > 0 && (
          <>, {tree.stats.downloads} download{tree.stats.downloads !== 1 ? "s" : ""}</>
        )}
      </div>
    </div>
  );
};
