import { describe, it, expect } from "vitest";
import {
  findNode,
  findParent,
  canHaveChildren,
  isDescendant,
  removeNodesById,
  getIfElseGroup,
  moveIfElseGroupToParent,
  INDENT_PX,
} from "./schemaTree";
import type { SchemaNode } from "../types/schema";

// Helper to create test nodes
const createNode = (
  id: string,
  type: SchemaNode["type"],
  name: string,
  children?: SchemaNode[]
): SchemaNode => ({
  id,
  type,
  name,
  children,
});

describe("schemaTree utilities", () => {
  describe("INDENT_PX", () => {
    it("should be 20 pixels", () => {
      expect(INDENT_PX).toBe(20);
    });
  });

  describe("canHaveChildren", () => {
    it("returns true for folder type", () => {
      expect(canHaveChildren("folder")).toBe(true);
    });

    it("returns true for if type", () => {
      expect(canHaveChildren("if")).toBe(true);
    });

    it("returns true for else type", () => {
      expect(canHaveChildren("else")).toBe(true);
    });

    it("returns false for file type", () => {
      expect(canHaveChildren("file")).toBe(false);
    });

    it("returns false for unknown types", () => {
      expect(canHaveChildren("unknown")).toBe(false);
      expect(canHaveChildren("")).toBe(false);
    });
  });

  describe("findNode", () => {
    const tree: SchemaNode = createNode("root", "folder", "Root", [
      createNode("child1", "folder", "Child 1", [
        createNode("grandchild1", "file", "Grandchild 1"),
        createNode("grandchild2", "file", "Grandchild 2"),
      ]),
      createNode("child2", "file", "Child 2"),
      createNode("child3", "if", "If Block", [
        createNode("ifChild", "file", "If Child"),
      ]),
    ]);

    it("finds the root node", () => {
      const result = findNode(tree, "root");
      expect(result).not.toBeNull();
      expect(result?.name).toBe("Root");
    });

    it("finds a direct child", () => {
      const result = findNode(tree, "child1");
      expect(result).not.toBeNull();
      expect(result?.name).toBe("Child 1");
    });

    it("finds a deeply nested node", () => {
      const result = findNode(tree, "grandchild2");
      expect(result).not.toBeNull();
      expect(result?.name).toBe("Grandchild 2");
    });

    it("finds a node inside conditional block", () => {
      const result = findNode(tree, "ifChild");
      expect(result).not.toBeNull();
      expect(result?.name).toBe("If Child");
    });

    it("returns null for non-existent node", () => {
      const result = findNode(tree, "nonexistent");
      expect(result).toBeNull();
    });

    it("returns null when searching empty children", () => {
      const nodeWithNoChildren = createNode("single", "file", "Single");
      const result = findNode(nodeWithNoChildren, "other");
      expect(result).toBeNull();
    });
  });

  describe("findParent", () => {
    const tree: SchemaNode = createNode("root", "folder", "Root", [
      createNode("child1", "folder", "Child 1", [
        createNode("grandchild1", "file", "Grandchild 1"),
      ]),
      createNode("child2", "file", "Child 2"),
    ]);

    it("returns null for root node (no parent)", () => {
      const result = findParent(tree, "root");
      expect(result).toBeNull();
    });

    it("finds parent of direct child", () => {
      const result = findParent(tree, "child1");
      expect(result).not.toBeNull();
      expect(result?.id).toBe("root");
    });

    it("finds parent of deeply nested node", () => {
      const result = findParent(tree, "grandchild1");
      expect(result).not.toBeNull();
      expect(result?.id).toBe("child1");
    });

    it("returns null for non-existent node", () => {
      const result = findParent(tree, "nonexistent");
      expect(result).toBeNull();
    });
  });

  describe("isDescendant", () => {
    const tree: SchemaNode = createNode("root", "folder", "Root", [
      createNode("child1", "folder", "Child 1", [
        createNode("grandchild1", "file", "Grandchild 1"),
        createNode("grandchild2", "folder", "Grandchild 2", [
          createNode("greatgrandchild", "file", "Great Grandchild"),
        ]),
      ]),
      createNode("child2", "file", "Child 2"),
    ]);

    it("returns true when node is the same as ancestor (self-check)", () => {
      expect(isDescendant(tree, "root")).toBe(true);
    });

    it("returns true for direct child", () => {
      expect(isDescendant(tree, "child1")).toBe(true);
    });

    it("returns true for deeply nested descendant", () => {
      expect(isDescendant(tree, "greatgrandchild")).toBe(true);
    });

    it("returns false for non-descendant", () => {
      const child1 = findNode(tree, "child1")!;
      expect(isDescendant(child1, "child2")).toBe(false);
    });

    it("returns false for ancestor (reverse check)", () => {
      const grandchild = findNode(tree, "grandchild1")!;
      expect(isDescendant(grandchild, "root")).toBe(false);
    });

    it("returns false for non-existent node", () => {
      expect(isDescendant(tree, "nonexistent")).toBe(false);
    });

    it("works with node that has no children", () => {
      const leaf = createNode("leaf", "file", "Leaf");
      expect(isDescendant(leaf, "leaf")).toBe(true);
      expect(isDescendant(leaf, "other")).toBe(false);
    });
  });

  describe("removeNodesById", () => {
    it("removes a single node", () => {
      const tree = createNode("root", "folder", "Root", [
        createNode("child1", "file", "Child 1"),
        createNode("child2", "file", "Child 2"),
      ]);

      const result = removeNodesById(tree, ["child1"]);
      expect(result?.children).toHaveLength(1);
      expect(result?.children?.[0].id).toBe("child2");
    });

    it("removes multiple nodes", () => {
      const tree = createNode("root", "folder", "Root", [
        createNode("child1", "file", "Child 1"),
        createNode("child2", "file", "Child 2"),
        createNode("child3", "file", "Child 3"),
      ]);

      const result = removeNodesById(tree, ["child1", "child3"]);
      expect(result?.children).toHaveLength(1);
      expect(result?.children?.[0].id).toBe("child2");
    });

    it("removes nested nodes", () => {
      const tree = createNode("root", "folder", "Root", [
        createNode("child1", "folder", "Child 1", [
          createNode("grandchild1", "file", "Grandchild 1"),
          createNode("grandchild2", "file", "Grandchild 2"),
        ]),
      ]);

      const result = removeNodesById(tree, ["grandchild1"]);
      expect(result?.children?.[0].children).toHaveLength(1);
      expect(result?.children?.[0].children?.[0].id).toBe("grandchild2");
    });

    it("returns undefined for children when all are removed", () => {
      const tree = createNode("root", "folder", "Root", [
        createNode("child1", "file", "Child 1"),
      ]);

      const result = removeNodesById(tree, ["child1"]);
      expect(result?.children).toBeUndefined();
    });

    it("returns node unchanged when no IDs match", () => {
      const tree = createNode("root", "folder", "Root", [
        createNode("child1", "file", "Child 1"),
      ]);

      const result = removeNodesById(tree, ["nonexistent"]);
      expect(result?.children).toHaveLength(1);
    });
  });

  describe("getIfElseGroup", () => {
    it("returns if node and following else siblings", () => {
      const tree = createNode("root", "folder", "Root", [
        createNode("if1", "if", "", []),
        createNode("else1", "else", "", []),
        createNode("else2", "else", "", []),
      ]);

      const group = getIfElseGroup(tree, "if1");
      expect(group).toHaveLength(3);
      expect(group[0].id).toBe("if1");
      expect(group[1].id).toBe("else1");
      expect(group[2].id).toBe("else2");
    });

    it("stops at non-else node", () => {
      const tree = createNode("root", "folder", "Root", [
        createNode("if1", "if", "", []),
        createNode("else1", "else", "", []),
        createNode("file1", "file", "File"),
        createNode("else2", "else", "", []),
      ]);

      const group = getIfElseGroup(tree, "if1");
      expect(group).toHaveLength(2);
      expect(group[0].id).toBe("if1");
      expect(group[1].id).toBe("else1");
    });

    it("returns just if node when no else follows", () => {
      const tree = createNode("root", "folder", "Root", [
        createNode("if1", "if", "", []),
        createNode("file1", "file", "File"),
      ]);

      const group = getIfElseGroup(tree, "if1");
      expect(group).toHaveLength(1);
      expect(group[0].id).toBe("if1");
    });

    it("returns empty array for non-if node", () => {
      const tree = createNode("root", "folder", "Root", [
        createNode("else1", "else", "", []),
      ]);

      const group = getIfElseGroup(tree, "else1");
      expect(group).toHaveLength(0);
    });

    it("returns empty array for non-existent node", () => {
      const tree = createNode("root", "folder", "Root", [
        createNode("if1", "if", "", []),
      ]);

      const group = getIfElseGroup(tree, "nonexistent");
      expect(group).toHaveLength(0);
    });

    it("works with nested if/else", () => {
      const tree = createNode("root", "folder", "Root", [
        createNode("folder1", "folder", "Folder", [
          createNode("if1", "if", "", []),
          createNode("else1", "else", "", []),
        ]),
      ]);

      const group = getIfElseGroup(tree, "if1");
      expect(group).toHaveLength(2);
    });
  });

  describe("moveIfElseGroupToParent", () => {
    it("moves if/else group to new parent", () => {
      const tree = createNode("root", "folder", "Root", [
        createNode("if1", "if", "", []),
        createNode("else1", "else", "", []),
        createNode("folder1", "folder", "Folder", []),
      ]);

      const result = moveIfElseGroupToParent(tree, "if1", "folder1", 0);

      // Root should only have folder1
      expect(result?.children).toHaveLength(1);
      expect(result?.children?.[0].id).toBe("folder1");

      // folder1 should have the if/else group
      expect(result?.children?.[0].children).toHaveLength(2);
      expect(result?.children?.[0].children?.[0].id).toBe("if1");
      expect(result?.children?.[0].children?.[1].id).toBe("else1");
    });

    it("moves group to root level", () => {
      const tree = createNode("root", "folder", "Root", [
        createNode("folder1", "folder", "Folder", [
          createNode("if1", "if", "", []),
          createNode("else1", "else", "", []),
        ]),
      ]);

      const result = moveIfElseGroupToParent(tree, "if1", "root", 1);

      // Root should have folder1 + if + else
      expect(result?.children).toHaveLength(3);
      expect(result?.children?.[0].id).toBe("folder1");
      expect(result?.children?.[1].id).toBe("if1");
      expect(result?.children?.[2].id).toBe("else1");

      // folder1 should be empty
      expect(result?.children?.[0].children).toBeUndefined();
    });

    it("returns root unchanged for non-existent if node", () => {
      const tree = createNode("root", "folder", "Root", [
        createNode("file1", "file", "File"),
      ]);

      const result = moveIfElseGroupToParent(tree, "nonexistent", "root", 0);
      expect(result).toEqual(tree);
    });

    it("handles null targetParentId as root", () => {
      const tree = createNode("root", "folder", "Root", [
        createNode("folder1", "folder", "Folder", [
          createNode("if1", "if", "", []),
        ]),
      ]);

      const result = moveIfElseGroupToParent(tree, "if1", null, 0);

      // If should be at root level
      expect(result?.children?.[0].id).toBe("if1");
    });
  });
});
