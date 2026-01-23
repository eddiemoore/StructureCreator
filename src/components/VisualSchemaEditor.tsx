import { useState, useRef, useEffect, useId } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { useAppStore } from "../store/appStore";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { FolderIcon, FileIcon, PlusIcon, TrashIcon, SaveIcon, BranchIcon, GitMergeIcon, RepeatIcon } from "./Icons";
import type { SchemaNode, NodeType } from "../types/schema";
import { findNode, findParent, canHaveChildren, INDENT_PX } from "../utils/schemaTree";
import { sanitizeVariableName, validateVariableName, validateRepeatCount } from "../utils/validation";

/** Default condition variable name for new if blocks */
const DEFAULT_CONDITION_VAR = "CONDITION";

/** Default repeat count for new repeat blocks */
const DEFAULT_REPEAT_COUNT = "1";

/** Default iteration variable name for repeat blocks */
const DEFAULT_REPEAT_AS = "i";

/** Icon and text style configuration for drag overlay by node type */
const DRAG_OVERLAY_STYLES: Record<NodeType, { iconClass: string; textClass: string }> = {
  folder: {
    iconClass: "text-system-blue",
    textClass: "font-medium text-text-primary",
  },
  file: {
    iconClass: "text-text-muted",
    textClass: "text-text-secondary",
  },
  if: {
    iconClass: "text-system-orange",
    textClass: "font-semibold text-system-orange",
  },
  else: {
    iconClass: "text-system-purple",
    textClass: "font-semibold text-system-purple",
  },
  repeat: {
    iconClass: "text-system-green",
    textClass: "font-semibold text-system-green",
  },
};

interface EditableTreeItemProps {
  node: SchemaNode;
  depth: number;
  onUpdate: (nodeId: string, updates: Partial<SchemaNode>) => void;
  onRemove: (nodeId: string) => void;
  onAdd: (parentId: string, type: NodeType, conditionVar?: string) => void;
  projectName: string;
  datalistId: string;
}

