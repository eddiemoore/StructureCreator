/**
 * XML Schema Parser for web mode.
 * Port of the Rust schema.rs parsing functionality.
 */

import type {
  SchemaTree,
  SchemaNode,
  SchemaHooks,
  NodeType,
} from "../../../types/schema";

// Extend FileSystemDirectoryHandle to include async iterator methods (for TS compatibility)
declare global {
  interface FileSystemDirectoryHandle {
    values(): AsyncIterableIterator<FileSystemHandle>;
  }
}

/**
 * Parse XML content into a SchemaTree.
 */
export const parseSchema = (content: string): SchemaTree => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(content, "application/xml");

  // Check for parsing errors
  const parseError = doc.querySelector("parsererror");
  if (parseError) {
    throw new Error(`XML parsing error: ${parseError.textContent}`);
  }

  // Get the root element
  const rootElement = doc.documentElement;
  if (!rootElement) {
    throw new Error("No root element found in XML");
  }

  // Parse hooks if present
  const hooks = parseHooks(rootElement);

  // Parse the root node
  const root = parseNode(rootElement);

  // Calculate stats
  const stats = calculateStats(root);

  return {
    root,
    stats,
    hooks,
  };
};

/**
 * Parse hooks from the schema.
 */
const parseHooks = (element: Element): SchemaHooks | undefined => {
  const hooksElement = element.querySelector("hooks");
  if (!hooksElement) return undefined;

  const postCreate: string[] = [];
  const postCreateElements = hooksElement.querySelectorAll("post_create");

  for (const pc of postCreateElements) {
    const command = pc.textContent?.trim();
    if (command) {
      postCreate.push(command);
    }
  }

  if (postCreate.length === 0) return undefined;

  return { post_create: postCreate };
};

/**
 * Parse a single node from an XML element.
 */
const parseNode = (element: Element): SchemaNode => {
  const tagName = element.tagName.toLowerCase();
  const name = element.getAttribute("name") || tagName;

  // Determine node type
  let type: NodeType;
  if (tagName === "folder" || tagName === "directory" || tagName === "dir") {
    type = "folder";
  } else if (tagName === "file") {
    type = "file";
  } else if (tagName === "if") {
    type = "if";
  } else if (tagName === "else") {
    type = "else";
  } else if (tagName === "repeat") {
    type = "repeat";
  } else {
    // Default: if it has children that aren't text, it's a folder; otherwise file
    const hasChildElements = Array.from(element.children).some(
      (child) =>
        !["hooks", "extends"].includes(child.tagName.toLowerCase())
    );
    type = hasChildElements ? "folder" : "file";
  }

  const node: SchemaNode = {
    type,
    name,
  };

  // Get attributes
  const attributes: Record<string, string> = {};
  for (const attr of element.attributes) {
    if (attr.name !== "name") {
      attributes[attr.name] = attr.value;
    }
  }
  if (Object.keys(attributes).length > 0) {
    node.attributes = attributes;
  }

  // Handle type-specific attributes
  if (type === "file") {
    // Check for URL
    const url = element.getAttribute("url");
    if (url) {
      node.url = url;
    }

    // Check for content
    const content = getTextContent(element);
    if (content && !url) {
      node.content = content;
    }
  }

  if (type === "if") {
    // Get condition variable
    const condVar = element.getAttribute("var") || element.getAttribute("condition");
    if (condVar) {
      // Remove % delimiters if present
      node.condition_var = condVar.replace(/^%|%$/g, "");
    }
  }

  if (type === "repeat") {
    // Get repeat count
    node.repeat_count = element.getAttribute("count") || "1";
    // Get repeat variable name
    node.repeat_as = element.getAttribute("as") || "i";
  }

  // Parse children (skip hooks and extends elements)
  const children: SchemaNode[] = [];
  for (const child of element.children) {
    const childTag = child.tagName.toLowerCase();
    if (childTag !== "hooks" && childTag !== "extends") {
      children.push(parseNode(child));
    }
  }

  if (children.length > 0) {
    node.children = children;
  }

  return node;
};

/**
 * Get text content from an element (direct text, not from children).
 */
const getTextContent = (element: Element): string | undefined => {
  let text = "";
  for (const node of element.childNodes) {
    if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.CDATA_SECTION_NODE) {
      text += node.textContent;
    }
  }
  const trimmed = text.trim();
  return trimmed || undefined;
};

