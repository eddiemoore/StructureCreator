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
import { isValidPublicUrl } from "./url-validation";
import {
  isTextFile,
  MAX_REPEAT_COUNT,
  FETCH_TIMEOUT_MS,
  MAX_SCHEMA_DEPTH,
  MAX_DOWNLOAD_SIZE_BYTES,
  MAX_DIFF_FILE_READ_BYTES,
  validatePathComponent,
} from "./constants";
import { generateImage, generateSqlite } from "./generators";
import { processTemplate, expand } from "@structure-creator/shared";
import type { PlanNode, PlanFolder, PlanFile } from "@structure-creator/shared";

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
    } catch {
      // Failed to process Office document - return original unchanged
      return data;
    }
  }

  // Check for EPUB
  if (isEpub(filename)) {
    try {
      return await processEpub(data, substituteVars);
    } catch {
      // Failed to process EPUB - return original unchanged
      return data;
    }
  }

  // Check for ZIP files (process text files inside)
  if (filename.toLowerCase().endsWith(".zip")) {
    try {
      return await processZipWithVariables(data, substituteVars);
    } catch {
      // Failed to process ZIP - return original unchanged
      return data;
    }
  }

  // For text files, try to apply variable substitution
  if (isTextFile(filename)) {
    try {
      const text = new TextDecoder().decode(data);
      if (text.includes("%")) {
        const processed = substituteVars(text);
        return new TextEncoder().encode(processed);
      }
    } catch {
      // Binary file or encoding issue - this is expected for non-text files
      // Return original data unchanged
    }
  }

  return data;
};

interface ExecutionContext {
  dryRun: boolean;
  overwrite: boolean;
  logs: BackendLogEntry[];
  summary: ResultSummary;
}

/**
 * Create structure from a SchemaTree.
 *
 * Thin executor of the shared Plan module (ADR-0004): schema-structure
 * semantics (if/else/repeat, name resolution, content rendering) live in
 * the pure shared `expand`; this walker only performs IO — directory/file
 * creation via the File System Access API, downloads via fetch, and
 * Generate instructions dispatched to the web generators.
 */
export const createStructureFromTree = async (
  tree: SchemaTree,
  rootHandle: FileSystemDirectoryHandle,
  variables: Record<string, string>,
  dryRun: boolean,
  overwrite: boolean
): Promise<CreateResult> => {
  const context: ExecutionContext = {
    dryRun,
    overwrite,
    logs: [],
    summary: {
      folders_created: 0,
      files_created: 0,
      files_downloaded: 0,
      files_generated: 0,
      errors: 0,
      skipped: 0,
      hooks_executed: 0,
      hooks_failed: 0,
    },
  };

  // Expand the schema into a Plan (pure), then execute it (IO).
  const plan = expand(tree, variables);

  for (const warning of plan.warnings) {
    context.logs.push({
      log_type: "warning",
      message: warning.message,
      details: warning.details,
    });
  }

  for (const error of plan.errors) {
    context.logs.push({
      log_type: "error",
      message: error.message,
      details: error.path
        ? [error.details, `At: ${error.path}`].filter(Boolean).join("\n")
        : error.details,
    });
    context.summary.errors++;
  }

  for (const node of plan.nodes) {
    await executeNode(node, rootHandle, context, "", false);
  }

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
    created_items: [], // Web mode doesn't track created items for undo
  };
};

/**
 * Execute a single Plan node (IO only — semantics live in the shared
 * `expand`).
 *
 * `inVirtualSubtree`: in dry run, tracks whether a parent folder doesn't
 * exist on disk yet; when true, file existence checks are skipped since
 * the folder itself would be newly created.
 */
const executeNode = async (
  node: PlanNode,
  parentHandle: FileSystemDirectoryHandle,
  context: ExecutionContext,
  currentPath: string,
  inVirtualSubtree: boolean
): Promise<void> => {
  if (node.kind === "folder") {
    await executeFolder(node, parentHandle, context, currentPath, inVirtualSubtree);
  } else {
    await executeFile(node, parentHandle, context, currentPath, inVirtualSubtree);
  }
};

