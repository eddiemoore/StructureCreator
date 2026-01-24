/**
 * Shared constants for web adapters.
 */

/**
 * File extensions recognized as text files for variable substitution.
 * Used when processing downloaded files and ZIP archives.
 */
export const TEXT_FILE_EXTENSIONS = [
  ".txt",
  ".md",
  ".mdx",
  ".json",
  ".yaml",
  ".yml",
  ".xml",
  ".html",
  ".htm",
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".mts",
  ".cts",
  ".jsx",
  ".tsx",
  ".vue",
  ".svelte",
  ".astro",
  ".py",
  ".rb",
  ".php",
  ".java",
  ".c",
  ".cpp",
  ".h",
  ".hpp",
  ".cs",
  ".go",
  ".rs",
  ".swift",
  ".kt",
  ".scala",
  ".sh",
  ".bash",
  ".zsh",
  ".fish",
  ".ps1",
  ".bat",
  ".cmd",
  ".sql",
  ".graphql",
  ".gql",
  ".prisma",
  ".env",
  ".ini",
  ".toml",
  ".conf",
  ".cfg",
  ".properties",
  ".csv",
] as const;

/**
 * Special filenames (without extension) that are text files.
 * These are matched by exact filename, case-insensitive.
 */
export const TEXT_FILE_NAMES = [
  "dockerfile",
  "makefile",
  "gemfile",
  "rakefile",
  "procfile",
  "vagrantfile",
  "jenkinsfile",
  "containerfile",
  ".gitignore",
  ".gitattributes",
  ".gitmodules",
  ".editorconfig",
  ".prettierrc",
  ".eslintrc",
  ".babelrc",
  ".npmrc",
  ".nvmrc",
  ".dockerignore",
  ".env.local",
  ".env.development",
  ".env.production",
  ".env.test",
] as const;

/**
 * Check if a filename represents a text file for variable substitution.
 */
export const isTextFile = (filename: string): boolean => {
  const lowerName = filename.toLowerCase();

  // Check exact filename matches first
  if ((TEXT_FILE_NAMES as readonly string[]).includes(lowerName)) {
    return true;
  }

  // Check extension
  const lastDotIndex = filename.lastIndexOf(".");
  if (lastDotIndex > 0) {
    const ext = filename.slice(lastDotIndex).toLowerCase();
    if ((TEXT_FILE_EXTENSIONS as readonly string[]).includes(ext)) {
      return true;
    }
  }

  return false;
};

/**
 * Maximum recursion depth for schema tree processing.
 * Prevents stack overflow from deeply nested or malicious schemas.
 */
export const MAX_SCHEMA_DEPTH = 100;

/**
 * Maximum number of iterations allowed in a repeat block.
 * Prevents resource exhaustion from large repeat counts.
 */
export const MAX_REPEAT_COUNT = 10000;

/**
 * Default timeout for fetch operations in milliseconds.
 */
export const FETCH_TIMEOUT_MS = 30000;

/**
 * Maximum size for downloaded files in bytes (50MB).
 * Prevents memory exhaustion from malicious or unexpectedly large files.
 */
export const MAX_DOWNLOAD_SIZE_BYTES = 50 * 1024 * 1024;

/**
 * Maximum size for reading existing files during diff preview (5MB).
 * Prevents memory exhaustion when previewing diffs against large existing files.
 */
export const MAX_DIFF_FILE_READ_BYTES = 5 * 1024 * 1024;

/**
 * Maximum recursion depth for directory scanning.
 * Prevents stack overflow from deeply nested directories or symlink loops.
 */
export const MAX_DIRECTORY_SCAN_DEPTH = 50;

/**
 * Maximum number of entries allowed in a ZIP file.
 * Prevents memory exhaustion from malicious ZIP archives.
 */
export const MAX_ZIP_ENTRIES = 100000;

/**
 * Maximum number of templates that can be imported at once.
 * Prevents resource exhaustion from malicious import files.
 */
export const MAX_TEMPLATE_IMPORT_COUNT = 1000;

/**
 * Windows reserved device names that cannot be used as file/folder names.
 */
const WINDOWS_RESERVED_NAMES = [
  "CON", "PRN", "AUX", "NUL",
  "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
  "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/**
 * Characters that are invalid in file/folder names on Windows.
 */
const WINDOWS_INVALID_CHARS = /[<>:"|?*]/;

/**
 * Maximum length for a file or folder name.
 * Most filesystems (NTFS, ext4, APFS) limit names to 255 characters.
 */
const MAX_NAME_LENGTH = 255;

/**
 * Validate a file or folder name to prevent path traversal attacks.
 * Returns the sanitized name or throws an error if the name is invalid.
 */
// ============================================================================
// Schema Statistics
// ============================================================================

import type { SchemaNode } from "../../../types/schema";

/**
 * Calculate statistics for a schema tree.
 * Shared utility used by schema-parser and zip-utils.
 */
export const calculateSchemaStats = (
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

// ============================================================================
// Path Validation
// ============================================================================

export const validatePathComponent = (name: string): string => {
  // Reject empty names
  if (!name || name.trim() === "") {
    throw new Error("File/folder name cannot be empty");
  }

  // Reject names that are too long
  if (name.length > MAX_NAME_LENGTH) {
    throw new Error(`Invalid name: "${name.slice(0, 50)}..." exceeds maximum length of ${MAX_NAME_LENGTH} characters`);
  }

  // Reject path traversal attempts
  if (name === "." || name === "..") {
    throw new Error(`Invalid name: "${name}" is not allowed`);
  }

  // Reject names containing path separators
  if (name.includes("/") || name.includes("\\")) {
    throw new Error(`Invalid name: "${name}" contains path separators`);
  }

  // Reject names with null bytes (could bypass validation in some systems)
  if (name.includes("\0")) {
    throw new Error(`Invalid name: "${name}" contains null bytes`);
  }

  // Reject Windows-invalid characters
  if (WINDOWS_INVALID_CHARS.test(name)) {
    throw new Error(`Invalid name: "${name}" contains characters not allowed on Windows (<>:"|?*)`);
  }

  // Reject Windows reserved names (case-insensitive, with or without extension)
  const baseName = name.split(".")[0].toUpperCase();
  if (WINDOWS_RESERVED_NAMES.includes(baseName)) {
    throw new Error(`Invalid name: "${name}" is a Windows reserved name`);
  }

  // Reject names ending with space or period (problematic on Windows)
  if (name.endsWith(" ") || name.endsWith(".")) {
    throw new Error(`Invalid name: "${name}" ends with space or period`);
  }

  return name;
};
