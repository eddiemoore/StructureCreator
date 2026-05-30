/**
 * Tauri Platform Adapter
 * Wraps all Tauri invoke calls into the adapter interfaces.
 */

import { invoke } from "@tauri-apps/api/core";
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
    return invoke<Template[]>("cmd_list_templates");
  }

  async getTemplate(id: string): Promise<Template | null> {
    return invoke<Template | null>("cmd_get_template", { id });
  }

  async getTemplateByName(name: string): Promise<Template | null> {
    // Tauri doesn't expose this directly, so we'll list and filter
    const templates = await this.listTemplates();
    return (
      templates.find((t) => t.name.toLowerCase() === name.toLowerCase()) ?? null
    );
  }

  async createTemplate(input: CreateTemplateInput): Promise<Template> {
    await invoke("cmd_create_template", {
      name: input.name,
      description: input.description,
      schemaXml: input.schemaXml,
      variables: input.variables,
      variableValidation: input.variableValidation,
      iconColor: input.iconColor,
      tags: input.tags,
      wizardConfig: input.wizardConfig,
    });
    // Return the created template by fetching by name
    const template = await this.getTemplateByName(input.name);
    if (!template) {
      throw new Error("Failed to create template");
    }
    return template;
  }

  async updateTemplate(id: string, input: UpdateTemplateInput): Promise<void> {
    await invoke("cmd_update_template", {
      id,
      name: input.name,
      description: input.description,
      iconColor: input.iconColor,
    });
  }

  async deleteTemplate(id: string): Promise<boolean> {
    await invoke("cmd_delete_template", { id });
    return true;
  }

  async toggleFavorite(id: string): Promise<void> {
    await invoke("cmd_toggle_favorite", { id });
  }

  async incrementUseCount(id: string): Promise<void> {
    await invoke("cmd_use_template", { id });
  }

  async getAllTags(): Promise<string[]> {
    return invoke<string[]>("cmd_get_all_tags");
  }

  async updateTemplateTags(id: string, tags: string[]): Promise<void> {
    await invoke("cmd_update_template_tags", { id, tags });
  }

  async getAllSettings(): Promise<Record<string, string>> {
    return invoke<Record<string, string>>("cmd_get_settings");
  }

  async getSetting(key: string): Promise<string | null> {
    const settings = await this.getAllSettings();
    return settings[key] ?? null;
  }

  async setSetting(key: string, value: string): Promise<void> {
    await invoke("cmd_set_setting", { key, value });
  }

  // Recent projects operations

  async listRecentProjects(): Promise<RecentProject[]> {
    return invoke<RecentProject[]>("cmd_list_recent_projects");
  }

  async getRecentProject(id: string): Promise<RecentProject | null> {
    return invoke<RecentProject | null>("cmd_get_recent_project", { id });
  }

  async addRecentProject(input: CreateRecentProjectInput): Promise<RecentProject> {
    return invoke<RecentProject>("cmd_add_recent_project", {
      projectName: input.projectName,
      outputPath: input.outputPath,
      schemaXml: input.schemaXml,
      variables: input.variables,
      variableValidation: input.variableValidation,
      templateId: input.templateId,
      templateName: input.templateName,
      foldersCreated: input.foldersCreated,
      filesCreated: input.filesCreated,
    });
  }

  async deleteRecentProject(id: string): Promise<boolean> {
    return invoke<boolean>("cmd_delete_recent_project", { id });
  }

  async clearRecentProjects(): Promise<number> {
    return invoke<number>("cmd_clear_recent_projects");
  }
}

// ============================================================================
// Schema Adapter (Tauri)
// ============================================================================

class TauriSchemaAdapter implements SchemaAdapter {
  async parseSchema(content: string): Promise<SchemaTree> {
    return invoke<SchemaTree>("cmd_parse_schema", { content });
  }

  async parseSchemaWithInheritance(
    content: string
  ): Promise<ParseWithInheritanceResult> {
    return invoke<ParseWithInheritanceResult>(
      "cmd_parse_schema_with_inheritance",
      { content }
    );
  }

  async scanFolder(folderPath: string): Promise<SchemaTree> {
    return invoke<SchemaTree>("cmd_scan_folder", { folderPath });
  }

  async scanZip(data: Uint8Array, filename: string): Promise<SchemaTree> {
    return invoke<SchemaTree>("cmd_scan_zip", {
      data: Array.from(data),
      filename,
    });
  }

  async exportSchemaXml(tree: SchemaTree): Promise<string> {
    return invoke<string>("cmd_export_schema_xml", { tree });
  }

