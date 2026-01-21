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
import { FolderIcon, FileIcon, PlusIcon, TrashIcon, SaveIcon } from "./Icons";
import type { SchemaNode } from "../types/schema";

interface EditableTreeItemProps {
  node: SchemaNode;
  depth: number;
  onUpdate: (nodeId: string, updates: Partial<SchemaNode>) => void;
  onRemove: (nodeId: string) => void;
  onAdd: (parentId: string, type: "folder" | "file") => void;
  projectName: string;
}

const EditableTreeItem = ({
  node,
  depth,
  onUpdate,
  onRemove,
  onAdd,
  projectName,
}: EditableTreeItemProps) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(node.name);
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [contextMenuPos, setContextMenuPos] = useState({ x: 0, y: 0 });
  const [isExpanded, setIsExpanded] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: node.id! });

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

  const handleDoubleClick = () => {
    setIsEditing(true);
    setEditValue(node.name);
  };

  const handleSave = () => {
    if (editValue.trim() && editValue !== node.name) {
      onUpdate(node.id!, { name: editValue.trim() });
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
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
  const hasChildren = node.children && node.children.length > 0;

  return (
    <>
      <div
        ref={setNodeRef}
        style={style}
        className="relative"
        onContextMenu={handleContextMenu}
      >
        <div
          className="flex items-center gap-2 px-2 py-1.5 rounded-mac hover:bg-mac-bg-hover cursor-pointer transition-colors group"
          style={{ marginLeft: `${depth * 20}px` }}
          {...attributes}
          {...listeners}
        >
          {/* Expand/collapse arrow for folders with children */}
          {isFolder && hasChildren && (
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
          {(!isFolder || !hasChildren) && <div className="w-4" />}

          {/* Icon */}
          {isFolder ? (
            <FolderIcon size={16} className="text-system-blue flex-shrink-0" />
          ) : (
            <FileIcon size={16} className="text-text-muted flex-shrink-0" />
          )}

          {/* Name (editable) */}
          {isEditing ? (
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
            {isFolder && (
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
            <button
              onClick={() => {
                setIsEditing(true);
                setShowContextMenu(false);
              }}
              className="w-full text-left px-3 py-1.5 hover:bg-mac-bg-hover text-mac-sm"
            >
              Rename
            </button>
            {isFolder && (
              <>
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
      {isFolder && isExpanded && node.children && (
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
    updateSchemaNode,
    addSchemaNode,
    removeSchemaNode,
    moveSchemaNode,
    undo,
    redo,
    canUndo,
    canRedo,
    schemaDirty,
    setSchemaContent,
  } = useAppStore();

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

    if (over && active.id !== over.id) {
      // For now, we'll implement basic reordering
      // Full parent-changing drag-drop would require more complex logic
      moveSchemaNode(active.id as string, null, 0);
    }

    setActiveId(null);
  };

  const handleAdd = (parentId: string, type: "folder" | "file") => {
    addSchemaNode(parentId, {
      type,
      name: type === "folder" ? "New Folder" : "New File",
    });
  };

  const handleSaveSchema = async () => {
    if (!schemaTree) return;

    setIsSaving(true);
    try {
      const xml = await invoke<string>("cmd_export_schema_xml", { tree: schemaTree });

      const savePath = await save({
        filters: [{ name: "XML", extensions: ["xml"] }],
        defaultPath: `${schemaTree.root.name}-schema.xml`,
      });

      if (savePath) {
        await writeTextFile(savePath, xml);
        setSchemaContent(xml);
      }
    } catch (e) {
      console.error("Failed to save schema:", e);
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
            />
          </SortableContext>

          <DragOverlay>
            {activeId ? (
              <div className="bg-mac-bg-secondary border border-accent rounded-mac px-2 py-1 shadow-lg">
                Dragging...
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>
    </div>
  );
};
