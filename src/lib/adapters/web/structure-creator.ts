/**
 * Structure Creator for web mode.
 * Creates file/folder structures using the File System Access API.
 */

import type {
  SchemaTree,
  SchemaNode,
  CreateResult,
  BackendLogEntry,
  ResultSummary,
  DiffResult,
  DiffNode,
  DiffSummary,
  DiffAction,
} from "../../../types/schema";
import { substituteVariables } from "./transforms";
import {
  isOfficeDocument,
  processOfficeDocument,
  isEpub,
  processEpub,
  processZipWithVariables,
} from "./zip-utils";

/**
 * Process a downloaded file, applying variable substitution where applicable.
 */
const processDownloadedFile = async (
  data: Uint8Array,
  filename: string,
  variables: Record<string, string>
): Promise<Uint8Array> => {
  const substituteVars = (text: string) => substituteVariables(text, variables);

  // Check for Office documents (DOCX, XLSX, PPTX, etc.)
  const officeType = isOfficeDocument(filename);
  if (officeType) {
    try {
      return await processOfficeDocument(data, officeType, substituteVars);
    } catch (e) {
      console.warn(`Failed to process Office document ${filename}:`, e);
      return data; // Return original on error
    }
  }

  // Check for EPUB
  if (isEpub(filename)) {
    try {
      return await processEpub(data, substituteVars);
    } catch (e) {
      console.warn(`Failed to process EPUB ${filename}:`, e);
      return data;
    }
  }

  // Check for ZIP files (process text files inside)
  if (filename.toLowerCase().endsWith(".zip")) {
    try {
      return await processZipWithVariables(data, substituteVars);
    } catch (e) {
      console.warn(`Failed to process ZIP ${filename}:`, e);
      return data;
    }
  }

  // For text files, try to apply variable substitution
  const textExtensions = [
    ".txt", ".md", ".json", ".yaml", ".yml", ".xml", ".html", ".htm",
    ".css", ".js", ".ts", ".jsx", ".tsx", ".vue", ".svelte",
    ".py", ".rb", ".php", ".java", ".c", ".cpp", ".h", ".hpp",
    ".cs", ".go", ".rs", ".swift", ".kt", ".scala",
    ".sh", ".bash", ".zsh", ".fish", ".ps1", ".bat", ".cmd",
    ".sql", ".graphql", ".gql", ".env", ".ini", ".toml", ".conf",
    ".cfg", ".properties", ".csv",
  ];

  const ext = "." + filename.split(".").pop()?.toLowerCase();
  if (textExtensions.includes(ext)) {
    try {
      const text = new TextDecoder().decode(data);
      if (text.includes("%")) {
        const processed = substituteVars(text);
        return new TextEncoder().encode(processed);
      }
    } catch (e) {
      // Not a valid text file, return original
    }
  }

  return data;
};

interface CreationContext {
  rootHandle: FileSystemDirectoryHandle;
  variables: Record<string, string>;
  dryRun: boolean;
  overwrite: boolean;
  logs: BackendLogEntry[];
  summary: ResultSummary;
  // Track if previous sibling was an if that evaluated to true
  ifWasTrue: boolean;
}

/**
 * Create structure from a SchemaTree.
 */
export const createStructureFromTree = async (
  tree: SchemaTree,
  rootHandle: FileSystemDirectoryHandle,
  variables: Record<string, string>,
  dryRun: boolean,
  overwrite: boolean
): Promise<CreateResult> => {
  const context: CreationContext = {
    rootHandle,
    variables,
    dryRun,
    overwrite,
    logs: [],
    summary: {
      folders_created: 0,
      files_created: 0,
      files_downloaded: 0,
      errors: 0,
      skipped: 0,
      hooks_executed: 0,
      hooks_failed: 0,
    },
    ifWasTrue: false,
  };

  // Create the root structure
  await processNode(tree.root, rootHandle, context, "");

  // Note: Hooks are not supported in web mode
  if (tree.hooks?.post_create && tree.hooks.post_create.length > 0) {
    context.logs.push({
      log_type: "warning",
      message: "Post-create hooks are not supported in web mode",
      details: `${tree.hooks.post_create.length} hook(s) skipped`,
    });
  }

  return {
    logs: context.logs,
    summary: context.summary,
    hook_results: [],
  };
};

