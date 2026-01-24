/**
 * Adapter interface types.
 * These interfaces define the contract that both Tauri and Web adapters must implement.
 */

import type {
  SchemaTree,
  Template,
  ValidationError,
  ValidationRule,
  CreateResult,
  DiffResult,
  ImportResult,
  DuplicateStrategy,
  ParseWithInheritanceResult,
  RecentProject,
} from "../../types/schema";

// ============================================================================
// File System Adapter
// ============================================================================

export interface FileFilter {
  name: string;
  extensions: string[];
}

export interface FileSystemAdapter {
  /**
   * Open a file picker dialog.
   * Returns the selected file path (Tauri) or FileSystemFileHandle (Web).
   */
  openFilePicker(options: {
    multiple?: boolean;
    filters?: FileFilter[];
  }): Promise<string | null>;

  /**
   * Open a directory picker dialog.
   */
  openDirectoryPicker(): Promise<string | null>;

  /**
   * Open a save file picker dialog.
   */
  saveFilePicker(options: {
    filters?: FileFilter[];
    defaultPath?: string;
  }): Promise<string | null>;

  /**
   * Read a text file.
   */
  readTextFile(path: string): Promise<string>;

  /**
   * Read a binary file.
   */
  readBinaryFile(path: string): Promise<Uint8Array>;

  /**
   * Write a text file.
   */
  writeTextFile(path: string, content: string): Promise<void>;

  /**
   * Write a binary file.
   */
  writeBinaryFile(path: string, data: Uint8Array): Promise<void>;

  /**
   * Create a directory.
   */
  createDirectory(path: string): Promise<void>;

  /**
   * Check if a path exists.
   */
  exists(path: string): Promise<boolean>;

  /**
   * Check if a path is a file.
   */
  isFile(path: string): Promise<boolean>;

  /**
   * Check if a path is a directory.
   */
  isDirectory(path: string): Promise<boolean>;

  /**
   * Read directory contents (for web, this is a simplified scan).
   */
  readDirectory(path: string): Promise<{ name: string; isDirectory: boolean }[]>;
}

// ============================================================================
// Database Adapter
// ============================================================================

export interface CreateTemplateInput {
  name: string;
  description: string | null;
  schemaXml: string;
  variables: Record<string, string>;
  variableValidation: Record<string, ValidationRule>;
  iconColor: string | null;
  tags?: string[];
}

export interface UpdateTemplateInput {
  name?: string;
  description?: string | null;
  iconColor?: string | null;
}

export interface CreateRecentProjectInput {
  projectName: string;
  outputPath: string;
  schemaXml: string;
  variables: Record<string, string>;
  variableValidation: Record<string, ValidationRule>;
  templateId: string | null;
  templateName: string | null;
  foldersCreated: number;
  filesCreated: number;
}

export interface DatabaseAdapter {
  /**
   * Initialize the database (create tables, run migrations).
   */
  initialize(): Promise<void>;

  // Template operations
  listTemplates(): Promise<Template[]>;
  getTemplate(id: string): Promise<Template | null>;
  getTemplateByName(name: string): Promise<Template | null>;
  createTemplate(input: CreateTemplateInput): Promise<Template>;
  updateTemplate(id: string, input: UpdateTemplateInput): Promise<void>;
  deleteTemplate(id: string): Promise<boolean>;
  toggleFavorite(id: string): Promise<void>;
  incrementUseCount(id: string): Promise<void>;

  // Tag operations
  getAllTags(): Promise<string[]>;
  updateTemplateTags(id: string, tags: string[]): Promise<void>;

  // Settings operations
  getAllSettings(): Promise<Record<string, string>>;
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<void>;

  // Recent projects operations
  listRecentProjects(): Promise<RecentProject[]>;
  getRecentProject(id: string): Promise<RecentProject | null>;
  addRecentProject(input: CreateRecentProjectInput): Promise<RecentProject>;
  deleteRecentProject(id: string): Promise<boolean>;
  clearRecentProjects(): Promise<number>;
}

// ============================================================================
// Schema Adapter
// ============================================================================

