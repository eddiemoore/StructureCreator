/**
 * Tauri Platform Adapter
 * Wraps all Tauri invoke calls into the adapter interfaces.
 */

import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { toTokenKeys } from "../../../utils/variableName";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  readTextFile,
  readFile,
  writeTextFile,
  writeFile,
  mkdir,
  exists,
  stat,
  readDir,
} from "@tauri-apps/plugin-fs";

import type {
  PlatformAdapter,
  FileSystemAdapter,
  DatabaseAdapter,
  SchemaAdapter,
  StructureCreatorAdapter,
  ValidationAdapter,
  TemplateImportExportAdapter,
  WatchAdapter,
  TeamLibraryAdapter,
  PluginAdapter,
  FileFilter,
  CreateTemplateInput,
  UpdateTemplateInput,
  CreateStructureOptions,
  CreateRecentProjectInput,
} from "../types";

import { TauriPluginAdapter } from "./plugin";

import { commands } from "../../generated/commands";

/** Throw on a Result-shaped error; return the data on ok. */
function _unwrap<T>(r: { status: "ok"; data: T } | { status: "error"; error: string }): T {
  if (r.status === "error") throw new Error(r.error);
  return r.data;
}

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
  SchemaValidationResult,
  CreatedItem,
  UndoResult,
  TeamLibrary,
  TeamTemplate,
  SyncLogEntry,
  TeamImportResult,
} from "../../../types/schema";

// RecentProject crosses IPC in the wire shape directly (codegen, #116).

// ============================================================================
// File System Adapter (Tauri)
// ============================================================================

class TauriFileSystemAdapter implements FileSystemAdapter {
  async openFilePicker(options: {
    multiple?: boolean;
    filters?: FileFilter[];
  }): Promise<string | null> {
    const result = await open({
      multiple: options.multiple ?? false,
      filters: options.filters,
    });
    return result as string | null;
  }

  async openDirectoryPicker(): Promise<string | null> {
    const result = await open({
      directory: true,
      multiple: false,
    });
    return result as string | null;
  }

  async saveFilePicker(options: {
    filters?: FileFilter[];
    defaultPath?: string;
  }): Promise<string | null> {
    const result = await save({
      filters: options.filters,
      defaultPath: options.defaultPath,
    });
    return result;
  }

  async readTextFile(path: string): Promise<string> {
    return readTextFile(path);
  }

  async readBinaryFile(path: string): Promise<Uint8Array> {
    return readFile(path);
  }

  async writeTextFile(path: string, content: string): Promise<void> {
    await writeTextFile(path, content);
  }

  async writeBinaryFile(path: string, data: Uint8Array): Promise<void> {
    await writeFile(path, data);
  }

  async createDirectory(path: string): Promise<void> {
    await mkdir(path, { recursive: true });
  }

  async exists(path: string): Promise<boolean> {
    return exists(path);
  }

  async isFile(path: string): Promise<boolean> {
    try {
      const info = await stat(path);
      return info.isFile;
    } catch {
      return false;
    }
  }

  async isDirectory(path: string): Promise<boolean> {
    try {
      const info = await stat(path);
      return info.isDirectory;
    } catch {
      return false;
    }
  }

  async readDirectory(
    path: string
  ): Promise<{ name: string; isDirectory: boolean }[]> {
    const entries = await readDir(path);
    return entries.map((entry) => ({
      name: entry.name,
      isDirectory: entry.isDirectory,
    }));
  }
}

// ============================================================================
// Database Adapter (Tauri)
// ============================================================================

class TauriDatabaseAdapter implements DatabaseAdapter {
  async initialize(): Promise<void> {
    // Database is initialized by Tauri backend on app start
    // Nothing to do here
  }

  async listTemplates(): Promise<Template[]> {
    return _unwrap(await commands.cmdListTemplates()) as Template[];
  }

  async getTemplate(id: string): Promise<Template | null> {
    return _unwrap(await commands.cmdGetTemplate(id)) as Template | null;
  }

  async getTemplateByName(name: string): Promise<Template | null> {
    // Tauri doesn't expose this directly, so we'll list and filter
    const templates = await this.listTemplates();
    return (
      templates.find((t) => t.name.toLowerCase() === name.toLowerCase()) ?? null
    );
  }