  async extractVariables(content: string): Promise<string[]> {
    return invoke<string[]>("cmd_extract_variables", { content });
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
    return invoke<CreateResult>("cmd_create_structure", {
      content,
      outputPath: options.outputPath,
      variables: toTokenKeys(options.variables),
      dryRun: options.dryRun,
      overwrite: options.overwrite,
      projectName: options.projectName,
    });
  }

  async createStructureFromTree(
    tree: SchemaTree,
    options: CreateStructureOptions
  ): Promise<CreateResult> {
    return invoke<CreateResult>("cmd_create_structure_from_tree", {
      tree,
      outputPath: options.outputPath,
      variables: toTokenKeys(options.variables),
      dryRun: options.dryRun,
      overwrite: options.overwrite,
      projectName: options.projectName,
    });
  }

  async generateDiffPreview(
    tree: SchemaTree,
    outputPath: string,
    variables: Record<string, string>,
    overwrite: boolean
  ): Promise<DiffResult> {
    return invoke<DiffResult>("cmd_generate_diff_preview", {
      tree,
      outputPath,
      variables: toTokenKeys(variables),
      overwrite,
    });
  }

  async undoStructure(
    items: CreatedItem[],
    dryRun: boolean
  ): Promise<UndoResult> {
    return invoke<UndoResult>("cmd_undo_structure", {
      items,
      dryRun,
    });
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
    return invoke<ValidationError[]>("cmd_validate_variables", {
      variables: toTokenKeys(variables),
      rules: toTokenKeys(rules),
    });
  }

  async validateSchema(
    content: string,
    variables: Record<string, string>
  ): Promise<SchemaValidationResult> {
    return invoke<SchemaValidationResult>("cmd_validate_schema", {
      content,
      variables: toTokenKeys(variables),
    });
  }
}

// ============================================================================
// Template Import/Export Adapter (Tauri)
// ============================================================================

class TauriTemplateImportExportAdapter implements TemplateImportExportAdapter {
  async exportTemplate(template: Template): Promise<string> {
    return invoke<string>("cmd_export_template", {
      templateId: template.id,
      includeVariables: true,
    });
  }

  async exportTemplatesBulk(templates: Template[]): Promise<string> {
    return invoke<string>("cmd_export_templates_bulk", {
      templateIds: templates.map((t) => t.id),
      includeVariables: true,
    });
  }

  async importTemplatesFromJson(
    jsonContent: string,
    duplicateStrategy: DuplicateStrategy,
    includeVariables: boolean = true
  ): Promise<ImportResult> {
    return invoke<ImportResult>("cmd_import_templates_from_json", {
      jsonContent,
      duplicateStrategy,
      includeVariables,
    });
  }

  async importTemplatesFromUrl(
    url: string,
    duplicateStrategy: DuplicateStrategy,
    includeVariables: boolean = true
  ): Promise<ImportResult> {
    return invoke<ImportResult>("cmd_import_templates_from_url", {
      url,
      duplicateStrategy,
      includeVariables,
    });
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
    await invoke("cmd_start_watch", { path });
  }

  async stopWatch(): Promise<void> {
    await invoke("cmd_stop_watch");
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
    return invoke<TeamLibrary[]>("cmd_list_team_libraries");
  }

  async addTeamLibrary(name: string, path: string): Promise<TeamLibrary> {
    return invoke<TeamLibrary>("cmd_add_team_library", { name, path });
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
    return invoke<TeamLibrary | null>("cmd_update_team_library", {
      id,
      name: updates.name,
      path: updates.path,
      syncInterval: updates.syncInterval,
      isEnabled: updates.isEnabled,
    });
  }

  async removeTeamLibrary(id: string): Promise<boolean> {
    return invoke<boolean>("cmd_remove_team_library", { id });
  }

  async scanTeamLibrary(libraryId: string): Promise<TeamTemplate[]> {
    return invoke<TeamTemplate[]>("cmd_scan_team_library", { libraryId });
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
    return invoke("cmd_get_team_template", { filePath });
  }

  async importTeamTemplate(
    libraryId: string,
    filePath: string,
    strategy: DuplicateStrategy
  ): Promise<TeamImportResult> {
    return invoke<TeamImportResult>("cmd_import_team_template", {
      libraryId,
      filePath,
      strategy,
    });
  }

  async getSyncLog(libraryId: string | null, limit: number): Promise<SyncLogEntry[]> {
    return invoke<SyncLogEntry[]>("cmd_get_sync_log", { libraryId, limit });
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