const EditableTreeItem = ({
  node,
  depth,
  onUpdate,
  onRemove,
  onAdd,
  projectName,
  datalistId,
}: EditableTreeItemProps) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(node.name);
  const [isEditingCondition, setIsEditingCondition] = useState(false);
  const [conditionValue, setConditionValue] = useState(node.condition_var || "");
  const [isEditingRepeatCount, setIsEditingRepeatCount] = useState(false);
  const [repeatCountValue, setRepeatCountValue] = useState(node.repeat_count || DEFAULT_REPEAT_COUNT);
  const [isEditingRepeatAs, setIsEditingRepeatAs] = useState(false);
  const [repeatAsValue, setRepeatAsValue] = useState(node.repeat_as || DEFAULT_REPEAT_AS);

  // Sync local state when node props change (e.g., from undo/redo or external updates)
  useEffect(() => {
    if (!isEditing) setEditValue(node.name);
  }, [node.name, isEditing]);

  useEffect(() => {
    if (!isEditingCondition) setConditionValue(node.condition_var || "");
  }, [node.condition_var, isEditingCondition]);

  useEffect(() => {
    if (!isEditingRepeatCount) setRepeatCountValue(node.repeat_count || DEFAULT_REPEAT_COUNT);
  }, [node.repeat_count, isEditingRepeatCount]);

  useEffect(() => {
    if (!isEditingRepeatAs) setRepeatAsValue(node.repeat_as || DEFAULT_REPEAT_AS);
  }, [node.repeat_as, isEditingRepeatAs]);
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [contextMenuPos, setContextMenuPos] = useState({ x: 0, y: 0 });
  const [isExpanded, setIsExpanded] = useState(true);
  const [sanitizationMessage, setSanitizationMessage] = useState("");
  const [repeatCountError, setRepeatCountError] = useState<string | null>(null);
  const [repeatAsError, setRepeatAsError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const conditionInputRef = useRef<HTMLInputElement>(null);
  const repeatCountInputRef = useRef<HTMLInputElement>(null);
  const repeatAsInputRef = useRef<HTMLInputElement>(null);
  const animationFrameRef = useRef<number | null>(null);

  // Cleanup animation frame on unmount
  useEffect(() => {
    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  // Compute node type flags early since useSortable needs isElse
  const isFolder = node.type === "folder";
  const isIf = node.type === "if";
  const isElse = node.type === "else";
  const isRepeat = node.type === "repeat";
  const isConditional = isIf || isElse;
  const isContainer = isFolder || isConditional || isRepeat;

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: node.id!,
    disabled: isElse, // Else nodes move with their parent if block
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  useEffect(() => {
    if (isEditingCondition && conditionInputRef.current) {
      conditionInputRef.current.focus();
      conditionInputRef.current.select();
    }
  }, [isEditingCondition]);

  useEffect(() => {
    if (isEditingRepeatCount && repeatCountInputRef.current) {
      repeatCountInputRef.current.focus();
      repeatCountInputRef.current.select();
    }
  }, [isEditingRepeatCount]);

  useEffect(() => {
    if (isEditingRepeatAs && repeatAsInputRef.current) {
      repeatAsInputRef.current.focus();
      repeatAsInputRef.current.select();
    }
  }, [isEditingRepeatAs]);

  const handleDoubleClick = () => {
    // For if/else/repeat nodes, don't allow name editing via double-click
    if (node.type === "if" || node.type === "else" || node.type === "repeat") return;
    setIsEditing(true);
    setEditValue(node.name);
  };

  // Repeat count editing handlers
  const handleRepeatCountSave = () => {
    const trimmedValue = repeatCountValue.trim() || DEFAULT_REPEAT_COUNT;
    const error = validateRepeatCount(trimmedValue);
    if (error) {
      // Keep editing if there's an error
      setRepeatCountError(error);
      return;
    }
    if (trimmedValue !== (node.repeat_count || DEFAULT_REPEAT_COUNT)) {
      onUpdate(node.id!, { repeat_count: trimmedValue });
    }
    setRepeatCountValue(trimmedValue);
    setIsEditingRepeatCount(false);
    setRepeatCountError(null);
  };

  const handleRepeatCountKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      handleRepeatCountSave();
    } else if (e.key === "Escape") {
      setIsEditingRepeatCount(false);
      setRepeatCountValue(node.repeat_count || DEFAULT_REPEAT_COUNT);
      setRepeatCountError(null);
    }
  };

  // Validate repeat count on change for real-time feedback
  const handleRepeatCountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setRepeatCountValue(value);
    const error = validateRepeatCount(value);
    setRepeatCountError(error);
  };

  // Repeat "as" variable editing handlers
  const handleRepeatAsSave = () => {
    const sanitized = sanitizeVariableName(repeatAsValue) || DEFAULT_REPEAT_AS;
    const error = validateVariableName(sanitized);
    if (error) {
      // Keep editing if there's an error
      setRepeatAsError(error);
      return;
    }
    if (sanitized !== (node.repeat_as || DEFAULT_REPEAT_AS)) {
      onUpdate(node.id!, { repeat_as: sanitized });
    }
    setRepeatAsValue(sanitized);
    setIsEditingRepeatAs(false);
    setSanitizationMessage("");
    setRepeatAsError(null);
  };

  const handleRepeatAsKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      handleRepeatAsSave();
    } else if (e.key === "Escape") {
      setIsEditingRepeatAs(false);
      setRepeatAsValue(node.repeat_as || DEFAULT_REPEAT_AS);
      setSanitizationMessage("");
      setRepeatAsError(null);
    }
  };

  // Validate repeat-as variable name on change for real-time feedback
  const handleRepeatAsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    const sanitized = sanitizeVariableName(raw);
    setRepeatAsValue(sanitized);

    // Check for invalid characters being stripped
    if (raw.length > sanitized.length) {
      setSanitizationMessage("Invalid characters removed. Only letters, numbers, and underscores are allowed.");
    } else {
      setSanitizationMessage("");
    }

    // Validate the sanitized value
    const error = validateVariableName(sanitized);
    setRepeatAsError(error);
  };

  const startConditionEditing = () => {
    if (node.type === "if") {
      setIsEditingCondition(true);
      setConditionValue(node.condition_var || "");
    }
  };

  const handleConditionDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    startConditionEditing();
  };

  const handleConditionSave = () => {
    // Cancel any pending RAF from Enter key to prevent double-save race condition
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    const sanitizedValue = sanitizeVariableName(conditionValue);
    if (sanitizedValue !== (node.condition_var || "")) {
      onUpdate(node.id!, { condition_var: sanitizedValue || undefined });
    }
    setConditionValue(sanitizedValue);
    setIsEditingCondition(false);
    setSanitizationMessage("");
  };

  const handleConditionKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      // Don't preventDefault - let browser handle datalist selection first
      // Use requestAnimationFrame to read value after browser updates it
      // Store ID so it can be cancelled on unmount
      animationFrameRef.current = requestAnimationFrame(() => {
        animationFrameRef.current = null;
        const sanitizedValue = sanitizeVariableName(conditionInputRef.current?.value || "");
        if (sanitizedValue !== (node.condition_var || "")) {
          onUpdate(node.id!, { condition_var: sanitizedValue || undefined });
        }
        setConditionValue(sanitizedValue);
        setIsEditingCondition(false);
        setSanitizationMessage("");
      });
    } else if (e.key === "Escape") {
      setIsEditingCondition(false);
      setConditionValue(node.condition_var || "");
      setSanitizationMessage("");
    }
  };

  const handleSave = () => {
    if (editValue.trim() && editValue !== node.name) {
      onUpdate(node.id!, { name: editValue.trim() });
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      handleSave();
    } else if (e.key === "Escape") {
      setIsEditing(false);
      setEditValue(node.name);
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    // Clamp position to keep menu visible within viewport
    // Estimated menu dimensions: 160px wide, 250px tall (max)
    const menuWidth = 160;
    const menuHeight = 250;
    const x = Math.min(e.clientX, window.innerWidth - menuWidth - 8);
    const y = Math.min(e.clientY, window.innerHeight - menuHeight - 8);
    setContextMenuPos({ x: Math.max(8, x), y: Math.max(8, y) });
    setShowContextMenu(true);
  };

  const handleKeyboardContextMenu = (e: React.KeyboardEvent) => {
    // Open context menu on Shift+F10, ContextMenu key, or Apps key
    // Note: keyCode is deprecated but included for legacy browser compatibility
    const isContextMenuKey = e.key === "ContextMenu" || e.code === "ContextMenu" || e.keyCode === 93;
    if ((e.shiftKey && e.key === "F10") || isContextMenuKey) {
      e.preventDefault();
      // Position menu near the element, clamped to viewport
      const rect = e.currentTarget.getBoundingClientRect();
      const menuWidth = 160;
      const menuHeight = 250;
      const x = Math.min(rect.left + 20, window.innerWidth - menuWidth - 8);
      const y = Math.min(rect.top + 20, window.innerHeight - menuHeight - 8);
      setContextMenuPos({ x: Math.max(8, x), y: Math.max(8, y) });
      setShowContextMenu(true);
    }
  };

  useEffect(() => {
    const handleClickOutside = () => setShowContextMenu(false);
    if (showContextMenu) {
      document.addEventListener("click", handleClickOutside);
      return () => document.removeEventListener("click", handleClickOutside);
    }
  }, [showContextMenu]);

  const displayName =
    node.name === "%BASE%"
      ? projectName
      : node.name.replace(/%BASE%/g, projectName);

  const hasChildren = node.children && node.children.length > 0;

  // Check if adding an else block would be valid (last child must be if or else)
  const lastChild = node.children?.[node.children.length - 1];
  // Only allow adding else immediately after an if block (not after another else)
  const canAddElse = lastChild?.type === "if";

  return (
    <>
      <div
        ref={setNodeRef}
        style={style}
        className="relative"
        onContextMenu={handleContextMenu}
        onKeyDown={handleKeyboardContextMenu}
      >
        <div
          className={`flex items-center gap-2 px-2 py-1.5 rounded-mac hover:bg-mac-bg-hover transition-colors group ${
            isConditional
              ? `border-l-2 ${isIf ? "border-system-orange" : "border-system-purple"} ${isElse ? "cursor-default" : "cursor-pointer"}`
              : isRepeat
              ? "border-l-2 border-system-green cursor-pointer"
              : "cursor-pointer"
          }`}
          style={{ marginLeft: `${depth * INDENT_PX}px` }}
          {...attributes}
          {...(isElse ? {} : listeners)}
        >
          {/* Expand/collapse arrow for nodes that can have children */}
          {isContainer && hasChildren && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsExpanded(!isExpanded);
              }}
              aria-label={isExpanded ? "Collapse" : "Expand"}
              aria-expanded={isExpanded}
              className="w-4 h-4 flex items-center justify-center text-text-muted hover:text-text-primary"
            >
              <span className={`transform transition-transform ${isExpanded ? "rotate-90" : ""}`}>
                ▶
              </span>
            </button>
          )}
          {(!isContainer || !hasChildren) && <div className="w-4" />}

          {/* Icon */}
          {isFolder ? (
            <FolderIcon size={16} className="text-system-blue flex-shrink-0" />
          ) : isIf ? (
            <BranchIcon size={16} className="text-system-orange flex-shrink-0" />
          ) : isElse ? (
            <GitMergeIcon size={16} className="text-system-purple flex-shrink-0" />
          ) : isRepeat ? (
            <RepeatIcon size={16} className="text-system-green flex-shrink-0" />
          ) : (
            <FileIcon size={16} className="text-text-muted flex-shrink-0" />
          )}

          {/* Name/Label display */}
          {isConditional ? (
            // Conditional node display
            <div className="flex items-center gap-1.5 flex-1 font-mono text-mac-sm">
              <span className={`font-semibold ${isIf ? "text-system-orange" : "text-system-purple"}`}>
                {isIf ? "if" : "else"}
              </span>
              {isIf && (
                isEditingCondition ? (
                  <>
                    <input
                      ref={conditionInputRef}
                      type="text"
                      value={conditionValue}
                      onChange={(e) => {
                        const raw = e.target.value;
                        const sanitized = sanitizeVariableName(raw);
                        setConditionValue(sanitized);
                        // Notify if characters were removed
                        if (raw.length > sanitized.length) {
                          setSanitizationMessage("Invalid characters removed. Only letters, numbers, and underscores are allowed.");
                        } else {
                          setSanitizationMessage("");
                        }
                      }}
                      onBlur={handleConditionSave}
                      onKeyDown={handleConditionKeyDown}
                      placeholder="VARIABLE"
                      list={datalistId}
                      aria-describedby={sanitizationMessage ? `sanitization-feedback-${node.id}` : undefined}
                      className={`flex-1 bg-mac-bg border rounded px-1 py-0.5 text-mac-sm font-mono outline-none max-w-[150px] ${
                        sanitizationMessage ? "border-system-red" : "border-accent"
                      }`}
                      title={sanitizationMessage || undefined}
                    />
                    {/* Visible feedback when characters are sanitized */}
                    {sanitizationMessage && (
                      <span className="text-system-red text-mac-xs" title={sanitizationMessage}>
                        ⚠
                      </span>
                    )}
                    {/* Screen reader announcement for sanitization */}
                    <span
                      id={`sanitization-feedback-${node.id}`}
                      role="status"
                      aria-live="polite"
                      className="sr-only"
                    >
                      {sanitizationMessage}
                    </span>
                  </>
                ) : (
                  <span
                    className="text-text-secondary cursor-pointer hover:text-text-primary px-1 py-0.5 rounded hover:bg-mac-bg-hover focus:outline-none focus:ring-1 focus:ring-accent"
                    onDoubleClick={handleConditionDoubleClick}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        startConditionEditing();
                      }
                    }}
                    tabIndex={0}
                    role="button"
                    aria-label={`Edit condition variable: ${node.condition_var || "not set"}`}
                    title="Press Enter or double-click to edit condition variable"
                  >
                    %{node.condition_var || "?"}%
                  </span>
                )
              )}
            </div>
          ) : isRepeat ? (
            // Repeat node display
            <div className="flex items-center gap-1.5 flex-1 font-mono text-mac-sm">
              <span className="font-semibold text-system-green">repeat</span>
              {isEditingRepeatCount ? (
                <>
                  <input
                    ref={repeatCountInputRef}
                    type="text"
                    value={repeatCountValue}
                    onChange={handleRepeatCountChange}
                    onBlur={handleRepeatCountSave}
                    onKeyDown={handleRepeatCountKeyDown}
                    placeholder={DEFAULT_REPEAT_COUNT}
                    list={datalistId}
                    aria-label="Repeat count"
                    aria-describedby={repeatCountError ? `repeat-count-error-${node.id}` : undefined}
                    aria-invalid={repeatCountError ? "true" : undefined}
                    className={`bg-mac-bg border rounded px-1 py-0.5 text-mac-sm font-mono outline-none max-w-[80px] ${
                      repeatCountError ? "border-system-red" : "border-accent"
                    }`}
                    title={repeatCountError || undefined}
                  />
                  {repeatCountError && (
                    <span className="text-system-red text-mac-xs" title={repeatCountError}>
                      ⚠
                    </span>
                  )}
                  <span
                    id={`repeat-count-error-${node.id}`}
                    role="status"
                    aria-live="polite"
                    className="sr-only"
                  >
                    {repeatCountError}
                  </span>
                </>
              ) : (
                <span
                  className="text-text-secondary cursor-pointer hover:text-text-primary px-1 py-0.5 rounded hover:bg-mac-bg-hover focus:outline-none focus:ring-1 focus:ring-accent"
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    setIsEditingRepeatCount(true);
                    setRepeatCountValue(node.repeat_count || DEFAULT_REPEAT_COUNT);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setIsEditingRepeatCount(true);
                      setRepeatCountValue(node.repeat_count || DEFAULT_REPEAT_COUNT);
                    }
                  }}
                  tabIndex={0}
                  role="button"
                  aria-label={`Edit repeat count: ${node.repeat_count || DEFAULT_REPEAT_COUNT}`}
                  title="Press Enter or double-click to edit count"
                >
                  {node.repeat_count || DEFAULT_REPEAT_COUNT}
                </span>
              )}
              <span className="text-text-muted">as</span>
              {isEditingRepeatAs ? (
                <>
                  <input
                    ref={repeatAsInputRef}
                    type="text"
                    value={repeatAsValue}
                    onChange={handleRepeatAsChange}
                    onBlur={handleRepeatAsSave}
                    onKeyDown={handleRepeatAsKeyDown}
                    placeholder="i"
                    aria-label="Iteration variable name"
                    aria-describedby={
                      sanitizationMessage || repeatAsError
                        ? `repeat-as-feedback-${node.id}`
                        : undefined
                    }
                    aria-invalid={sanitizationMessage || repeatAsError ? "true" : undefined}
                    className={`bg-mac-bg border rounded px-1 py-0.5 text-mac-sm font-mono outline-none max-w-[60px] ${
                      sanitizationMessage || repeatAsError ? "border-system-red" : "border-accent"
                    }`}
                    title={repeatAsError || sanitizationMessage || undefined}
                  />
                  {/* Visible feedback when there's an error */}
                  {(sanitizationMessage || repeatAsError) && (
                    <span className="text-system-red text-mac-xs" title={repeatAsError || sanitizationMessage}>
                      ⚠
                    </span>
                  )}
                  {/* Screen reader announcement for errors */}
                  <span
                    id={`repeat-as-feedback-${node.id}`}
                    role="status"
                    aria-live="polite"
                    className="sr-only"
                  >
                    {repeatAsError || sanitizationMessage}
                  </span>
                </>
              ) : (
                <span
                  className="text-text-secondary cursor-pointer hover:text-text-primary px-1 py-0.5 rounded hover:bg-mac-bg-hover focus:outline-none focus:ring-1 focus:ring-accent"
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    setIsEditingRepeatAs(true);
                    setRepeatAsValue(node.repeat_as || DEFAULT_REPEAT_AS);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setIsEditingRepeatAs(true);
                      setRepeatAsValue(node.repeat_as || DEFAULT_REPEAT_AS);
                    }
                  }}
                  tabIndex={0}
                  role="button"
                  aria-label={`Edit iteration variable: ${node.repeat_as || DEFAULT_REPEAT_AS}`}
                  title="Press Enter or double-click to edit variable name"
                >
                  %{node.repeat_as || DEFAULT_REPEAT_AS}%
                </span>
              )}
            </div>
          ) : isEditing ? (
            <input
              ref={inputRef}
              type="text"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={handleSave}
              onKeyDown={handleKeyDown}
              className="flex-1 bg-mac-bg border border-accent rounded px-1 py-0.5 text-mac-sm font-mono outline-none"
            />
          ) : (
            <span
              className={`font-mono text-mac-sm flex-1 ${
                isFolder ? "font-medium text-text-primary" : "text-text-secondary"
              }`}
              onDoubleClick={handleDoubleClick}
            >
              {displayName}
            </span>
          )}

          {/* Action buttons (visible on hover) */}
          <div className="opacity-0 group-hover:opacity-100 flex gap-1 transition-opacity">
            {isContainer && (
              <>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onAdd(node.id!, "folder");
                  }}
                  className="p-1 hover:bg-mac-bg-secondary rounded"
                  title="Add folder"
                >
                  <FolderIcon size={12} className="text-system-blue" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onAdd(node.id!, "file");
                  }}
                  className="p-1 hover:bg-mac-bg-secondary rounded"
                  title="Add file"
                >
                  <PlusIcon size={12} className="text-text-muted" />
                </button>
              </>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRemove(node.id!);
              }}
              className="p-1 hover:bg-red-500/10 rounded"
              title="Delete"
            >
              <TrashIcon size={12} className="text-red-500" />
            </button>
          </div>
        </div>

        {/* Context menu */}
        {showContextMenu && (
          <div
            className="fixed bg-mac-bg-secondary border border-border-muted rounded-mac shadow-lg py-1 z-50 min-w-[160px]"
            style={{ left: contextMenuPos.x, top: contextMenuPos.y }}
          >
            {/* Rename option - only for folders and files */}
            {!isConditional && !isRepeat && (
              <button
                onClick={() => {
                  setIsEditing(true);
                  setShowContextMenu(false);
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-mac-bg-hover text-mac-sm"
              >
                Rename
              </button>
            )}
            {/* Edit condition - only for if nodes */}
            {isIf && (
              <button
                onClick={() => {
                  setIsEditingCondition(true);
                  setShowContextMenu(false);
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-mac-bg-hover text-mac-sm"
              >
                Edit Condition
              </button>
            )}
            {/* Edit repeat settings - only for repeat nodes */}
            {isRepeat && (
              <>
                <button
                  onClick={() => {
                    setIsEditingRepeatCount(true);
                    setShowContextMenu(false);
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-mac-bg-hover text-mac-sm"
                >
                  Edit Count
                </button>
                <button
                  onClick={() => {
                    setIsEditingRepeatAs(true);
                    setShowContextMenu(false);
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-mac-bg-hover text-mac-sm"
                >
                  Edit Variable
                </button>
              </>
            )}
            {/* Add children - for folders and conditionals */}
            {isContainer && (
              <>
                <div className="border-t border-border-muted my-1" />
                <button
                  onClick={() => {
                    onAdd(node.id!, "folder");
                    setShowContextMenu(false);
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-mac-bg-hover text-mac-sm"
                >
                  Add Folder
                </button>
                <button
                  onClick={() => {
                    onAdd(node.id!, "file");
                    setShowContextMenu(false);
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-mac-bg-hover text-mac-sm"
                >
                  Add File
                </button>
                <div className="border-t border-border-muted my-1" />
                <button
                  onClick={() => {
                    onAdd(node.id!, "if", DEFAULT_CONDITION_VAR);
                    setShowContextMenu(false);
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-mac-bg-hover text-mac-sm text-system-orange"
                >
                  Add If Block
                </button>
                <button
                  onClick={() => {
                    onAdd(node.id!, "else");
                    setShowContextMenu(false);
                  }}
                  disabled={!canAddElse}
                  title={canAddElse ? undefined : "Add an If block first"}
                  className={`w-full text-left px-3 py-1.5 text-mac-sm ${
                    canAddElse
                      ? "hover:bg-mac-bg-hover text-system-purple"
                      : "text-text-muted cursor-not-allowed opacity-50"
                  }`}
                >
                  Add Else Block
                </button>
                <button
                  onClick={() => {
                    onAdd(node.id!, "repeat");
                    setShowContextMenu(false);
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-mac-bg-hover text-mac-sm text-system-green"
                >
                  Add Repeat Block
                </button>
              </>
            )}
            <div className="border-t border-border-muted my-1" />
            <button
              onClick={() => {
                onRemove(node.id!);
                setShowContextMenu(false);
              }}
              className="w-full text-left px-3 py-1.5 hover:bg-red-500/10 text-mac-sm text-red-500"
            >
              Delete
            </button>
          </div>
        )}
      </div>

      {/* Children */}
      {isContainer && isExpanded && node.children && (
        <SortableContext
          items={node.children.map((c) => c.id!)}
          strategy={verticalListSortingStrategy}
        >
          {node.children.map((child) => (
            <EditableTreeItem
              key={child.id}
              node={child}
              depth={depth + 1}
              onUpdate={onUpdate}
              onRemove={onRemove}
              onAdd={onAdd}
              projectName={projectName}
              datalistId={datalistId}
            />
          ))}
        </SortableContext>
      )}
    </>
  );
};

export const VisualSchemaEditor = () => {
  const {
    schemaTree,
    projectName,
    variables,
    updateSchemaNode,
    addSchemaNode,
    removeSchemaNode,
    moveSchemaNode,
    moveIfElseGroup,
    getIfElseGroupIds,
    undo,
    redo,
    canUndo,
    canRedo,
    schemaDirty,
    setSchemaContent,
  } = useAppStore();

  // Extract variable names for suggestions
  const variableNames = variables.map((v) => v.name);

  // Unique ID for datalist to avoid conflicts if component is mounted multiple times
  const datalistId = useId();

  const [activeId, setActiveId] = useState<string | null>(null);
  const [dragGroupCount, setDragGroupCount] = useState(0); // Cached count of if/else group being dragged
  const [isSaving, setIsSaving] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor)
  );

  const handleDragStart = (event: DragStartEvent) => {
    const id = event.active.id as string;
    setActiveId(id);

    // Pre-compute the if/else group count to avoid calling getIfElseGroupIds during render
    if (schemaTree) {
      const node = findNode(schemaTree.root, id);
      if (node?.type === "if") {
        const groupIds = getIfElseGroupIds(id);
        setDragGroupCount(groupIds.length);
      } else {
        setDragGroupCount(0);
      }
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id && schemaTree) {
      const activeId = active.id as string;
      const overId = over.id as string;

      const activeNode = findNode(schemaTree.root, activeId);
      const overNode = findNode(schemaTree.root, overId);
      if (!overNode || !activeNode) {
        setActiveId(null);
        return;
      }

      // Don't allow dragging else nodes independently
      if (activeNode.type === "else") {
        setActiveId(null);
        return;
      }

      // Determine target parent and index
      let targetParentId: string;
      let targetIndex: number;

      if (canHaveChildren(overNode.type)) {
        // Dropping onto a container node: add as first child
        targetParentId = overId;
        targetIndex = 0;
      } else {
        // Dropping onto a file: insert as sibling after the file
        const parent = findParent(schemaTree.root, overId);
        if (!parent) {
          setActiveId(null);
          return;
        }
        targetParentId = parent.id!;
        const overIndex = parent.children?.findIndex(c => c.id === overId) ?? 0;
        targetIndex = overIndex + 1;
      }

      // Use moveIfElseGroup for if nodes to keep else blocks together
      if (activeNode.type === "if") {
        moveIfElseGroup(activeId, targetParentId, targetIndex);
      } else {
        moveSchemaNode(activeId, targetParentId, targetIndex);
      }
    }

    setActiveId(null);
    setDragGroupCount(0);
  };

  const handleAdd = (parentId: string, type: NodeType, conditionVar?: string) => {
    if (type === "if") {
      // Sanitize conditionVar to ensure valid format
      const sanitized = conditionVar ? sanitizeVariableName(conditionVar) : "";
      addSchemaNode(parentId, {
        type,
        name: "",
        condition_var: sanitized || DEFAULT_CONDITION_VAR,
      });
    } else if (type === "else") {
      addSchemaNode(parentId, {
        type,
        name: "",
      });
    } else if (type === "repeat") {
      addSchemaNode(parentId, {
        type,
        name: "",
        repeat_count: DEFAULT_REPEAT_COUNT,
        repeat_as: DEFAULT_REPEAT_AS,
      });
    } else {
      addSchemaNode(parentId, {
        type,
        name: type === "folder" ? "New Folder" : "New File",
      });
    }
  };

  const handleSaveSchema = async () => {
    if (!schemaTree) return;

    setIsSaving(true);
    try {
      const xml = await invoke<string>("cmd_export_schema_xml", { tree: schemaTree });

      const defaultName = schemaTree.root.name === "%BASE%"
        ? `${projectName}-schema.xml`
        : `${schemaTree.root.name}-schema.xml`;

      const savePath = await save({
        filters: [{ name: "XML", extensions: ["xml"] }],
        defaultPath: defaultName,
      });

      if (savePath) {
        await writeTextFile(savePath, xml);
        setSchemaContent(xml);
      }
    } catch (e) {
      console.error("Failed to save schema:", e);
      alert(`Failed to save schema: ${e}`);
    } finally {
      setIsSaving(false);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        handleSaveSchema();
      } else if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        if (canUndo()) undo();
      } else if (
        (e.metaKey || e.ctrlKey) &&
        (e.key === "y" || (e.key === "z" && e.shiftKey))
      ) {
        e.preventDefault();
        if (canRedo()) redo();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [canUndo, canRedo, undo, redo, schemaTree]);

  if (!schemaTree) {
    return (
      <div className="h-full flex items-center justify-center text-text-muted">
        <div className="text-center">
          <FolderIcon size={48} className="mx-auto mb-4 opacity-20" />
          <div className="text-mac-base">No schema loaded</div>
          <div className="text-mac-xs mt-1">
            Load a schema to start editing
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="px-4 py-2 border-b border-border-muted flex items-center justify-between bg-mac-bg-secondary">
        <div className="flex items-center gap-2">
          <button
            onClick={undo}
            disabled={!canUndo()}
            className="px-2 py-1 text-mac-xs rounded hover:bg-mac-bg-hover disabled:opacity-30 disabled:cursor-not-allowed"
            title="Undo (Cmd/Ctrl+Z)"
          >
            ↶ Undo
          </button>
          <button
            onClick={redo}
            disabled={!canRedo()}
            className="px-2 py-1 text-mac-xs rounded hover:bg-mac-bg-hover disabled:opacity-30 disabled:cursor-not-allowed"
            title="Redo (Cmd/Ctrl+Y)"
          >
            ↷ Redo
          </button>
        </div>
        <div className="flex items-center gap-2">
          {schemaDirty && (
            <span className="text-mac-xs text-text-muted">• Unsaved changes</span>
          )}
          <button
            onClick={handleSaveSchema}
            disabled={isSaving}
            className="px-3 py-1 text-mac-xs rounded-mac bg-accent text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
            title="Save Schema (Cmd/Ctrl+S)"
          >
            <SaveIcon size={12} />
            {isSaving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      {/* Tree editor */}
      <div className="flex-1 overflow-auto p-4 mac-scroll">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={[schemaTree.root.id!]}
            strategy={verticalListSortingStrategy}
          >
            <EditableTreeItem
              node={schemaTree.root}
              depth={0}
              onUpdate={updateSchemaNode}
              onRemove={removeSchemaNode}
              onAdd={handleAdd}
              projectName={projectName}
              datalistId={datalistId}
            />
          </SortableContext>

          <DragOverlay>
            {activeId && (() => {
              const draggedNode = findNode(schemaTree.root, activeId);
              if (!draggedNode) return null;

              const nodeType = draggedNode.type;

              // Use cached group count (computed in handleDragStart)
              const groupCount = dragGroupCount;

              // Compute display name based on node type
              const getDisplayName = (): string => {
                switch (nodeType) {
                  case "if":
                    return `if %${draggedNode.condition_var || "?"}%`;
                  case "else":
                    return "else";
                  case "repeat":
                    return `repeat ${draggedNode.repeat_count || DEFAULT_REPEAT_COUNT} as %${draggedNode.repeat_as || DEFAULT_REPEAT_AS}%`;
                  default:
                    return draggedNode.name === "%BASE%"
                      ? projectName
                      : draggedNode.name.replace(/%BASE%/g, projectName);
                }
              };

              // Get icon component for this node type
              const getIcon = () => {
                const iconClass = `${DRAG_OVERLAY_STYLES[nodeType].iconClass} flex-shrink-0`;
                switch (nodeType) {
                  case "folder": return <FolderIcon size={16} className={iconClass} />;
                  case "if": return <BranchIcon size={16} className={iconClass} />;
                  case "else": return <GitMergeIcon size={16} className={iconClass} />;
                  case "repeat": return <RepeatIcon size={16} className={iconClass} />;
                  default: return <FileIcon size={16} className={iconClass} />;
                }
              };

              const style = DRAG_OVERLAY_STYLES[nodeType];

              return (
                <div className="bg-mac-bg-secondary border border-accent rounded-mac px-2 py-1.5 shadow-lg flex items-center gap-2">
                  {getIcon()}
                  <span className={`font-mono text-mac-sm ${style.textClass}`}>
                    {getDisplayName()}
                  </span>
                  {/* Show badge for if/else group */}
                  {nodeType === "if" && groupCount > 1 && (
                    <span className="text-mac-xs bg-system-purple/20 text-system-purple px-1.5 py-0.5 rounded">
                      +{groupCount - 1} else
                    </span>
                  )}
                </div>
              );
            })()}
          </DragOverlay>
        </DndContext>
      </div>

      {/* Global datalist for variable suggestions - rendered once */}
      <datalist id={datalistId}>
        {variableNames.map((v) => (
          <option key={v} value={v.replace(/%/g, "")} />
        ))}
      </datalist>
    </div>
  );
};
