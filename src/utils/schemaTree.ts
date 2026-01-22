import type { SchemaNode } from "../types/schema";

/** Indentation in pixels per depth level for tree display */
export const INDENT_PX = 20;

/** Node types that can contain children */
const CONTAINER_TYPES = ["folder", "if", "else"] as const;

/**
 * Check if a node type can have children
 * @param nodeType - The type of node to check
 * @returns true if the node type can contain children
 */
export const canHaveChildren = (nodeType: string): boolean => {
  return (CONTAINER_TYPES as readonly string[]).includes(nodeType);
};

/**
 * Recursively search a schema tree to find a node by its ID
 * @param node - The root node to start searching from
 * @param nodeId - The unique ID of the node to find
 * @returns The matching node, or null if not found
 */
export const findNode = (node: SchemaNode, nodeId: string): SchemaNode | null => {
  if (node.id === nodeId) return node;
  if (node.children) {
    for (const child of node.children) {
      const found = findNode(child, nodeId);
      if (found) return found;
    }
  }
  return null;
};

/**
 * Find the parent node of a given node in the schema tree
 * @param root - The root node of the tree to search
 * @param nodeId - The unique ID of the node whose parent we want to find
 * @returns The parent node, or null if the node is the root or not found
 */
export const findParent = (root: SchemaNode, nodeId: string): SchemaNode | null => {
  if (root.children) {
    for (const child of root.children) {
      if (child.id === nodeId) return root;
      const found = findParent(child, nodeId);
      if (found) return found;
    }
  }
  return null;
};

/**
 * Check if a node is a descendant of another node
 * @param ancestor - The potential ancestor node
 * @param descendantId - The ID of the potential descendant
 * @returns true if descendantId is found within ancestor's subtree
 */
export const isDescendant = (ancestor: SchemaNode, descendantId: string): boolean => {
  if (ancestor.id === descendantId) return true;
  if (ancestor.children) {
    for (const child of ancestor.children) {
      if (isDescendant(child, descendantId)) return true;
    }
  }
  return false;
};

/**
 * Remove multiple nodes by their IDs from a tree (immutable)
 * @param node - The root node to process
 * @param nodeIds - Array of node IDs to remove
 * @returns New tree with nodes removed, or null if root was removed
 */
export const removeNodesById = (node: SchemaNode, nodeIds: string[]): SchemaNode | null => {
  if (node.children) {
    const filteredChildren = node.children
      .filter((child) => !nodeIds.includes(child.id!))
      .map((child) => removeNodesById(child, nodeIds))
      .filter((child): child is SchemaNode => child !== null);

    // Use undefined instead of empty array for consistency
    return { ...node, children: filteredChildren.length > 0 ? filteredChildren : undefined };
  }
  return node;
};

/**
 * Get if/else group - returns the if node and all immediately following else siblings
 * @param root - The root node of the tree
 * @param ifNodeId - The ID of the if node
 * @returns Array of nodes in the group, or empty array if not found or not an if node
 */
export const getIfElseGroup = (root: SchemaNode, ifNodeId: string): SchemaNode[] => {
  const parent = findParent(root, ifNodeId);
  if (!parent || !parent.children) return [];

  const ifIndex = parent.children.findIndex((c) => c.id === ifNodeId);
  if (ifIndex === -1) return [];

  const ifNode = parent.children[ifIndex];
  if (ifNode.type !== "if") return []; // Only works with if nodes

  const group: SchemaNode[] = [ifNode];

  // Collect all immediately following else siblings
  for (let i = ifIndex + 1; i < parent.children.length; i++) {
    const sibling = parent.children[i];
    if (sibling.type === "else") {
      group.push(sibling);
    } else {
      break; // Stop at first non-else sibling
    }
  }

  return group;
};

/**
 * Move an if/else group to a new parent (immutable)
 * @param root - The root node of the tree
 * @param ifNodeId - The ID of the if node to move
 * @param targetParentId - The ID of the new parent, or null for root
 * @param index - The index within the new parent's children
 * @returns New tree with the group moved, or null if operation failed
 */
export const moveIfElseGroupToParent = (
  root: SchemaNode,
  ifNodeId: string,
  targetParentId: string | null,
  index: number
): SchemaNode | null => {
  // Get the if/else group
  const group = getIfElseGroup(root, ifNodeId);
  if (group.length === 0) return root;

  const nodeIds = group.map((n) => n.id!);

  // Remove all nodes in the group from their current location
  let newRoot = removeNodesById(root, nodeIds);
  if (!newRoot) return root;

  // Add all nodes to the target parent at the specified index
  // Handle null or root as target - add to root's children
  if (targetParentId === null || targetParentId === newRoot.id) {
    const children = [...(newRoot.children || [])];
    children.splice(index, 0, ...group);
    return { ...newRoot, children };
  }

  const addAtIndex = (node: SchemaNode): SchemaNode => {
    if (node.id === targetParentId) {
      const children = [...(node.children || [])];
      children.splice(index, 0, ...group);
      return { ...node, children };
    }
    if (node.children) {
      return { ...node, children: node.children.map(addAtIndex) };
    }
    return node;
  };

  return addAtIndex(newRoot);
};
