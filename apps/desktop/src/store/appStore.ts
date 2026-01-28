import { create } from "zustand";
import type { AppState, CreationProgress, LogEntry, Variable, SchemaTree, SchemaNode, Template, Settings, ValidationRule, ValidationError, DiffResult, TemplateSortOption, RecentProject, UpdateState, UpdateStatus, UpdateInfo, UpdateProgress, CreatedItem } from "../types/schema";
import { DEFAULT_SETTINGS } from "../types/schema";
import { findNode, canHaveChildren, isDescendant, removeNodesById, getIfElseGroup, moveIfElseGroupToParent } from "../utils/schemaTree";

const initialProgress: CreationProgress = {
  current: 0,
  total: 0,
  status: "idle",
  logs: [],
};

const initialUpdateState: UpdateState = {
  status: "idle",
  info: null,
  progress: null,
  error: null,
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
    } else if (n.type === "file") {
      files++;
      if (n.url) downloads++;
    }
    // if/else/repeat are control structures, not counted in stats
    n.children?.forEach(traverse);
  };

  traverse(node);
  return { folders, files, downloads };
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

    // Use undefined instead of empty array for consistency
    return { ...node, children: filteredChildren.length > 0 ? filteredChildren : undefined };
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
  // Handle null or root as target - add to root's children
  if (targetParentId === null || targetParentId === newRoot.id) {
    const children = [...(newRoot.children || [])];
    children.splice(index, 0, nodeToMove);
    return { ...newRoot, children };
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

  // Watch mode
  watchEnabled: false,
  watchAutoCreate: true,
  isWatching: false,

  // Variables
  variables: [],
  validationErrors: [],

  // Templates
  templates: [],
  templatesLoading: false,

  // Recent Projects
  recentProjects: [],
  recentProjectsLoading: false,

  // Template filtering
  templateSearchQuery: "",
  templateFilterTags: [],
  templateSortOption: "default",
  allTags: [],

  // Settings
  settings: DEFAULT_SETTINGS,
  settingsLoading: false,

  // Progress
  progress: initialProgress,

  // Options
  dryRun: false,
  overwrite: false,

  // Diff Preview
  diffResult: null,
  diffLoading: false,
  diffError: null,
  showDiffModal: false,

  // Wizard
  wizardState: null,

  // Update
  updateState: initialUpdateState,

  // Undo
  lastCreation: null,

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
    set((state) => {
      // Clean name for comparison (validation errors use clean names without % delimiters)
      const cleanName = name.replace(/^%|%$/g, "");
      return {
        variables: state.variables.map((v) =>
          v.name === name ? { ...v, value } : v
        ),
        // Clear validation errors when value changes
        validationErrors: state.validationErrors.filter(
          (e) => e.variable_name !== cleanName
        ),
      };
    }),

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
    set((state) => {
      // Clean name for comparison (validation errors use clean names without % delimiters)
      const cleanName = name.replace(/^%|%$/g, "");
      return {
        variables: state.variables.filter((v) => v.name !== name),
        validationErrors: state.validationErrors.filter(
          (e) => e.variable_name !== cleanName
        ),
      };
    }),

  updateVariableValidation: (
    name: string,
    validation: ValidationRule | undefined
  ) =>
    set((state) => ({
      variables: state.variables.map((v) =>
        v.name === name ? { ...v, validation } : v
      ),
    })),

  setValidationErrors: (validationErrors: ValidationError[]) =>
    set({ validationErrors }),

  setTemplates: (templates: Template[]) => set({ templates }),

  setTemplatesLoading: (templatesLoading: boolean) => set({ templatesLoading }),

  setRecentProjects: (recentProjects: RecentProject[]) => set({ recentProjects }),

  setRecentProjectsLoading: (recentProjectsLoading: boolean) => set({ recentProjectsLoading }),

  // Template filtering actions
  setTemplateSearchQuery: (templateSearchQuery: string) => set({ templateSearchQuery }),

  setTemplateFilterTags: (templateFilterTags: string[]) => set({ templateFilterTags }),

  addTemplateFilterTag: (tag: string) =>
    set((state) => ({
      templateFilterTags: state.templateFilterTags.includes(tag)
        ? state.templateFilterTags
        : [...state.templateFilterTags, tag],
    })),

  removeTemplateFilterTag: (tag: string) =>
    set((state) => ({
      templateFilterTags: state.templateFilterTags.filter((t) => t !== tag),
    })),

  clearTemplateFilters: () =>
    set({
      templateSearchQuery: "",
      templateFilterTags: [],
      templateSortOption: "default",
    }),

  setTemplateSortOption: (templateSortOption: TemplateSortOption) =>
    set({ templateSortOption }),

  setAllTags: (allTags: string[]) => set({ allTags }),

  getFilteredTemplates: () => {
    const state = get();

    // Short-circuit if no filters are active
    const hasSearch = state.templateSearchQuery.trim() !== "";
    const hasTagFilter = state.templateFilterTags.length > 0;
    const hasSort = state.templateSortOption !== "default";

    if (!hasSearch && !hasTagFilter && !hasSort) {
      return state.templates;
    }

    let filtered = [...state.templates];

    // Apply search filter (searches name, description, and tags)
    // Note: tags are already stored lowercase, so no need to call toLowerCase() on them
    if (hasSearch) {
      const query = state.templateSearchQuery.toLowerCase();
      filtered = filtered.filter(
        (t) =>
          t.name.toLowerCase().includes(query) ||
          (t.description && t.description.toLowerCase().includes(query)) ||
          t.tags.some((tag) => tag.includes(query))
      );
    }

    // Apply tag filter (AND logic - template must have all selected tags)
    if (hasTagFilter) {
      filtered = filtered.filter((t) =>
        state.templateFilterTags.every((tag) => t.tags.includes(tag))
      );
    }

    // Apply sorting
    switch (state.templateSortOption) {
      case "name_asc":
        filtered.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case "name_desc":
        filtered.sort((a, b) => b.name.localeCompare(a.name));
        break;
      case "created_asc":
        filtered.sort((a, b) => a.created_at.localeCompare(b.created_at));
        break;
      case "created_desc":
        filtered.sort((a, b) => b.created_at.localeCompare(a.created_at));
        break;
      case "updated_asc":
        filtered.sort((a, b) => a.updated_at.localeCompare(b.updated_at));
        break;
      case "updated_desc":
        filtered.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
        break;
      case "usage_asc":
        filtered.sort((a, b) => a.use_count - b.use_count);
        break;
      case "usage_desc":
        filtered.sort((a, b) => b.use_count - a.use_count);
        break;
      default:
        // Default: favorites first, then by use count, then by updated date
        // This is already the order from the database
        break;
    }

    return filtered;
  },

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

  // Diff Preview actions
  setDiffResult: (diffResult: DiffResult | null) => set({ diffResult }),
  setDiffLoading: (diffLoading: boolean) => set({ diffLoading }),
  setDiffError: (diffError: string | null) => set({ diffError }),
  setShowDiffModal: (showDiffModal: boolean) => set({ showDiffModal }),

  // Watch mode actions
  setWatchEnabled: (watchEnabled: boolean) => set({ watchEnabled }),
  setWatchAutoCreate: (watchAutoCreate: boolean) => set({ watchAutoCreate }),
  setIsWatching: (isWatching: boolean) => set({ isWatching }),

  // Reset transient state but preserve user preferences like watchAutoCreate
  // (which is persisted to the database and loaded on startup)
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
      diffResult: null,
      diffLoading: false,
      diffError: null,
      showDiffModal: false,
      watchEnabled: false,
      isWatching: false,
      lastCreation: null,
    }),

  // Schema editing actions
  setEditMode: (enabled: boolean) => set({ isEditMode: enabled }),

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
      schemaContent: null,
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

  removeSchemaNode: (nodeId: string) => {
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

  moveSchemaNode: (nodeId: string, targetParentId: string | null, index: number) => {
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

  moveIfElseGroup: (ifNodeId: string, targetParentId: string | null, index: number) => {
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
  getIfElseGroupIds: (ifNodeId: string) => {
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

  // Wizard actions
  openWizard: (template: Template) => {
    set({
      wizardState: {
        isOpen: true,
        template,
        currentStep: 0,
        answers: {},
        previewTree: null,
      },
    });
  },

  closeWizard: () => {
    set({ wizardState: null });
  },

  setWizardStep: (step: number) => {
    set((state) => {
      if (!state.wizardState) return state;
      return {
        wizardState: {
          ...state.wizardState,
          currentStep: step,
        },
      };
    });
  },

  updateWizardAnswer: (questionId: string, value: string | boolean | string[]) => {
    set((state) => {
      if (!state.wizardState) return state;
      return {
        wizardState: {
          ...state.wizardState,
          answers: {
            ...state.wizardState.answers,
            [questionId]: value,
          },
        },
      };
    });
  },

  setWizardPreviewTree: (tree: SchemaTree | null) => {
    set((state) => {
      if (!state.wizardState) return state;
      return {
        wizardState: {
          ...state.wizardState,
          previewTree: tree,
        },
      };
    });
  },

  // Undo actions
  setLastCreation: (items: CreatedItem[] | null) =>
    set({ lastCreation: items }),

  canUndoCreation: () => {
    const state = get();
    if (!state.lastCreation || state.lastCreation.length === 0) {
      return false;
    }
    // Check if there are any items that can be undone (not pre-existing)
    return state.lastCreation.some((item) => !item.pre_existed);
  },

  // Update actions
  setUpdateStatus: (status: UpdateStatus) =>
    set((state) => ({
      updateState: { ...state.updateState, status },
    })),

  setUpdateInfo: (info: UpdateInfo | null) =>
    set((state) => ({
      updateState: { ...state.updateState, info },
    })),

  setUpdateProgress: (progress: UpdateProgress | null) =>
    set((state) => ({
      updateState: { ...state.updateState, progress },
    })),

  setUpdateError: (error: string | null) =>
    set((state) => ({
      updateState: { ...state.updateState, error, status: error ? "error" : state.updateState.status },
    })),

  resetUpdateState: () =>
    set({ updateState: initialUpdateState }),

}));