/**
 * Process a single node in the schema tree.
 */
const processNode = async (
  node: SchemaNode,
  parentHandle: FileSystemDirectoryHandle,
  context: CreationContext,
  currentPath: string
): Promise<void> => {
  switch (node.type) {
    case "folder":
      await processFolder(node, parentHandle, context, currentPath);
      break;
    case "file":
      await processFile(node, parentHandle, context, currentPath);
      break;
    case "if":
      await processIf(node, parentHandle, context, currentPath);
      break;
    case "else":
      await processElse(node, parentHandle, context, currentPath);
      break;
    case "repeat":
      await processRepeat(node, parentHandle, context, currentPath);
      break;
  }
};

/**
 * Process a folder node.
 */
const processFolder = async (
  node: SchemaNode,
  parentHandle: FileSystemDirectoryHandle,
  context: CreationContext,
  currentPath: string
): Promise<void> => {
  const folderName = substituteVariables(node.name, context.variables);
  const folderPath = currentPath ? `${currentPath}/${folderName}` : folderName;

  try {
    let folderHandle: FileSystemDirectoryHandle;

    if (context.dryRun) {
      context.logs.push({
        log_type: "info",
        message: `Would create folder: ${folderPath}`,
      });
      context.summary.folders_created++;
      // For dry run, we don't actually create, but we need to continue processing children
      // Try to get existing handle or skip children processing
      try {
        folderHandle = await parentHandle.getDirectoryHandle(folderName);
      } catch {
        // Folder doesn't exist, skip children in dry run
        return;
      }
    } else {
      folderHandle = await parentHandle.getDirectoryHandle(folderName, {
        create: true,
      });
      context.logs.push({
        log_type: "success",
        message: `Created folder: ${folderPath}`,
      });
      context.summary.folders_created++;
    }

    // Process children
    if (node.children) {
      // Reset ifWasTrue for each child level
      const savedIfWasTrue = context.ifWasTrue;
      context.ifWasTrue = false;

      for (const child of node.children) {
        await processNode(child, folderHandle, context, folderPath);
      }

      context.ifWasTrue = savedIfWasTrue;
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    context.logs.push({
      log_type: "error",
      message: `Failed to create folder: ${folderPath}`,
      details: errorMessage,
    });
    context.summary.errors++;
  }
};

/**
 * Process a file node.
 */
const processFile = async (
  node: SchemaNode,
  parentHandle: FileSystemDirectoryHandle,
  context: CreationContext,
  currentPath: string
): Promise<void> => {
  const fileName = substituteVariables(node.name, context.variables);
  const filePath = currentPath ? `${currentPath}/${fileName}` : fileName;

  try {
    // Check if file exists
    let fileExists = false;
    try {
      await parentHandle.getFileHandle(fileName);
      fileExists = true;
    } catch {
      fileExists = false;
    }

    if (fileExists && !context.overwrite) {
      context.logs.push({
        log_type: "warning",
        message: `Skipped (exists): ${filePath}`,
      });
      context.summary.skipped++;
      return;
    }

    // Get content
    let content: string | Uint8Array = "";
    let isDownload = false;

    if (node.url) {
      // Download from URL
      isDownload = true;
      const url = substituteVariables(node.url, context.variables);

      if (context.dryRun) {
        context.logs.push({
          log_type: "info",
          message: `Would download: ${filePath}`,
          details: `From: ${url}`,
        });
        context.summary.files_downloaded++;
        return;
      }

      try {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const arrayBuffer = await response.arrayBuffer();
        const rawContent = new Uint8Array(arrayBuffer);

        // Process the downloaded content for variable substitution
        const processedContent = await processDownloadedFile(
          rawContent,
          fileName,
          context.variables
        );

        content = processedContent;
      } catch (fetchError) {
        const errorMessage =
          fetchError instanceof Error ? fetchError.message : String(fetchError);
        context.logs.push({
          log_type: "error",
          message: `Failed to download: ${filePath}`,
          details: `URL: ${url}\nError: ${errorMessage}`,
        });
        context.summary.errors++;
        return;
      }
    } else if (node.content) {
      content = substituteVariables(node.content, context.variables);
    }

    if (context.dryRun) {
      context.logs.push({
        log_type: "info",
        message: `Would create file: ${filePath}`,
      });
      if (isDownload) {
        context.summary.files_downloaded++;
      } else {
        context.summary.files_created++;
      }
      return;
    }

    // Create the file
    const fileHandle = await parentHandle.getFileHandle(fileName, {
      create: true,
    });
    const writable = await fileHandle.createWritable();

    if (typeof content === "string") {
      await writable.write(content);
    } else {
      // Cast to BlobPart to satisfy TypeScript's strict type checking
      await writable.write(content as unknown as BlobPart);
    }
    await writable.close();

    context.logs.push({
      log_type: "success",
      message: isDownload ? `Downloaded: ${filePath}` : `Created: ${filePath}`,
    });

    if (isDownload) {
      context.summary.files_downloaded++;
    } else {
      context.summary.files_created++;
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    context.logs.push({
      log_type: "error",
      message: `Failed to create file: ${filePath}`,
      details: errorMessage,
    });
    context.summary.errors++;
  }
};

/**
 * Process an if node.
 */
const processIf = async (
  node: SchemaNode,
  parentHandle: FileSystemDirectoryHandle,
  context: CreationContext,
  currentPath: string
): Promise<void> => {
  // Evaluate the condition
  const varName = node.condition_var || "";
  const varKey = `%${varName}%`;
  const value = context.variables[varKey] || "";

  // Truthy: non-empty string that isn't "0", "false", or "no"
  const isTruthy =
    value.trim() !== "" &&
    value.toLowerCase() !== "0" &&
    value.toLowerCase() !== "false" &&
    value.toLowerCase() !== "no";

  context.ifWasTrue = isTruthy;

  if (isTruthy && node.children) {
    for (const child of node.children) {
      await processNode(child, parentHandle, context, currentPath);
    }
  }
};

/**
 * Process an else node.
 */
const processElse = async (
  node: SchemaNode,
  parentHandle: FileSystemDirectoryHandle,
  context: CreationContext,
  currentPath: string
): Promise<void> => {
  // Only process if the preceding if was false
  if (!context.ifWasTrue && node.children) {
    for (const child of node.children) {
      await processNode(child, parentHandle, context, currentPath);
    }
  }
};

/**
 * Process a repeat node.
 */
const processRepeat = async (
  node: SchemaNode,
  parentHandle: FileSystemDirectoryHandle,
  context: CreationContext,
  currentPath: string
): Promise<void> => {
  // Get repeat count
  let countStr = node.repeat_count || "1";
  countStr = substituteVariables(countStr, context.variables);

  const count = parseInt(countStr, 10);
  if (isNaN(count) || count < 0) {
    context.logs.push({
      log_type: "warning",
      message: `Invalid repeat count: ${countStr}`,
      details: "Using 0 iterations",
    });
    return;
  }

  const repeatAs = node.repeat_as || "i";

  // Process children for each iteration
  for (let i = 0; i < count; i++) {
    // Create scoped variables for this iteration
    // Use uppercase keys to match substituteVariables lookup
    const scopedVars = {
      ...context.variables,
      [`%${repeatAs.toUpperCase()}%`]: i.toString(),
      [`%${repeatAs.toUpperCase()}_1%`]: (i + 1).toString(),
    };

    const scopedContext = {
      ...context,
      variables: scopedVars,
    };

    if (node.children) {
      for (const child of node.children) {
        await processNode(child, parentHandle, scopedContext, currentPath);
      }
    }

    // Merge back the summary and logs
    context.logs = scopedContext.logs;
    context.summary = scopedContext.summary;
  }
};

// ============================================================================
// Diff Preview Generation
// ============================================================================

interface DiffContext {
  rootHandle: FileSystemDirectoryHandle;
  variables: Record<string, string>;
  overwrite: boolean;
  warnings: string[];
  ifWasTrue: boolean;
}

/**
 * Generate a diff preview showing what would be created/changed.
 */
export const generateDiffPreview = async (
  tree: SchemaTree,
  rootHandle: FileSystemDirectoryHandle,
  variables: Record<string, string>,
  overwrite: boolean
): Promise<DiffResult> => {
  const context: DiffContext = {
    rootHandle,
    variables,
    overwrite,
    warnings: [],
    ifWasTrue: false,
  };

  let idCounter = 0;
  const generateId = (): string => `diff_${idCounter++}`;

  const root = await generateDiffNode(
    tree.root,
    rootHandle,
    context,
    "",
    generateId
  );

  const summary = calculateDiffSummary(root, context.warnings);

  return {
    root,
    summary,
  };
};

/**
 * Generate diff for a single node.
 */
const generateDiffNode = async (
  node: SchemaNode,
  parentHandle: FileSystemDirectoryHandle,
  context: DiffContext,
  currentPath: string,
  generateId: () => string
): Promise<DiffNode> => {
  switch (node.type) {
    case "folder":
      return generateDiffFolder(node, parentHandle, context, currentPath, generateId);
    case "file":
      return generateDiffFile(node, parentHandle, context, currentPath, generateId);
    case "if":
      return generateDiffIf(node, parentHandle, context, currentPath, generateId);
    case "else":
      return generateDiffElse(node, parentHandle, context, currentPath, generateId);
    case "repeat":
      return generateDiffRepeat(node, parentHandle, context, currentPath, generateId);
  }
};

const generateDiffFolder = async (
  node: SchemaNode,
  parentHandle: FileSystemDirectoryHandle,
  context: DiffContext,
  currentPath: string,
  generateId: () => string
): Promise<DiffNode> => {
  const folderName = substituteVariables(node.name, context.variables);
  const folderPath = currentPath ? `${currentPath}/${folderName}` : folderName;

  let exists = false;
  let folderHandle: FileSystemDirectoryHandle | null = null;

  try {
    folderHandle = await parentHandle.getDirectoryHandle(folderName);
    exists = true;
  } catch {
    exists = false;
  }

  const action: DiffAction = exists ? "unchanged" : "create";

  // Process children
  const children: DiffNode[] = [];
  if (node.children) {
    const childHandle = folderHandle || parentHandle;
    const savedIfWasTrue = context.ifWasTrue;
    context.ifWasTrue = false;

    for (const child of node.children) {
      const childDiff = await generateDiffNode(
        child,
        childHandle,
        context,
        folderPath,
        generateId
      );
      children.push(childDiff);
    }

    context.ifWasTrue = savedIfWasTrue;
  }

  return {
    id: generateId(),
    node_type: "folder",
    name: folderName,
    path: folderPath,
    action,
    is_binary: false,
    children: children.length > 0 ? children : undefined,
  };
};

const generateDiffFile = async (
  node: SchemaNode,
  parentHandle: FileSystemDirectoryHandle,
  context: DiffContext,
  currentPath: string,
  generateId: () => string
): Promise<DiffNode> => {
  const fileName = substituteVariables(node.name, context.variables);
  const filePath = currentPath ? `${currentPath}/${fileName}` : fileName;

  let exists = false;
  let existingContent: string | undefined;

  try {
    const fileHandle = await parentHandle.getFileHandle(fileName);
    const file = await fileHandle.getFile();
    exists = true;

    // Try to read as text
    try {
      existingContent = await file.text();
    } catch {
      existingContent = undefined;
    }
  } catch {
    exists = false;
  }

  let action: DiffAction;
  if (exists) {
    action = context.overwrite ? "overwrite" : "skip";
  } else {
    action = "create";
  }

  // Get new content
  let newContent: string | undefined;
  let isBinary = false;

  if (node.url) {
    isBinary = true; // URLs are treated as binary (no text diff)
  } else if (node.content) {
    newContent = substituteVariables(node.content, context.variables);
  }

  return {
    id: generateId(),
    node_type: "file",
    name: fileName,
    path: filePath,
    action,
    existing_content: existingContent,
    new_content: newContent,
    url: node.url ? substituteVariables(node.url, context.variables) : undefined,
    is_binary: isBinary,
  };
};

const generateDiffIf = async (
  node: SchemaNode,
  parentHandle: FileSystemDirectoryHandle,
  context: DiffContext,
  currentPath: string,
  generateId: () => string
): Promise<DiffNode> => {
  const varName = node.condition_var || "";
  const varKey = `%${varName}%`;
  const value = context.variables[varKey] || "";

  const isTruthy =
    value.trim() !== "" &&
    value.toLowerCase() !== "0" &&
    value.toLowerCase() !== "false" &&
    value.toLowerCase() !== "no";

  context.ifWasTrue = isTruthy;

  const children: DiffNode[] = [];
  if (isTruthy && node.children) {
    for (const child of node.children) {
      const childDiff = await generateDiffNode(
        child,
        parentHandle,
        context,
        currentPath,
        generateId
      );
      children.push(childDiff);
    }
  }

  // Return a virtual node for the if block
  return {
    id: generateId(),
    node_type: "folder",
    name: `[if ${varName}]`,
    path: currentPath,
    action: isTruthy ? "create" : "skip",
    is_binary: false,
    children: children.length > 0 ? children : undefined,
  };
};

const generateDiffElse = async (
  node: SchemaNode,
  parentHandle: FileSystemDirectoryHandle,
  context: DiffContext,
  currentPath: string,
  generateId: () => string
): Promise<DiffNode> => {
  const shouldProcess = !context.ifWasTrue;

  const children: DiffNode[] = [];
  if (shouldProcess && node.children) {
    for (const child of node.children) {
      const childDiff = await generateDiffNode(
        child,
        parentHandle,
        context,
        currentPath,
        generateId
      );
      children.push(childDiff);
    }
  }

  return {
    id: generateId(),
    node_type: "folder",
    name: "[else]",
    path: currentPath,
    action: shouldProcess ? "create" : "skip",
    is_binary: false,
    children: children.length > 0 ? children : undefined,
  };
};

const generateDiffRepeat = async (
  node: SchemaNode,
  parentHandle: FileSystemDirectoryHandle,
  context: DiffContext,
  currentPath: string,
  generateId: () => string
): Promise<DiffNode> => {
  let countStr = node.repeat_count || "1";
  countStr = substituteVariables(countStr, context.variables);

  const count = parseInt(countStr, 10);
  if (isNaN(count) || count < 0) {
    context.warnings.push(`Invalid repeat count: ${countStr}`);
    return {
      id: generateId(),
      node_type: "folder",
      name: `[repeat (invalid)]`,
      path: currentPath,
      action: "skip",
      is_binary: false,
    };
  }

  const repeatAs = node.repeat_as || "i";
  const children: DiffNode[] = [];

  for (let i = 0; i < count; i++) {
    // Use uppercase keys to match substituteVariables lookup
    const scopedVars = {
      ...context.variables,
      [`%${repeatAs.toUpperCase()}%`]: i.toString(),
      [`%${repeatAs.toUpperCase()}_1%`]: (i + 1).toString(),
    };

    const scopedContext = {
      ...context,
      variables: scopedVars,
    };

    if (node.children) {
      for (const child of node.children) {
        const childDiff = await generateDiffNode(
          child,
          parentHandle,
          scopedContext,
          currentPath,
          generateId
        );
        children.push(childDiff);
      }
    }
  }

  return {
    id: generateId(),
    node_type: "folder",
    name: `[repeat ${count}x]`,
    path: currentPath,
    action: count > 0 ? "create" : "skip",
    is_binary: false,
    children: children.length > 0 ? children : undefined,
  };
};

/**
 * Calculate summary statistics from a diff tree.
 */
const calculateDiffSummary = (root: DiffNode, warnings: string[]): DiffSummary => {
  let total = 0;
  let creates = 0;
  let overwrites = 0;
  let skips = 0;
  let unchangedFolders = 0;

  const traverse = (node: DiffNode) => {
    // Skip virtual nodes (if/else/repeat)
    if (!node.name.startsWith("[")) {
      total++;

      switch (node.action) {
        case "create":
          creates++;
          break;
        case "overwrite":
          overwrites++;
          break;
        case "skip":
          skips++;
          break;
        case "unchanged":
          if (node.node_type === "folder") {
            unchangedFolders++;
          }
          break;
      }
    }

    node.children?.forEach(traverse);
  };

  traverse(root);

  return {
    total_items: total,
    creates,
    overwrites,
    skips,
    unchanged_folders: unchangedFolders,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
};