/**
 * Execute a folder Plan node.
 */
const executeFolder = async (
  node: PlanFolder,
  parentHandle: FileSystemDirectoryHandle,
  context: ExecutionContext,
  currentPath: string,
  inVirtualSubtree: boolean
): Promise<void> => {
  const folderName = node.name;

  // Validate folder name to prevent path traversal
  try {
    validatePathComponent(folderName);
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    context.logs.push({
      log_type: "error",
      message: `Invalid folder name after variable substitution: ${folderName}`,
      details: errorMessage,
    });
    context.summary.errors++;
    return;
  }

  const folderPath = currentPath ? `${currentPath}/${folderName}` : folderName;

  try {
    let folderHandle: FileSystemDirectoryHandle | null = null;

    if (context.dryRun) {
      context.logs.push({
        log_type: "info",
        message: `Would create folder: ${folderPath}`,
      });
      context.summary.folders_created++;
      // For dry run, try to get existing handle (for checking file existence)
      // but don't fail if it doesn't exist - we still need to count children
      try {
        folderHandle = await parentHandle.getDirectoryHandle(folderName);
      } catch {
        // Folder doesn't exist - that's fine for dry run, we'll still process children
        folderHandle = null;
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

    // In dry run, if the folder doesn't exist, children are in a virtual
    // subtree - this prevents incorrect file existence checks
    const childInVirtualSubtree =
      inVirtualSubtree || (context.dryRun && !folderHandle);
    const handleForChildren = folderHandle || parentHandle;

    for (const child of node.children) {
      await executeNode(
        child,
        handleForChildren,
        context,
        folderPath,
        childInVirtualSubtree
      );
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
 * Execute a file Plan node.
 */
const executeFile = async (
  node: PlanFile,
  parentHandle: FileSystemDirectoryHandle,
  context: ExecutionContext,
  currentPath: string,
  inVirtualSubtree: boolean
): Promise<void> => {
  const fileName = node.name;

  // Validate file name to prevent path traversal
  try {
    validatePathComponent(fileName);
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    context.logs.push({
      log_type: "error",
      message: `Invalid file name after variable substitution: ${fileName}`,
      details: errorMessage,
    });
    context.summary.errors++;
    return;
  }

  const filePath = currentPath ? `${currentPath}/${fileName}` : fileName;

  try {
    // Check if file exists (skip if in virtual subtree - folder doesn't exist yet)
    let fileExists = false;
    if (!inVirtualSubtree) {
      try {
        await parentHandle.getFileHandle(fileName);
        fileExists = true;
      } catch {
        fileExists = false;
      }
    }

    if (fileExists && !context.overwrite) {
      context.logs.push({
        log_type: "warning",
        message: `Skipped (exists): ${filePath}`,
      });
      context.summary.skipped++;
      return;
    }

    // Content: inline is fully rendered by the Plan; download/generate are
    // deferred IO instructions executed here
    let content: string | Uint8Array = "";
    let isDownload = false;

    if (node.content.kind === "download") {
      isDownload = true;
      const url = node.content.url;

      // Validate URL to prevent SSRF attacks
      const urlValidation = isValidPublicUrl(url);
      if (!urlValidation.valid) {
        context.logs.push({
          log_type: "error",
          message: `Invalid URL for: ${filePath}`,
          details: urlValidation.error,
        });
        context.summary.errors++;
        return;
      }

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
        // Use AbortController for timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

        let rawContent: Uint8Array;
        try {
          const response = await fetch(url, { signal: controller.signal });
          clearTimeout(timeoutId);

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }

          // Check Content-Length header if available
          const contentLength = response.headers.get("content-length");
          if (contentLength && parseInt(contentLength) > MAX_DOWNLOAD_SIZE_BYTES) {
            throw new Error(`File too large (max ${MAX_DOWNLOAD_SIZE_BYTES / 1024 / 1024}MB)`);
          }

          const arrayBuffer = await response.arrayBuffer();

          // Verify actual size after download (Content-Length can be spoofed or omitted)
          if (arrayBuffer.byteLength > MAX_DOWNLOAD_SIZE_BYTES) {
            throw new Error(`Downloaded file too large (max ${MAX_DOWNLOAD_SIZE_BYTES / 1024 / 1024}MB)`);
          }

          rawContent = new Uint8Array(arrayBuffer);
        } catch (e) {
          clearTimeout(timeoutId);
          if (e instanceof Error && e.name === "AbortError") {
            throw new Error(`Request timed out after ${FETCH_TIMEOUT_MS / 1000}s`);
          }
          throw e;
        }

        // Process the downloaded content for variable substitution, using
        // the variable map in scope at this Plan node (includes repeat
        // iteration variables)
        content = await processDownloadedFile(
          rawContent,
          fileName,
          node.content.variables
        );
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
    } else if (node.content.kind === "generate") {
      // Generate binary file (image or SQLite database)
      const generatorType =
        node.content.generator === "image" ? "image" : "SQLite database";

      if (context.dryRun) {
        context.logs.push({
          log_type: "info",
          message: `Would generate ${generatorType}: ${filePath}`,
        });
        context.summary.files_generated++;
        return;
      }

      try {
        const generatorContext = {
          variables: node.content.variables,
          dryRun: context.dryRun,
        };

        let data: Uint8Array | null = null;

        if (node.content.generator === "image") {
          data = await generateImage(node.content.spec, generatorContext);
        } else if (node.content.generator === "sqlite") {
          data = await generateSqlite(node.content.spec, generatorContext);
        }

        if (data) {
          // Create the file
          const fileHandle = await parentHandle.getFileHandle(fileName, {
            create: true,
          });
          const writable = await fileHandle.createWritable();

          try {
            const buffer = data.buffer.slice(
              data.byteOffset,
              data.byteOffset + data.byteLength
            ) as ArrayBuffer;
            await writable.write(buffer);
          } finally {
            await writable.close();
          }

          context.logs.push({
            log_type: "success",
            message: `Generated ${generatorType}: ${filePath}`,
          });
          context.summary.files_generated++;
        }
      } catch (genError) {
        const errorMessage =
          genError instanceof Error ? genError.message : String(genError);
        context.logs.push({
          log_type: "error",
          message: `Failed to generate: ${filePath}`,
          details: errorMessage,
        });
        context.summary.errors++;
      }
      return;
    } else {
      // Inline content is fully rendered (templating then substitution) by
      // the shared expand; template errors surfaced as Plan warnings
      content = node.content.text;
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

    try {
      if (typeof content === "string") {
        await writable.write(content);
      } else {
        // Convert to ArrayBuffer for type compatibility with File System API
        const buffer = content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength) as ArrayBuffer;
        await writable.write(buffer);
      }
    } finally {
      await writable.close();
    }

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

// ============================================================================
// Diff Preview Generation
// ============================================================================

interface DiffContext {
  rootHandle: FileSystemDirectoryHandle;
  variables: Record<string, string>;
  overwrite: boolean;
  warnings: string[];
  ifWasTrue: boolean;
  // Tracks if we're in a virtual subtree (parent folder doesn't exist)
  // When true, skip file existence checks since the folder doesn't exist yet
  inVirtualSubtree: boolean;
  // Current recursion depth to prevent stack overflow
  depth: number;
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
    inVirtualSubtree: false,
    depth: 0,
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
  // Check recursion depth to prevent stack overflow
  if (context.depth >= MAX_SCHEMA_DEPTH) {
    context.warnings.push(`Maximum schema depth (${MAX_SCHEMA_DEPTH}) exceeded at: ${currentPath}`);
    return {
      id: generateId(),
      node_type: "folder",
      name: "[depth exceeded]",
      path: currentPath,
      action: "skip",
      is_binary: false,
    };
  }
  context.depth++;

  try {
    switch (node.type) {
      case "folder":
        return await generateDiffFolder(node, parentHandle, context, currentPath, generateId);
      case "file":
        return await generateDiffFile(node, parentHandle, context, currentPath, generateId);
      case "if":
        return await generateDiffIf(node, parentHandle, context, currentPath, generateId);
      case "else":
        return await generateDiffElse(node, parentHandle, context, currentPath, generateId);
      case "repeat":
        return await generateDiffRepeat(node, parentHandle, context, currentPath, generateId);
    }
  } finally {
    context.depth--;
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

  // Validate folder name to prevent path traversal
  try {
    validatePathComponent(folderName);
  } catch (e) {
    context.warnings.push(`Invalid folder name: ${folderName} - ${e instanceof Error ? e.message : String(e)}`);
    return {
      id: generateId(),
      node_type: "folder",
      name: `[invalid: ${folderName}]`,
      path: currentPath,
      action: "skip",
      is_binary: false,
    };
  }

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
    const savedInVirtualSubtree = context.inVirtualSubtree;
    context.ifWasTrue = false;

    // If folder doesn't exist, mark children as being in a virtual subtree
    // This prevents incorrect file existence checks
    if (!folderHandle) {
      context.inVirtualSubtree = true;
    }

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
    context.inVirtualSubtree = savedInVirtualSubtree;
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

  // Validate file name to prevent path traversal
  try {
    validatePathComponent(fileName);
  } catch (e) {
    context.warnings.push(`Invalid file name: ${fileName} - ${e instanceof Error ? e.message : String(e)}`);
    return {
      id: generateId(),
      node_type: "file",
      name: `[invalid: ${fileName}]`,
      path: currentPath,
      action: "skip",
      is_binary: false,
    };
  }

  const filePath = currentPath ? `${currentPath}/${fileName}` : fileName;

  let exists = false;
  let existingContent: string | undefined;

  // Skip file existence check if in virtual subtree (parent folder doesn't exist)
  if (!context.inVirtualSubtree) {
    try {
      const fileHandle = await parentHandle.getFileHandle(fileName);
      const file = await fileHandle.getFile();
      exists = true;

      // Try to read as text, but only if file is not too large
      try {
        if (file.size <= MAX_DIFF_FILE_READ_BYTES) {
          existingContent = await file.text();
        } else {
          // File too large for diff preview
          existingContent = `[File too large for diff preview: ${(file.size / 1024 / 1024).toFixed(1)}MB]`;
        }
      } catch {
        existingContent = undefined;
      }
    } catch {
      exists = false;
    }
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
    // Validate URL to warn about invalid URLs in preview
    const url = substituteVariables(node.url, context.variables);
    const urlValidation = isValidPublicUrl(url);
    if (!urlValidation.valid) {
      context.warnings.push(`Invalid URL for ${fileName}: ${urlValidation.error}`);
    }
  } else if (node.generate) {
    isBinary = true; // Generated files are binary (no text diff)
  } else if (node.content) {
    // Process template directives if template="true", then substitute variables
    if (node.template) {
      const templateResult = processTemplate(node.content, context.variables);
      if (templateResult.ok) {
        newContent = substituteVariables(templateResult.value, context.variables);
      } else {
        // Template error - show error in preview
        context.warnings.push(`Template error in ${fileName}: ${templateResult.error.message}`);
        newContent = substituteVariables(node.content, context.variables);
      }
    } else {
      newContent = substituteVariables(node.content, context.variables);
    }
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
    generate: node.generate,
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

  if (count > MAX_REPEAT_COUNT) {
    context.warnings.push(
      `Repeat count ${count} exceeds maximum allowed (${MAX_REPEAT_COUNT})`
    );
    return {
      id: generateId(),
      node_type: "folder",
      name: `[repeat (exceeds limit)]`,
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

    // Create scoped context - ifWasTrue is reset for each iteration
    const scopedContext: DiffContext = {
      ...context,
      variables: scopedVars,
      ifWasTrue: false,
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
    warnings,
  };
};
