import { create } from "zustand";
import type { AppState, CreationProgress, LogEntry, Variable, SchemaTree, SchemaNode, Template, Settings } from "../types/schema";
import { DEFAULT_SETTINGS } from "../types/schema";

const initialProgress: CreationProgress = {
  current: 0,
  total: 0,
  status: "idle",
  logs: [],
};

// Helper: Generate unique ID for nodes
const generateNodeId = (): string => {
  return `node_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

// Helper: Ensure all nodes have IDs
const ensureNodeIds = (node: SchemaNode): SchemaNode => {
  return {
    ...node,
    id: node.id || generateNodeId(),
    children: node.children?.map(ensureNodeIds),
  };
};

// Helper: Calculate tree stats
const calculateStats = (node: SchemaNode): { folders: number; files: number; downloads: number } => {
  let folders = 0;
  let files = 0;
  let downloads = 0;

  const traverse = (n: SchemaNode) => {
    if (n.type === "folder") {
      folders++;
    } else {
      files++;
      if (n.url) downloads++;
    }
    n.children?.forEach(traverse);
  };

  traverse(node);
  return { folders, files, downloads };
};

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

// Helper: Update node by ID (immutable)
const updateNodeById = (node: SchemaNode, nodeId: string, updates: Partial<SchemaNode>): SchemaNode => {
  if (node.id === nodeId) {
    return { ...node, ...updates };
  }
  if (node.children) {
    return {
      ...node,
      children: node.children.map((child) => updateNodeById(child, nodeId, updates)),
    };
  }
  return node;
};

// Helper: Remove node by ID (immutable)
const removeNodeById = (node: SchemaNode, nodeId: string): SchemaNode | null => {
  if (node.children) {
    const filteredChildren = node.children
      .filter((child) => child.id !== nodeId)
      .map((child) => removeNodeById(child, nodeId))
      .filter((child): child is SchemaNode => child !== null);

    return { ...node, children: filteredChildren };
  }
  return node;
};

// Helper: Add node to parent (immutable)
const addNodeToParent = (
  node: SchemaNode,
  parentId: string | null,
  newNode: SchemaNode
): SchemaNode => {
  // If parentId is null, this means add to root (shouldn't happen, but handle it)
  if (parentId === null) {
    return node;
  }

  if (node.id === parentId) {
    return {
      ...node,
      children: [...(node.children || []), newNode],
    };
  }

  if (node.children) {
    return {
      ...node,
      children: node.children.map((child) => addNodeToParent(child, parentId, newNode)),
    };
  }

  return node;
};

// Helper: Move node to new parent (immutable)
const moveNodeToParent = (
  root: SchemaNode,
  nodeId: string,
  targetParentId: string | null,
  index: number
): SchemaNode | null => {
  // First, find the node to move
  const nodeToMove = findNode(root, nodeId);
  if (!nodeToMove) return root;

  // Remove the node from its current location
  let newRoot = removeNodeById(root, nodeId);
  if (!newRoot) return root;

  // Add it to the target parent at the specified index
  if (targetParentId === null || targetParentId === newRoot.id) {
    // Moving to root level - for now, we don't support this
    // Could be enhanced to support multiple root nodes
    return newRoot;
  }

  const addAtIndex = (node: SchemaNode): SchemaNode => {
    if (node.id === targetParentId) {
      const children = [...(node.children || [])];
      children.splice(index, 0, nodeToMove);
      return { ...node, children };
    }
    if (node.children) {
      return {
        ...node,
        children: node.children.map(addAtIndex),
      };
    }
    return node;
  };

  return addAtIndex(newRoot);
};

export const useAppStore = create<AppState>((set, get) => ({
  // Schema
  schemaPath: null,
  schemaContent: null,
  schemaTree: null,

  // Schema editing
  isEditMode: false,
  schemaDirty: false,
  schemaHistory: [],
  schemaHistoryIndex: -1,

  // Output settings
  outputPath: null,
  projectName: "my-project",

  // Variables
  variables: [
    { name: "%DATE%", value: new Date().toISOString().split("T")[0] },
  ],

  // Templates
  templates: [],
  templatesLoading: false,

  // Settings
  settings: DEFAULT_SETTINGS,
  settingsLoading: false,

  // Progress
  progress: initialProgress,

  // Options
  dryRun: false,
  overwrite: false,

  // Actions
  setSchemaPath: (path: string | null) => set({ schemaPath: path }),

  setSchemaContent: (content: string | null) => set({ schemaContent: content }),

  setSchemaTree: (tree: SchemaTree | null) => {
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
      });
    }
  },

  setOutputPath: (path: string | null) => set({ outputPath: path }),

  setProjectName: (name: string) => set({ projectName: name }),

  setVariables: (variables: Variable[]) => set({ variables }),

  updateVariable: (name: string, value: string) =>
    set((state) => ({
      variables: state.variables.map((v) =>
        v.name === name ? { ...v, value } : v
      ),
    })),

  addVariable: (name: string, value: string) =>
    set((state) => {
      // Ensure name has % wrapping
      const varName = name.startsWith("%") ? name : `%${name}%`;
      // Check if variable already exists
      if (state.variables.some((v) => v.name === varName)) {
        return state;
      }
      return {
        variables: [...state.variables, { name: varName, value }],
      };
    }),

  removeVariable: (name: string) =>
    set((state) => ({
      variables: state.variables.filter((v) => v.name !== name),
    })),

  setTemplates: (templates: Template[]) => set({ templates }),

  setTemplatesLoading: (templatesLoading: boolean) => set({ templatesLoading }),

  setSettings: (settings: Settings) => set({ settings }),

  setSettingsLoading: (settingsLoading: boolean) => set({ settingsLoading }),

  updateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) =>
    set((state) => ({
      settings: { ...state.settings, [key]: value },
    })),

  setProgress: (progress: Partial<CreationProgress>) =>
    set((state) => ({
      progress: { ...state.progress, ...progress },
    })),

  addLog: (log: Omit<LogEntry, "id" | "timestamp">) =>
    set((state) => ({
      progress: {
        ...state.progress,
        logs: [
          ...state.progress.logs,
          {
            ...log,
            id: crypto.randomUUID(),
            timestamp: Date.now(),
          },
        ],
      },
    })),

  clearLogs: () =>
    set((state) => ({
      progress: { ...state.progress, logs: [] },
    })),

  setDryRun: (dryRun: boolean) => set({ dryRun }),

  setOverwrite: (overwrite: boolean) => set({ overwrite }),

  reset: () =>
    set({
      schemaPath: null,
      schemaContent: null,
      schemaTree: null,
      progress: initialProgress,
      isEditMode: false,
      schemaDirty: false,
      schemaHistory: [],
      schemaHistoryIndex: -1,
    }),

  // Schema editing actions
  setEditMode: (enabled: boolean) => set({ isEditMode: enabled }),

  createNewSchema: () => {
    const newRoot: SchemaNode = {
      id: generateNodeId(),
      type: "folder",
      name: "%BASE%",
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
    });
  },

  updateSchemaNode: (nodeId: string, updates: Partial<SchemaNode>) => {
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
      schemaHistory: history,
      schemaHistoryIndex: history.length - 1,
      schemaDirty: true,
    });
  },

  addSchemaNode: (parentId: string | null, node: Partial<SchemaNode>) => {
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
      schemaHistory: history,
      schemaHistoryIndex: history.length - 1,
      schemaDirty: true,
    });
  },

  removeSchemaNode: (nodeId: string) => {
    const state = get();
    if (!state.schemaTree) return;

    // Don't allow removing the root node
    if (state.schemaTree.root.id === nodeId) return;

    const newRoot = removeNodeById(state.schemaTree.root, nodeId);
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
      schemaHistory: history,
      schemaHistoryIndex: history.length - 1,
      schemaDirty: true,
    });
  },

  moveSchemaNode: (nodeId: string, targetParentId: string | null, index: number) => {
    const state = get();
    if (!state.schemaTree) return;

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
      schemaHistory: history,
      schemaHistoryIndex: history.length - 1,
      schemaDirty: true,
    });
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
}));