  async createTemplate(input: CreateTemplateInput): Promise<Template> {
    _unwrap(
      await commands.cmdCreateTemplate(
        input.name,
        input.description ?? null,
        input.schemaXml,
        input.variables,
        (input.variableValidation as never) ?? null,
        input.iconColor ?? null,
        input.tags ?? null,
        (input.wizardConfig as never) ?? null,
      ),
    );
    // Return the created template by fetching by name
    const template = await this.getTemplateByName(input.name);
    if (!template) {
      throw new Error("Failed to create template");
    }
    return template;
  }

  async updateTemplate(id: string, input: UpdateTemplateInput): Promise<void> {
    _unwrap(
      await commands.cmdUpdateTemplate(
        id,
        input.name ?? null,
        input.description ?? null,
        input.iconColor ?? null,
        null,
      ),
    );
  }

  async deleteTemplate(id: string): Promise<boolean> {
    return _unwrap(await commands.cmdDeleteTemplate(id)) as boolean;
  }

  async toggleFavorite(id: string): Promise<void> {
    _unwrap(await commands.cmdToggleFavorite(id));
  }

  async incrementUseCount(id: string): Promise<void> {
    _unwrap(await commands.cmdUseTemplate(id));
  }

  async getAllTags(): Promise<string[]> {
    return _unwrap(await commands.cmdGetAllTags()) as string[];
  }

  async updateTemplateTags(id: string, tags: string[]): Promise<void> {
    _unwrap(await commands.cmdUpdateTemplateTags(id, tags));
  }

  async getAllSettings(): Promise<Record<string, string>> {
    return _unwrap(await commands.cmdGetSettings()) as Record<string, string>;
  }

  async getSetting(key: string): Promise<string | null> {
    const settings = await this.getAllSettings();
    return settings[key] ?? null;
  }

  async setSetting(key: string, value: string): Promise<void> {
    _unwrap(await commands.cmdSetSetting(key, value));
  }

  // Recent projects operations

  async listRecentProjects(): Promise<RecentProject[]> {
    return _unwrap(await commands.cmdListRecentProjects()) as RecentProject[];
  }

  async getRecentProject(id: string): Promise<RecentProject | null> {
    return _unwrap(await commands.cmdGetRecentProject(id)) as RecentProject | null;
  }

  async addRecentProject(input: CreateRecentProjectInput): Promise<RecentProject> {
    return _unwrap(await commands.cmdAddRecentProject(input.projectName, input.outputPath, input.schemaXml, input.variables, input.variableValidation as never, input.templateId ?? null, input.templateName ?? null, input.foldersCreated, input.filesCreated)) as RecentProject;
  }

  async deleteRecentProject(id: string): Promise<boolean> {
    return _unwrap(await commands.cmdDeleteRecentProject(id)) as boolean;
  }

  async clearRecentProjects(): Promise<number> {
    return _unwrap(await commands.cmdClearRecentProjects()) as number;
  }
}

// ============================================================================
// Schema Adapter (Tauri)
// ============================================================================

class TauriSchemaAdapter implements SchemaAdapter {
  async parseSchema(content: string): Promise<SchemaTree> {
    return _unwrap(await commands.cmdParseSchema(content)) as SchemaTree;
  }

  async parseSchemaWithInheritance(
    content: string
  ): Promise<ParseWithInheritanceResult> {
    return _unwrap(await commands.cmdParseSchemaWithInheritance(content)) as ParseWithInheritanceResult;
  }

  async scanFolder(folderPath: string): Promise<SchemaTree> {
    return _unwrap(await commands.cmdScanFolder(folderPath)) as SchemaTree;
  }

  async scanZip(data: Uint8Array, filename: string): Promise<SchemaTree> {
    return _unwrap(await commands.cmdScanZip(Array.from(data), filename)) as SchemaTree;
  }

  async exportSchemaXml(tree: SchemaTree): Promise<string> {
    return commands.cmdExportSchemaXml(tree as never);
  }

  async extractVariables(content: string): Promise<string[]> {
    return commands.cmdExtractVariables(content);
  }
}

// ============================================================================
// Structure Creator Adapter (Tauri)
// ============================================================================

class TauriStructureCreatorAdapter implements StructureCreatorAdapter {
  async createStructure(
    content: string,
    options: CreateStructureOptions
  ): Promise<CreateResult> {
    return _unwrap(await commands.cmdCreateStructure(content, options.outputPath, toTokenKeys(options.variables), options.dryRun, options.overwrite, options.projectName ?? null)) as CreateResult;
  }

