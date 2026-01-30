import type { StateCreator } from "zustand";
import type { SchemaTree, SchemaNode, EditorMode } from "../../types/schema";
import { findNode, canHaveChildren, isDescendant, removeNodesById, getIfElseGroup, moveIfElseGroupToParent } from "../../utils/schemaTree";
import { api } from "../../lib/api";
import {
  generateNodeId,
  ensureNodeIds,
  calculateStats,
  updateNodeById,
  removeNodeById,
  addNodeToParent,
  moveNodeToParent,
} from "../helpers/schemaTreeHelpers";

export interface SchemaSlice {
  // State
  schemaPath: string | null;
  schemaContent: string | null;
  schemaTree: SchemaTree | null;
  isEditMode: boolean;
  editorMode: EditorMode;
  schemaDirty: boolean;
  schemaHistory: SchemaTree[];
  schemaHistoryIndex: number;
  xmlEditorContent: string | null;
  xmlParseError: string | null;

  // Actions
  setSchemaPath: (path: string | null) => void;
  setSchemaContent: (content: string | null) => void;
  setSchemaTree: (tree: SchemaTree | null) => void;
  setEditMode: (enabled: boolean) => void;
  setEditorMode: (mode: EditorMode) => Promise<boolean>;
  setXmlEditorContent: (content: string) => void;
  setXmlParseError: (error: string | null) => void;
  syncXmlToTree: () => Promise<boolean>;
  syncTreeToXml: () => Promise<void>;
  createNewSchema: () => void;
  updateSchemaNode: (nodeId: string, updates: Partial<SchemaNode>) => void;
  addSchemaNode: (parentId: string | null, node: Partial<SchemaNode>) => void;
  removeSchemaNode: (nodeId: string) => void;
  moveSchemaNode: (nodeId: string, targetParentId: string | null, index: number) => void;
  moveIfElseGroup: (ifNodeId: string, targetParentId: string | null, index: number) => void;
  getIfElseGroupIds: (ifNodeId: string) => string[];
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

export const createSchemaSlice: StateCreator<SchemaSlice, [], [], SchemaSlice> = (set, get) => ({
  // Initial state
  schemaPath: null,
  schemaContent: null,
  schemaTree: null,
  isEditMode: false,
  editorMode: "preview",
  schemaDirty: false,
  schemaHistory: [],
  schemaHistoryIndex: -1,
  xmlEditorContent: null,
  xmlParseError: null,

  // Actions
  setSchemaPath: (path) => set({ schemaPath: path }),

  setSchemaContent: (content) => set({ schemaContent: content }),

  setSchemaTree: (tree) => {
    if (tree) {
      // Ensure all nodes have IDs when setting tree
      const treeWithIds = {
        ...tree,
        root: ensureNodeIds(tree.root),
      };
      set({
        schemaTree: treeWithIds,
        schemaHistory: [treeWithIds],
        schemaHistoryIndex: 0,
        schemaDirty: false,
      });
    } else {
      set({
        schemaTree: null,
        schemaHistory: [],
        schemaHistoryIndex: -1,
        schemaDirty: false,
        xmlEditorContent: null,
        xmlParseError: null,
      });
    }
  },

  setEditMode: (enabled) => set({ isEditMode: enabled }),

  setEditorMode: async (mode) => {
    const state = get();
    const currentMode = state.editorMode;

    // If switching to the same mode, do nothing
    if (mode === currentMode) return true;

    // Switching FROM XML mode - need to sync XML to tree first
    if (currentMode === "xml" && state.xmlEditorContent !== null) {
      const success = await get().syncXmlToTree();
      if (!success) {
        // Parse error - stay in XML mode
        return false;
      }
    }

    // Switching TO XML mode - sync tree to XML
    if (mode === "xml" && state.schemaTree) {
      await get().syncTreeToXml();
    }

    // Update mode and legacy isEditMode flag
    set({
      editorMode: mode,
      isEditMode: mode === "visual",
      xmlParseError: null,
    });

    return true;
  },

  setXmlEditorContent: (content) => {
    set({ xmlEditorContent: content, schemaDirty: true });
  },

  setXmlParseError: (error) => {
    set({ xmlParseError: error });
  },

  syncXmlToTree: async () => {
    const state = get();
    const content = state.xmlEditorContent;
    if (!content) return true;

    try {
      const tree = await api.schema.parseSchema(content);
      // Ensure all nodes have IDs
      const treeWithIds = {
        ...tree,
        root: ensureNodeIds(tree.root),
      };

      // Add to history
      const history = state.schemaHistory.slice(0, state.schemaHistoryIndex + 1);
      history.push(treeWithIds);

      set({
        schemaTree: treeWithIds,
        schemaContent: content,
        schemaHistory: history,
        schemaHistoryIndex: history.length - 1,
        xmlParseError: null,
      });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set({ xmlParseError: message });
      return false;
    }
  },

  syncTreeToXml: async () => {
    const state = get();
    if (!state.schemaTree) {
      set({ xmlEditorContent: null });
      return;
    }

    try {
      const xml = await api.schema.exportSchemaXml(state.schemaTree);
      set({ xmlEditorContent: xml, xmlParseError: null });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set({ xmlParseError: message });
    }
  },

  createNewSchema: () => {
    const newRoot: SchemaNode = {
      id: generateNodeId(),
      type: "folder",
      name: "%PROJECT_NAME%",
      children: [],
    };

    const newTree: SchemaTree = {
      root: newRoot,
      stats: { folders: 1, files: 0, downloads: 0 },
    };

    set({
      schemaPath: "new-schema",
      schemaContent: null,
      schemaTree: newTree,
      schemaHistory: [newTree],
      schemaHistoryIndex: 0,
      schemaDirty: true,
      isEditMode: true,
      editorMode: "visual",
      xmlEditorContent: null,
      xmlParseError: null,
    });
  },

  updateSchemaNode: (nodeId, updates) => {
    const state = get();
    if (!state.schemaTree) return;

    const newRoot = updateNodeById(state.schemaTree.root, nodeId, updates);
    const newTree: SchemaTree = {
      root: newRoot,
      stats: calculateStats(newRoot),
    };

    // Add to history (trim any future history)
    const history = state.schemaHistory.slice(0, state.schemaHistoryIndex + 1);
    history.push(newTree);

    set({
      schemaTree: newTree,
      schemaContent: null,
      schemaHistory: history,
      schemaHistoryIndex: history.length - 1,
      schemaDirty: true,
    });
  },

  addSchemaNode: (parentId, node) => {
    const state = get();
    if (!state.schemaTree) return;

    const newNode: SchemaNode = {
      id: generateNodeId(),
      type: node.type || "folder",
      name: node.name || "New Item",
      url: node.url,
      content: node.content,
      children: node.children,
      attributes: node.attributes,
      condition_var: node.condition_var,
    };

    let newRoot: SchemaNode;
    if (parentId === null) {
      // If no parent, we can't add (single root structure)
      return;
    } else {
      newRoot = addNodeToParent(state.schemaTree.root, parentId, newNode);
    }

    const newTree: SchemaTree = {
      root: newRoot,
      stats: calculateStats(newRoot),
    };

    // Add to history
    const history = state.schemaHistory.slice(0, state.schemaHistoryIndex + 1);
    history.push(newTree);

    set({
      schemaTree: newTree,
      schemaContent: null,
      schemaHistory: history,
      schemaHistoryIndex: history.length - 1,
      schemaDirty: true,
    });
  },

  removeSchemaNode: (nodeId) => {
    const state = get();
    if (!state.schemaTree) return;

    // Don't allow removing the root node
    if (state.schemaTree.root.id === nodeId) return;

    const nodeToRemove = findNode(state.schemaTree.root, nodeId);
    if (!nodeToRemove) return;

    let newRoot: SchemaNode | null;

    // If removing an if node, also remove its following else siblings
    if (nodeToRemove.type === "if") {
      const group = getIfElseGroup(state.schemaTree.root, nodeId);
      const idsToRemove = group.map((n) => n.id!);
      newRoot = removeNodesById(state.schemaTree.root, idsToRemove);
    } else {
      newRoot = removeNodeById(state.schemaTree.root, nodeId);
    }

    if (!newRoot) return;

    const newTree: SchemaTree = {
      root: newRoot,
      stats: calculateStats(newRoot),
    };

    // Add to history
    const history = state.schemaHistory.slice(0, state.schemaHistoryIndex + 1);
    history.push(newTree);

    set({
      schemaTree: newTree,
      schemaContent: null,
      schemaHistory: history,
      schemaHistoryIndex: history.length - 1,
      schemaDirty: true,
    });
  },

  moveSchemaNode: (nodeId, targetParentId, index) => {
    const state = get();
    if (!state.schemaTree) return;

    // Validate target is a valid container
    if (targetParentId !== null) {
      const targetNode = findNode(state.schemaTree.root, targetParentId);
      if (!targetNode || !canHaveChildren(targetNode.type)) return;
    }

    // Prevent moving a node into itself or its descendants
    const nodeToMove = findNode(state.schemaTree.root, nodeId);
    if (nodeToMove && targetParentId && isDescendant(nodeToMove, targetParentId)) return;

    const newRoot = moveNodeToParent(state.schemaTree.root, nodeId, targetParentId, index);
    if (!newRoot) return;

    const newTree: SchemaTree = {
      root: newRoot,
      stats: calculateStats(newRoot),
    };

    // Add to history
    const history = state.schemaHistory.slice(0, state.schemaHistoryIndex + 1);
    history.push(newTree);

    set({
      schemaTree: newTree,
      schemaContent: null,
      schemaHistory: history,
      schemaHistoryIndex: history.length - 1,
      schemaDirty: true,
    });
  },

  moveIfElseGroup: (ifNodeId, targetParentId, index) => {
    const state = get();
    if (!state.schemaTree) return;

    // Validate target is a valid container
    if (targetParentId !== null) {
      const targetNode = findNode(state.schemaTree.root, targetParentId);
      if (!targetNode || !canHaveChildren(targetNode.type)) return;
    }

    // Prevent moving the group into any of its own nodes (if or else blocks)
    if (targetParentId) {
      const group = getIfElseGroup(state.schemaTree.root, ifNodeId);
      for (const node of group) {
        if (isDescendant(node, targetParentId)) return;
      }
    }

    const newRoot = moveIfElseGroupToParent(state.schemaTree.root, ifNodeId, targetParentId, index);
    if (!newRoot) return;

    const newTree: SchemaTree = {
      root: newRoot,
      stats: calculateStats(newRoot),
    };

    // Add to history
    const history = state.schemaHistory.slice(0, state.schemaHistoryIndex + 1);
    history.push(newTree);

    set({
      schemaTree: newTree,
      schemaContent: null,
      schemaHistory: history,
      schemaHistoryIndex: history.length - 1,
      schemaDirty: true,
    });
  },

  // NOTE: This function should only be called from event handlers, not during render.
  // Calling it during render would cause recalculation on every render cycle.
  // Use pre-computed values (like dragGroupCount) for render-time access.
  getIfElseGroupIds: (ifNodeId) => {
    const state = get();
    if (!state.schemaTree) return [];
    const group = getIfElseGroup(state.schemaTree.root, ifNodeId);
    return group.map((n) => n.id!);
  },

  undo: () => {
    const state = get();
    if (state.schemaHistoryIndex > 0) {
      const newIndex = state.schemaHistoryIndex - 1;
      set({
        schemaTree: state.schemaHistory[newIndex],
        schemaHistoryIndex: newIndex,
        schemaDirty: newIndex > 0,
      });
    }
  },

  redo: () => {
    const state = get();
    if (state.schemaHistoryIndex < state.schemaHistory.length - 1) {
      const newIndex = state.schemaHistoryIndex + 1;
      set({
        schemaTree: state.schemaHistory[newIndex],
        schemaHistoryIndex: newIndex,
        schemaDirty: true,
      });
    }
  },

  canUndo: () => {
    const state = get();
    return state.schemaHistoryIndex > 0;
  },

  canRedo: () => {
    const state = get();
    return state.schemaHistoryIndex < state.schemaHistory.length - 1;
  },
});
