import { useState, useRef, useEffect } from "react";
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
import { FolderIcon, FileIcon, PlusIcon, TrashIcon, SaveIcon, BranchIcon, GitMergeIcon } from "./Icons";
import type { SchemaNode } from "../types/schema";

type NodeType = "folder" | "file" | "if" | "else";

// Helper: Find node by ID
const findNode = (node: SchemaNode, nodeId: string): SchemaNode | null => {
  if (node.id === nodeId) return node;
  if (node.children) {
    for (const child of node.children) {
      const found = findNode(child, nodeId);
      if (found) return found;
    }
  }
  return null;
};

// Helper: Find parent of a node
const findParent = (root: SchemaNode, nodeId: string): SchemaNode | null => {
  if (root.children) {
    for (const child of root.children) {
      if (child.id === nodeId) return root;
      const found = findParent(child, nodeId);
      if (found) return found;
    }
  }
  return null;
};

interface EditableTreeItemProps {
  node: SchemaNode;
  depth: number;
  onUpdate: (nodeId: string, updates: Partial<SchemaNode>) => void;
  onRemove: (nodeId: string) => void;
  onAdd: (parentId: string, type: NodeType, conditionVar?: string) => void;
  projectName: string;
  variables: string[];
}

const EditableTreeItem = ({
  node,
  depth,
  onUpdate,
  onRemove,
  onAdd,
  projectName,
  variables,
}: EditableTreeItemProps) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(node.name);
  const [isEditingCondition, setIsEditingCondition] = useState(false);
  const [conditionValue, setConditionValue] = useState(node.condition_var || "");
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [contextMenuPos, setContextMenuPos] = useState({ x: 0, y: 0 });
  const [isExpanded, setIsExpanded] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const conditionInputRef = useRef<HTMLInputElement>(null);

  // Disable dragging for else nodes - they move with their parent if block
  const isElseNode = node.type === "else";

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: node.id!,
    disabled: isElseNode,
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

  const handleDoubleClick = () => {
    // For if/else nodes, don't allow name editing via double-click
    if (node.type === "if" || node.type === "else") return;
    setIsEditing(true);
    setEditValue(node.name);
  };

  const handleConditionDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (node.type === "if") {
      setIsEditingCondition(true);
      setConditionValue(node.condition_var || "");
    }
  };

  const handleConditionSave = () => {
    const trimmedValue = conditionValue.trim();
    if (trimmedValue !== (node.condition_var || "")) {
      onUpdate(node.id!, { condition_var: trimmedValue || undefined });
    }
    setIsEditingCondition(false);
  };

  const handleConditionKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      // Don't preventDefault - let browser handle datalist selection first
      // Use requestAnimationFrame to read value after browser updates it
      requestAnimationFrame(() => {
        const finalValue = conditionInputRef.current?.value.trim() || "";
        if (finalValue !== (node.condition_var || "")) {
          onUpdate(node.id!, { condition_var: finalValue || undefined });
        }
        setConditionValue(finalValue);
        setIsEditingCondition(false);
      });
    } else if (e.key === "Escape") {
      setIsEditingCondition(false);
      setConditionValue(node.condition_var || "");
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
    setContextMenuPos({ x: e.clientX, y: e.clientY });
    setShowContextMenu(true);
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

  const isFolder = node.type === "folder";
  const isIf = node.type === "if";
  const isElse = node.type === "else";
  const isConditional = isIf || isElse;
  const canHaveChildren = isFolder || isConditional;
  const hasChildren = node.children && node.children.length > 0;

  return (
    <>
      <div
        ref={setNodeRef}
        style={style}
        className={`relative ${isConditional ? "conditional-group" : ""}`}
        onContextMenu={handleContextMenu}
      >
        <div
          className={`flex items-center gap-2 px-2 py-1.5 rounded-mac hover:bg-mac-bg-hover transition-colors group ${
            isConditional
              ? `border-l-2 ${isIf ? "border-system-orange" : "border-system-purple"} ${isElseNode ? "cursor-default" : "cursor-pointer"}`
              : "cursor-pointer"
          }`}
          style={{ marginLeft: `${depth * 20}px` }}
          {...attributes}
          {...(isElseNode ? {} : listeners)}
        >
          {/* Expand/collapse arrow for nodes that can have children */}
          {canHaveChildren && hasChildren && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsExpanded(!isExpanded);
              }}
              className="w-4 h-4 flex items-center justify-center text-text-muted hover:text-text-primary"
            >
              <span className={`transform transition-transform ${isExpanded ? "rotate-90" : ""}`}>
                ▶
              </span>
            </button>
          )}
          {(!canHaveChildren || !hasChildren) && <div className="w-4" />}

          {/* Icon */}
          {isFolder ? (
            <FolderIcon size={16} className="text-system-blue flex-shrink-0" />
          ) : isIf ? (
            <BranchIcon size={16} className="text-system-orange flex-shrink-0" />
          ) : isElse ? (
            <GitMergeIcon size={16} className="text-system-purple flex-shrink-0" />
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
                  <input
                    ref={conditionInputRef}
                    type="text"
                    value={conditionValue}
                    onChange={(e) => setConditionValue(e.target.value)}
                    onBlur={handleConditionSave}
                    onKeyDown={handleConditionKeyDown}
                    placeholder="VARIABLE"
                    list="variable-suggestions"
                    className="flex-1 bg-mac-bg border border-accent rounded px-1 py-0.5 text-mac-sm font-mono outline-none max-w-[150px]"
                  />
                ) : (
                  <span
                    className="text-text-secondary cursor-pointer hover:text-text-primary px-1 py-0.5 rounded hover:bg-mac-bg-hover"
                    onDoubleClick={handleConditionDoubleClick}
                    title="Double-click to edit condition variable"
                  >
                    %{node.condition_var || "?"}%
                  </span>
                )
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
            {canHaveChildren && (
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
            {!isConditional && (
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
            {/* Add children - for folders and conditionals */}
            {canHaveChildren && (
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
                    onAdd(node.id!, "if", "CONDITION");
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
                  className="w-full text-left px-3 py-1.5 hover:bg-mac-bg-hover text-mac-sm text-system-purple"
                >
                  Add Else Block
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
      {canHaveChildren && isExpanded && node.children && (
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
              variables={variables}
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

  const [activeId, setActiveId] = useState<string | null>(null);
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
    setActiveId(event.active.id as string);
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

      const canHaveChildrenTypes = ["folder", "if", "else"];
      if (canHaveChildrenTypes.includes(overNode.type)) {
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
  };

  const handleAdd = (parentId: string, type: NodeType, conditionVar?: string) => {
    if (type === "if") {
      addSchemaNode(parentId, {
        type,
        name: "",
        condition_var: conditionVar || "CONDITION",
      });
    } else if (type === "else") {
      addSchemaNode(parentId, {
        type,
        name: "",
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
              variables={variableNames}
            />
          </SortableContext>

          <DragOverlay>
            {activeId ? (
              (() => {
                const draggedNode = findNode(schemaTree.root, activeId);
                if (!draggedNode) return null;
                const isFolder = draggedNode.type === "folder";
                const isIf = draggedNode.type === "if";
                const isElse = draggedNode.type === "else";

                // Get the if/else group if dragging an if node
                const groupIds = isIf ? getIfElseGroupIds(activeId) : [];
                const groupCount = groupIds.length;

                const displayName = isIf
                  ? `if %${draggedNode.condition_var || "?"}%`
                  : isElse
                  ? "else"
                  : draggedNode.name === "%BASE%"
                  ? projectName
                  : draggedNode.name.replace(/%BASE%/g, projectName);
                return (
                  <div className="bg-mac-bg-secondary border border-accent rounded-mac px-2 py-1.5 shadow-lg flex items-center gap-2">
                    {isFolder ? (
                      <FolderIcon size={16} className="text-system-blue flex-shrink-0" />
                    ) : isIf ? (
                      <BranchIcon size={16} className="text-system-orange flex-shrink-0" />
                    ) : isElse ? (
                      <GitMergeIcon size={16} className="text-system-purple flex-shrink-0" />
                    ) : (
                      <FileIcon size={16} className="text-text-muted flex-shrink-0" />
                    )}
                    <span className={`font-mono text-mac-sm ${
                      isFolder ? "font-medium text-text-primary"
                      : isIf ? "font-semibold text-system-orange"
                      : isElse ? "font-semibold text-system-purple"
                      : "text-text-secondary"
                    }`}>
                      {displayName}
                    </span>
                    {/* Show badge for if/else group */}
                    {isIf && groupCount > 1 && (
                      <span className="text-mac-xs bg-system-purple/20 text-system-purple px-1.5 py-0.5 rounded">
                        +{groupCount - 1} else
                      </span>
                    )}
                  </div>
                );
              })()
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>

      {/* Global datalist for variable suggestions - rendered once */}
      <datalist id="variable-suggestions">
        {variableNames.map((v) => (
          <option key={v} value={v.replace(/%/g, "")} />
        ))}
      </datalist>
    </div>
  );
};