export interface SchemaAdapter {
  /**
   * Parse XML content into a SchemaTree.
   */
  parseSchema(content: string): Promise<SchemaTree>;

  /**
   * Parse XML with template inheritance resolution.
   */
  parseSchemaWithInheritance(content: string): Promise<ParseWithInheritanceResult>;

  /**
   * Scan a folder and convert to SchemaTree.
   */
  scanFolder(folderPath: string): Promise<SchemaTree>;

  /**
   * Scan a ZIP file and convert to SchemaTree.
   */
  scanZip(data: Uint8Array, filename: string): Promise<SchemaTree>;

  /**
   * Export SchemaTree back to XML string.
   */
  exportSchemaXml(tree: SchemaTree): Promise<string>;
}

// ============================================================================
// Structure Creator Adapter
// ============================================================================

export interface CreateStructureOptions {
  outputPath: string;
  variables: Record<string, string>;
  dryRun: boolean;
  overwrite: boolean;
}

export interface StructureCreatorAdapter {
  /**
   * Create structure from XML content.
   */
  createStructure(
    content: string,
    options: CreateStructureOptions
  ): Promise<CreateResult>;

  /**
   * Create structure from a SchemaTree.
   */
  createStructureFromTree(
    tree: SchemaTree,
    options: CreateStructureOptions
  ): Promise<CreateResult>;

  /**
   * Generate a diff preview showing what would be created/changed.
   */
  generateDiffPreview(
    tree: SchemaTree,
    outputPath: string,
    variables: Record<string, string>,
    overwrite: boolean
  ): Promise<DiffResult>;
}

// ============================================================================
// Validation Adapter
// ============================================================================

export interface ValidationAdapter {
  /**
   * Validate variables against their rules.
   */
  validateVariables(
    variables: Record<string, string>,
    rules: Record<string, ValidationRule>
  ): Promise<ValidationError[]>;
}

// ============================================================================
// Template Import/Export Adapter
// ============================================================================

export interface TemplateImportExportAdapter {
  /**
   * Export a single template as JSON.
   */
  exportTemplate(template: Template): Promise<string>;

  /**
   * Export multiple templates as a bundle JSON.
   */
  exportTemplatesBulk(templates: Template[]): Promise<string>;

  /**
   * Import templates from JSON content.
   */
  importTemplatesFromJson(
    jsonContent: string,
    duplicateStrategy: DuplicateStrategy,
    includeVariables?: boolean
  ): Promise<ImportResult>;

  /**
   * Import templates from a URL.
   */
  importTemplatesFromUrl(
    url: string,
    duplicateStrategy: DuplicateStrategy,
    includeVariables?: boolean
  ): Promise<ImportResult>;
}

// ============================================================================
// Watch Adapter
// ============================================================================

export interface WatchAdapter {
  /**
   * Start watching a schema file for changes.
   * Emits 'schema-file-changed' events when the file is modified.
   */
  startWatch(path: string): Promise<void>;

  /**
   * Stop watching the schema file.
   */
  stopWatch(): Promise<void>;

  /**
   * Get the currently watched path, or null if not watching.
   */
  getWatchStatus(): Promise<string | null>;

  /**
   * Register a callback for when the schema file changes.
   * Returns an unsubscribe function.
   */
  onSchemaFileChanged(callback: (path: string, content: string) => void): () => void;

  /**
   * Register a callback for watch errors.
   * Returns an unsubscribe function.
   */
  onWatchError(callback: (error: string) => void): () => void;
}

// ============================================================================
// Combined Platform Adapter
// ============================================================================

/**
 * The main adapter interface that combines all sub-adapters.
 * This is what components will use to interact with the platform.
 */
export interface PlatformAdapter {
  fileSystem: FileSystemAdapter;
  database: DatabaseAdapter;
  schema: SchemaAdapter;
  structureCreator: StructureCreatorAdapter;
  validation: ValidationAdapter;
  templateImportExport: TemplateImportExportAdapter;
  watch: WatchAdapter;

  /**
   * Initialize all adapters.
   */
  initialize(): Promise<void>;
}