  async createStructureFromTree(
    tree: SchemaTree,
    options: CreateStructureOptions
  ): Promise<CreateResult> {
    return _unwrap(await commands.cmdCreateStructureFromTree(tree as never, options.outputPath, toTokenKeys(options.variables), options.dryRun, options.overwrite, options.projectName ?? null)) as CreateResult;
  }

  async generateDiffPreview(
    tree: SchemaTree,
    outputPath: string,
    variables: Record<string, string>,
    overwrite: boolean
  ): Promise<DiffResult> {
    return _unwrap(await commands.cmdGenerateDiffPreview(tree, outputPath, toTokenKeys(variables), overwrite)) as DiffResult;
  }

  async undoStructure(
    items: CreatedItem[],
    dryRun: boolean
  ): Promise<UndoResult> {
    return _unwrap(await commands.cmdUndoStructure(items, dryRun)) as UndoResult;
  }
}

// ============================================================================
// Validation Adapter (Tauri)
// ============================================================================

class TauriValidationAdapter implements ValidationAdapter {
  async validateVariables(
    variables: Record<string, string>,
    rules: Record<string, ValidationRule>
  ): Promise<ValidationError[]> {
    return _unwrap(await commands.cmdValidateVariables(toTokenKeys(variables), toTokenKeys(rules) as never)) as ValidationError[];
  }

  async validateSchema(
    content: string,
    variables: Record<string, string>
  ): Promise<SchemaValidationResult> {
    return _unwrap(await commands.cmdValidateSchema(content, toTokenKeys(variables))) as SchemaValidationResult;
  }
}

// ============================================================================
// Template Import/Export Adapter (Tauri)
// ============================================================================

class TauriTemplateImportExportAdapter implements TemplateImportExportAdapter {
  async exportTemplate(template: Template): Promise<string> {
    return _unwrap(await commands.cmdExportTemplate(template.id, true)) as string;
  }

  async exportTemplatesBulk(templates: Template[]): Promise<string> {
    return _unwrap(await commands.cmdExportTemplatesBulk(templates.map((t) => t.id), true)) as string;
  }

  async importTemplatesFromJson(
    jsonContent: string,
    duplicateStrategy: DuplicateStrategy,
    includeVariables: boolean = true
  ): Promise<ImportResult> {
    return _unwrap(await commands.cmdImportTemplatesFromJson(jsonContent, duplicateStrategy, includeVariables)) as ImportResult;
  }

  async importTemplatesFromUrl(
    url: string,
    duplicateStrategy: DuplicateStrategy,
    includeVariables: boolean = true
  ): Promise<ImportResult> {
    return _unwrap(await commands.cmdImportTemplatesFromUrl(url, duplicateStrategy, includeVariables)) as ImportResult;
  }
}

// ============================================================================
// Watch Adapter (Tauri)
// ============================================================================

/** Event payload for schema file changes */
interface SchemaFileChangedPayload {
  path: string;
  content: string;
}

/** Event payload for watch errors */
interface WatchErrorPayload {
  error: string;
}

class TauriWatchAdapter implements WatchAdapter {
  async startWatch(path: string): Promise<void> {
    _unwrap(await commands.cmdStartWatch(path));
  }

  async stopWatch(): Promise<void> {
    _unwrap(await commands.cmdStopWatch());
  }

  onSchemaFileChanged(callback: (path: string, content: string) => void): () => void {
    let unlisten: UnlistenFn | null = null;
    let cancelled = false;

    // Set up the listener asynchronously
    listen<SchemaFileChangedPayload>("schema-file-changed", (event) => {
      callback(event.payload.path, event.payload.content);
    }).then((fn) => {
      if (cancelled) {
        // Already cancelled before listener was set up, immediately unsubscribe
        fn();
      } else {
        unlisten = fn;
      }
    }).catch((err) => {
      console.error("Failed to set up schema change listener:", err);
    });

    // Return an unsubscribe function
    return () => {
      cancelled = true;
      if (unlisten) {
        unlisten();
      }
    };
  }