/**
 * Calculate statistics for a schema tree.
 */
const calculateStats = (
  node: SchemaNode
): { folders: number; files: number; downloads: number } => {
  let folders = 0;
  let files = 0;
  let downloads = 0;

  const traverse = (n: SchemaNode) => {
    if (n.type === "folder") {
      folders++;
    } else if (n.type === "file") {
      files++;
      if (n.url) {
        downloads++;
      }
    }
    // if/else/repeat are control structures, not counted
    n.children?.forEach(traverse);
  };

  traverse(node);
  return { folders, files, downloads };
};

/**
 * Export a SchemaTree back to XML.
 */
export const exportSchemaXml = (tree: SchemaTree): string => {
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');

  const nodeToXml = (node: SchemaNode, indent: number): void => {
    const pad = "  ".repeat(indent);
    const tagName = node.type === "folder" ? "folder" : node.type;

    // Build attributes string
    const attrs: string[] = [`name="${escapeXml(node.name)}"`];

    if (node.url) {
      attrs.push(`url="${escapeXml(node.url)}"`);
    }

    if (node.condition_var) {
      attrs.push(`var="${escapeXml(node.condition_var)}"`);
    }

    if (node.repeat_count && node.type === "repeat") {
      attrs.push(`count="${escapeXml(node.repeat_count)}"`);
      if (node.repeat_as && node.repeat_as !== "i") {
        attrs.push(`as="${escapeXml(node.repeat_as)}"`);
      }
    }

    // Add any additional attributes
    if (node.attributes) {
      for (const [key, value] of Object.entries(node.attributes)) {
        if (!["name", "url", "var", "count", "as", "condition"].includes(key)) {
          attrs.push(`${key}="${escapeXml(value)}"`);
        }
      }
    }

    const attrStr = attrs.join(" ");

    if (node.children && node.children.length > 0) {
      lines.push(`${pad}<${tagName} ${attrStr}>`);
      for (const child of node.children) {
        nodeToXml(child, indent + 1);
      }
      lines.push(`${pad}</${tagName}>`);
    } else if (node.content) {
      lines.push(`${pad}<${tagName} ${attrStr}>${escapeXml(node.content)}</${tagName}>`);
    } else {
      lines.push(`${pad}<${tagName} ${attrStr} />`);
    }
  };

  nodeToXml(tree.root, 0);

  // Add hooks if present
  if (tree.hooks && tree.hooks.post_create.length > 0) {
    const lastLine = lines[lines.length - 1];
    const rootCloseTag = `</${tree.root.type === "folder" ? "folder" : tree.root.type}>`;

    if (lastLine.endsWith(rootCloseTag)) {
      // Insert hooks before closing root tag
      lines.pop();
      lines.push("  <hooks>");
      for (const cmd of tree.hooks.post_create) {
        lines.push(`    <post_create>${escapeXml(cmd)}</post_create>`);
      }
      lines.push("  </hooks>");
      lines.push(lastLine);
    }
  }

  return lines.join("\n");
};

/**
 * Escape special XML characters.
 */
const escapeXml = (str: string): string => {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
};

/**
 * Scan a directory handle and convert to SchemaTree.
 */
export const scanDirectoryToSchema = async (
  handle: FileSystemDirectoryHandle,
  name?: string
): Promise<SchemaTree> => {
  const root = await scanDirectoryNode(handle, name || handle.name);
  const stats = calculateStats(root);

  return {
    root,
    stats,
  };
};

/**
 * Recursively scan a directory handle.
 */
const scanDirectoryNode = async (
  handle: FileSystemDirectoryHandle,
  name: string
): Promise<SchemaNode> => {
  const children: SchemaNode[] = [];

  for await (const entry of handle.values()) {
    if (entry.kind === "directory") {
      const childHandle = await handle.getDirectoryHandle(entry.name);
      const childNode = await scanDirectoryNode(childHandle, entry.name);
      children.push(childNode);
    } else {
      children.push({
        type: "file",
        name: entry.name,
      });
    }
  }

  // Sort: folders first, then files, alphabetically
  children.sort((a, b) => {
    if (a.type === "folder" && b.type !== "folder") return -1;
    if (a.type !== "folder" && b.type === "folder") return 1;
    return a.name.localeCompare(b.name);
  });

  return {
    type: "folder",
    name,
    children: children.length > 0 ? children : undefined,
  };
};
