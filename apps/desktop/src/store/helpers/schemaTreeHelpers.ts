import type { SchemaNode } from "../../types/schema";
import { findNode } from "../../utils/schemaTree";

/**
 * Generate a unique ID for schema nodes
 */
export const generateNodeId = (): string => {
  return `node_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
};

/**
 * Ensure all nodes in a tree have unique IDs
 */
export const ensureNodeIds = (node: SchemaNode): SchemaNode => {
  return {
    ...node,
    id: node.id || generateNodeId(),
    children: node.children?.map(ensureNodeIds),
  };
};

/**
 * Calculate statistics for a schema tree
 */
export const calculateStats = (node: SchemaNode): { folders: number; files: number; downloads: number } => {
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

/**
 * Update a node by ID (immutable)
 */
export const updateNodeById = (node: SchemaNode, nodeId: string, updates: Partial<SchemaNode>): SchemaNode => {
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

/**
 * Remove a node by ID (immutable)
 */
export const removeNodeById = (node: SchemaNode, nodeId: string): SchemaNode | null => {
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

/**
 * Add a node to a parent (immutable)
 */
export const addNodeToParent = (
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

/**
 * Move a node to a new parent at a specified index (immutable)
 */
export const moveNodeToParent = (
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