  onWatchError(callback: (error: string) => void): () => void {
    let unlisten: UnlistenFn | null = null;
    let cancelled = false;

    // Set up the listener asynchronously
    listen<WatchErrorPayload>("watch-error", (event) => {
      callback(event.payload.error);
    }).then((fn) => {
      if (cancelled) {
        // Already cancelled before listener was set up, immediately unsubscribe
        fn();
      } else {
        unlisten = fn;
      }
    }).catch((err) => {
      console.error("Failed to set up watch error listener:", err);
    });

    // Return an unsubscribe function
    return () => {
      cancelled = true;
      if (unlisten) {
        unlisten();
      }
    };
  }
}

// ============================================================================
// Team Library Adapter (Tauri)
// ============================================================================

// Rust returns snake_case fields, these interfaces match the Rust structs
// Team library types cross IPC in the wire shape directly (codegen, #116).
// `cmd_get_sync_log` returns `action` as an unconstrained string in Rust; the
// frontend SyncLogEntry narrows it to the documented union.

class TauriTeamLibraryAdapter implements TeamLibraryAdapter {
  async listTeamLibraries(): Promise<TeamLibrary[]> {
    return _unwrap(await commands.cmdListTeamLibraries()) as TeamLibrary[];
  }

  async addTeamLibrary(name: string, path: string): Promise<TeamLibrary> {
    return _unwrap(await commands.cmdAddTeamLibrary(name, path)) as TeamLibrary;
  }

  async updateTeamLibrary(
    id: string,
    updates: {
      name?: string;
      path?: string;
      syncInterval?: number;
      isEnabled?: boolean;
    }
  ): Promise<TeamLibrary | null> {
    return _unwrap(await commands.cmdUpdateTeamLibrary(id, updates.name ?? null, updates.path ?? null, updates.syncInterval ?? null, updates.isEnabled ?? null)) as TeamLibrary | null;
  }

  async removeTeamLibrary(id: string): Promise<boolean> {
    return _unwrap(await commands.cmdRemoveTeamLibrary(id)) as boolean;
  }

  async scanTeamLibrary(libraryId: string): Promise<TeamTemplate[]> {
    return _unwrap(await commands.cmdScanTeamLibrary(libraryId)) as TeamTemplate[];
  }

  async getTeamTemplate(filePath: string): Promise<{
    template?: {
      name: string;
      description: string | null;
      schema_xml: string;
      variables?: Record<string, string>;
      icon_color: string | null;
      tags?: string[];
    };
    templates?: Array<{
      name: string;
      description: string | null;
      schema_xml: string;
      variables?: Record<string, string>;
      icon_color: string | null;
      tags?: string[];
    }>;
  }> {
    return _unwrap(await commands.cmdGetTeamTemplate(filePath)) as never;
  }

  async importTeamTemplate(
    libraryId: string,
    filePath: string,
    strategy: DuplicateStrategy
  ): Promise<TeamImportResult> {
    return _unwrap(await commands.cmdImportTeamTemplate(libraryId, filePath, strategy)) as TeamImportResult;
  }

  async getSyncLog(libraryId: string | null, limit: number): Promise<SyncLogEntry[]> {
    return _unwrap(await commands.cmdGetSyncLog(libraryId, limit)) as SyncLogEntry[];
  }
}

// ============================================================================
// Combined Tauri Platform Adapter
// ============================================================================

export class TauriPlatformAdapter implements PlatformAdapter {
  fileSystem: FileSystemAdapter;
  database: DatabaseAdapter;
  schema: SchemaAdapter;
  structureCreator: StructureCreatorAdapter;
  validation: ValidationAdapter;
  templateImportExport: TemplateImportExportAdapter;
  watch: WatchAdapter;
  teamLibrary: TeamLibraryAdapter;
  plugin: PluginAdapter;

  constructor() {
    this.fileSystem = new TauriFileSystemAdapter();
    this.database = new TauriDatabaseAdapter();
    this.schema = new TauriSchemaAdapter();
    this.structureCreator = new TauriStructureCreatorAdapter();
    this.validation = new TauriValidationAdapter();
    this.templateImportExport = new TauriTemplateImportExportAdapter();
    this.watch = new TauriWatchAdapter();
    this.teamLibrary = new TauriTeamLibraryAdapter();
    this.plugin = new TauriPluginAdapter();
  }

  async initialize(): Promise<void> {
    await this.database.initialize();
  }
}

export const createTauriAdapter = (): PlatformAdapter => {
  return new TauriPlatformAdapter();
};
