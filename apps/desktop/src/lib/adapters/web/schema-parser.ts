/**
 * XML Schema Parser for web mode.
 * Port of the Rust schema.rs parsing functionality.
 */

/// <reference path="./file-system-api.d.ts" />

import type {
  SchemaTree,
  SchemaNode,
  SchemaHooks,
  NodeType,
  VariableDefinition,
} from "../../../types/schema";
import { MAX_DIRECTORY_SCAN_DEPTH, MAX_SCHEMA_DEPTH, validatePathComponent, calculateSchemaStats } from "./constants";

/**
 * Validate a repeat_as variable name.
 * Must be a valid identifier: starts with letter/underscore, contains only letters/numbers/underscores.
 */
const isValidRepeatAs = (value: string): boolean => {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
};

// Shared DOMParser instance (stateless, safe to reuse)
const domParser = new DOMParser();

// Counter for generating unique placeholder names for invalid nodes within a single parse
let invalidNameCounter = 0;

/**
 * Parse XML content into a SchemaTree.
 */
export const parseSchema = (content: string): SchemaTree => {
  // Reset counter for each parse to ensure predictable placeholder names
  invalidNameCounter = 0;

  const doc = domParser.parseFromString(content, "application/xml");

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

  // Parse variable definitions if present
  const variableDefinitions = parseVariableDefinitions(rootElement);

  // Parse the root node with depth tracking
  const root = parseNode(rootElement, 0);

  // Calculate stats
  const stats = calculateSchemaStats(root);

  return {
    root,
    stats,
    hooks,
    variableDefinitions,
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
 * Parse variable definitions from the schema.
 */
const parseVariableDefinitions = (element: Element): VariableDefinition[] | undefined => {
  const variablesElement = element.querySelector("variables");
  if (!variablesElement) return undefined;

  const definitions: VariableDefinition[] = [];
  const variableElements = variablesElement.querySelectorAll("variable");

  for (const varEl of variableElements) {
    const name = varEl.getAttribute("name");
    if (!name) continue; // Name is required

    const def: VariableDefinition = { name };

    const description = varEl.getAttribute("description");
    if (description) def.description = description;

    const placeholder = varEl.getAttribute("placeholder");
    if (placeholder) def.placeholder = placeholder;

    const example = varEl.getAttribute("example");
    if (example) def.example = example;

    const required = varEl.getAttribute("required");
    if (required) def.required = required.toLowerCase() === "true";

    const pattern = varEl.getAttribute("pattern");
    if (pattern) def.pattern = pattern;

    // Support both camelCase and kebab-case
    const minLength = varEl.getAttribute("minLength") || varEl.getAttribute("min-length");
    if (minLength) def.minLength = parseInt(minLength, 10);

    const maxLength = varEl.getAttribute("maxLength") || varEl.getAttribute("max-length");
    if (maxLength) def.maxLength = parseInt(maxLength, 10);

    definitions.push(def);
  }

  return definitions.length > 0 ? definitions : undefined;
};

/**
 * Parse a single node from an XML element with depth limiting.
 */
const parseNode = (element: Element, depth: number): SchemaNode => {
  // Check recursion depth to prevent stack overflow from malicious schemas
  if (depth >= MAX_SCHEMA_DEPTH) {
    return {
      type: "file",
      name: `[max depth ${MAX_SCHEMA_DEPTH} exceeded]`,
    };
  }

  const tagName = element.tagName.toLowerCase();
  let name = element.getAttribute("name") || tagName;

  // Validate name for file/folder nodes to prevent path traversal
  // Skip validation for control structures (if/else/repeat) which use internal names
  if (!["if", "else", "repeat", "hooks", "extends"].includes(tagName)) {
    try {
      // Only validate if name doesn't contain variables (those are validated at runtime)
      if (!name.includes("%")) {
        validatePathComponent(name);
      }
    } catch {
      // Replace invalid name with a unique safe placeholder
      invalidNameCounter++;
      name = `[invalid-name-${tagName}-${invalidNameCounter}]`;
    }
  }

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

    // Check for generator
    const generate = element.getAttribute("generate");
    if (generate === "image" || generate === "sqlite") {
      node.generate = generate;

      // Build generateConfig from generator-specific attributes
      // These match the Rust parser's attribute consolidation
      const configAttrs: string[] = [];
      const generatorAttrs = ["width", "height", "background", "format"];
      for (const attr of generatorAttrs) {
        const value = element.getAttribute(attr);
        if (value) {
          configAttrs.push(`${attr}="${value}"`);
        }
      }

      // If there are inline attributes, use them as generateConfig
      if (configAttrs.length > 0) {
        node.generateConfig = configAttrs.join(" ");
      }

      // Also capture any child content for complex configs (e.g., SQL)
      const content = getTextContent(element);
      if (content) {
        // For sqlite, content may contain SQL statements
        // For image, content may have additional attributes
        if (node.generateConfig) {
          node.generateConfig += "\n" + content;
        } else {
          node.generateConfig = content;
        }
      }
    }

    // Check for content (only if not a generator and no URL)
    if (!generate) {
      const content = getTextContent(element);
      if (content && !url) {
        node.content = content;
      }
    }

    // Handle template attribute for file nodes
    const templateAttr = element.getAttribute("template");
    if (templateAttr && templateAttr.toLowerCase() === "true") {
      node.template = true;
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
    // Get repeat variable name (validate it's a proper identifier)
    const repeatAs = element.getAttribute("as") || "i";
    node.repeat_as = isValidRepeatAs(repeatAs) ? repeatAs : "i";
  }

  // Parse children (skip hooks, extends, and variables elements)
  const children: SchemaNode[] = [];
  for (const child of element.children) {
    const childTag = child.tagName.toLowerCase();
    if (childTag !== "hooks" && childTag !== "extends" && childTag !== "variables") {
      children.push(parseNode(child, depth + 1));
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
 * Export a SchemaTree back to XML.
 */
export const exportSchemaXml = (tree: SchemaTree): string => {
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');

  const nodeToXml = (
    node: SchemaNode,
    indent: number,
    depth: number,
    hooks?: SchemaHooks
  ): void => {
    // Check depth to prevent stack overflow from malformed trees
    if (depth >= MAX_SCHEMA_DEPTH) {
      const pad = "  ".repeat(indent);
      lines.push(`${pad}<!-- max depth ${MAX_SCHEMA_DEPTH} exceeded -->`);
      return;
    }

    const pad = "  ".repeat(indent);
    const tagName = node.type === "folder" ? "folder" : node.type;

    // Build attributes string
    const attrs: string[] = [`name="${escapeXml(node.name)}"`];

    if (node.url) {
      attrs.push(`url="${escapeXml(node.url)}"`);
    }

    if (node.generate) {
      attrs.push(`generate="${escapeXml(node.generate)}"`);
    }

    if (node.template) {
      attrs.push(`template="true"`);
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
    const hasChildren = node.children && node.children.length > 0;
    const hasHooks = hooks && hooks.post_create.length > 0;
    const hasContent = hasChildren || hasHooks;

    if (hasContent) {
      lines.push(`${pad}<${tagName} ${attrStr}>`);
      // Add children
      if (node.children) {
        for (const child of node.children) {
          nodeToXml(child, indent + 1, depth + 1);
        }
      }
      // Add hooks if this is the root node
      if (hasHooks) {
        lines.push(`${pad}  <hooks>`);
        for (const cmd of hooks.post_create) {
          lines.push(`${pad}    <post_create>${escapeXml(cmd)}</post_create>`);
        }
        lines.push(`${pad}  </hooks>`);
      }
      lines.push(`${pad}</${tagName}>`);
    } else if (node.content) {
      lines.push(`${pad}<${tagName} ${attrStr}>${escapeXml(node.content)}</${tagName}>`);
    } else {
      lines.push(`${pad}<${tagName} ${attrStr} />`);
    }
  };

  // Pass hooks to root node so they're included inside the root element
  nodeToXml(tree.root, 0, 0, tree.hooks);

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
  const root = await scanDirectoryNode(handle, name || handle.name, 0);
  const stats = calculateSchemaStats(root);

  return {
    root,
    stats,
  };
};

/**
 * Recursively scan a directory handle with depth limiting.
 */
const scanDirectoryNode = async (
  handle: FileSystemDirectoryHandle,
  name: string,
  depth: number
): Promise<SchemaNode> => {
  // Check recursion depth to prevent stack overflow
  if (depth >= MAX_DIRECTORY_SCAN_DEPTH) {
    return {
      type: "folder",
      name,
      children: [
        {
          type: "file",
          name: `[max depth ${MAX_DIRECTORY_SCAN_DEPTH} exceeded]`,
        },
      ],
    };
  }

  const children: SchemaNode[] = [];

  for await (const entry of handle.values()) {
    if (entry.kind === "directory") {
      const childHandle = await handle.getDirectoryHandle(entry.name);
      const childNode = await scanDirectoryNode(childHandle, entry.name, depth + 1);
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
