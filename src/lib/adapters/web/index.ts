/**
 * Web Platform Adapter
 * Combines all web-specific adapters into a single PlatformAdapter.
 */

import type {
  PlatformAdapter,
  FileSystemAdapter,
  DatabaseAdapter,
  SchemaAdapter,
  StructureCreatorAdapter,
  ValidationAdapter,
  TemplateImportExportAdapter,
  WatchAdapter,
  CreateStructureOptions,
} from "../types";

import type {
  SchemaTree,
  ValidationError,
  ValidationRule,
  CreateResult,
  DiffResult,
  ParseWithInheritanceResult,
} from "../../../types/schema";

import { IndexedDBAdapter } from "./indexeddb";
import { WebFileSystemAdapter, getHandleRegistry } from "./filesystem";
import { parseSchema, exportSchemaXml, scanDirectoryToSchema } from "./schema-parser";
import { createStructureFromTree, generateDiffPreview } from "./structure-creator";
import { validateVariables as validateVars } from "./transforms";
import { WebTemplateImportExportAdapter } from "./template-io";
import { scanZipToSchema } from "./zip-utils";

// ============================================================================
// Helper Functions
// ============================================================================

// Shared DOMParser instance (stateless, safe to reuse)
const domParser = new DOMParser();

/**
 * Extract the base template name from an XML schema's <extends> element.
 * Uses DOM parser for robust extraction (handles edge cases like > in attributes).
 * Returns undefined if no extends element is found.
 */
const extractExtendsFromXml = (xmlContent: string): string | undefined => {
  try {
    const doc = domParser.parseFromString(xmlContent, "application/xml");

    // Check for parsing errors
    const parseError = doc.querySelector("parsererror");
    if (parseError) {
      return undefined;
    }

    // Find the extends element
    const extendsElement = doc.querySelector("extends");
    if (!extendsElement) {
      return undefined;
    }

    // Get base name from template attribute or element content
    const templateAttr = extendsElement.getAttribute("template");
    if (templateAttr && templateAttr.trim()) {
      return templateAttr.trim();
    }

    const textContent = extendsElement.textContent?.trim();
    if (textContent) {
      return textContent;
    }

    return undefined;
  } catch {
    return undefined;
  }
};

// ============================================================================
// Web Schema Adapter
// ============================================================================

class WebSchemaAdapter implements SchemaAdapter {
  constructor(private database: DatabaseAdapter) {}

  async parseSchema(content: string): Promise<SchemaTree> {
    return parseSchema(content);
  }

  async parseSchemaWithInheritance(
    content: string
  ): Promise<ParseWithInheritanceResult> {
    // Parse the schema first
    const tree = parseSchema(content);

    // Use DOM parser to find extends element (more robust than regex)
    const baseName = extractExtendsFromXml(content);

    let mergedVariables: Record<string, string> = {};
    let mergedVariableValidation: Record<string, ValidationRule> = {};
    const baseTemplates: string[] = [];

    if (baseName) {
      // Track visited templates to detect circular inheritance
      const visited = new Set<string>();

      // Recursively resolve base templates
      const resolveBase = async (
        templateName: string
      ): Promise<void> => {
        // Check for circular inheritance
        if (visited.has(templateName)) {
          throw new Error(`Circular template inheritance detected: "${templateName}"`);
        }
        visited.add(templateName);

        const baseTemplate = await this.database.getTemplateByName(templateName);
        if (!baseTemplate) {
          throw new Error(`Base template not found: "${templateName}"`);
        }

        baseTemplates.push(templateName);

        // Check if base also extends another template using DOM parser
        const grandBaseName = extractExtendsFromXml(baseTemplate.schema_xml);
        if (grandBaseName) {
          await resolveBase(grandBaseName);
        }

        // Merge variables: start with accumulated values, then overlay this base's values
        // Since we resolve deepest first, each base overwrites the deeper ones
        // Child's own variables are merged after this function returns
        mergedVariables = {
          ...mergedVariables,
          ...baseTemplate.variables,
        };
        mergedVariableValidation = {
          ...mergedVariableValidation,
          ...baseTemplate.variable_validation,
        };
      };

      await resolveBase(baseName);
    }

    return {
      tree,
      mergedVariables,
      mergedVariableValidation,
      baseTemplates,
    };
  }

  async scanFolder(folderPath: string): Promise<SchemaTree> {
    // In web mode, we need to use the directory handle from the registry
    const handle = getHandleRegistry().getDirectoryHandle(folderPath);
    if (!handle) {
      // Try to get it as the root handle
      const rootHandle = getHandleRegistry().getRootHandle();
      if (rootHandle) {
        return scanDirectoryToSchema(rootHandle, folderPath);
      }
      throw new Error(
        `Directory handle not found for path: "${folderPath}". ` +
          "Please select a directory first using the file picker."
      );
    }
    return scanDirectoryToSchema(handle);
  }

  async scanZip(data: Uint8Array, filename: string): Promise<SchemaTree> {
    return scanZipToSchema(data, filename);
  }

  async exportSchemaXml(tree: SchemaTree): Promise<string> {
    return exportSchemaXml(tree);
  }
}

// ============================================================================
// Web Structure Creator Adapter
// ============================================================================

class WebStructureCreatorAdapter implements StructureCreatorAdapter {
  async createStructure(
    content: string,
    options: CreateStructureOptions
  ): Promise<CreateResult> {
    // Parse the schema first
    const tree = parseSchema(content);
    return this.createStructureFromTree(tree, options);
  }

  async createStructureFromTree(
    tree: SchemaTree,
    options: CreateStructureOptions
  ): Promise<CreateResult> {
    // Get the output directory handle
    const rootHandle = getHandleRegistry().getRootHandle();
    if (!rootHandle) {
      throw new Error(
        "No output directory selected. " +
          "Please select an output folder first using the directory picker."
      );
    }

    return createStructureFromTree(
      tree,
      rootHandle,
      options.variables,
      options.dryRun,
      options.overwrite
    );
  }

  async generateDiffPreview(
    tree: SchemaTree,
    _outputPath: string,
    variables: Record<string, string>,
    overwrite: boolean
  ): Promise<DiffResult> {
    const rootHandle = getHandleRegistry().getRootHandle();
    if (!rootHandle) {
      throw new Error(
        "No output directory selected. " +
          "Please select an output folder first using the directory picker."
      );
    }

    return generateDiffPreview(tree, rootHandle, variables, overwrite);
  }
}

// ============================================================================
// Web Validation Adapter
// ============================================================================

class WebValidationAdapter implements ValidationAdapter {
  async validateVariables(
    variables: Record<string, string>,
    rules: Record<string, ValidationRule>
  ): Promise<ValidationError[]> {
    return validateVars(variables, rules);
  }
}

// ============================================================================
// Web Watch Adapter (Stub - file watching not supported in browsers)
// ============================================================================

class WebWatchAdapter implements WatchAdapter {
  async startWatch(_path: string): Promise<void> {
    throw new Error("Watch mode is not supported in the web browser. Please use the desktop app for file watching functionality.");
  }

  async stopWatch(): Promise<void> {
    // No-op in web mode
  }

  async getWatchStatus(): Promise<string | null> {
    return null;
  }

  onSchemaFileChanged(_callback: (path: string, content: string) => void): () => void {
    // Return a no-op unsubscribe function
    return () => {};
  }

  onWatchError(_callback: (error: string) => void): () => void {
    // Return a no-op unsubscribe function
    return () => {};
  }
}

// ============================================================================
// Combined Web Platform Adapter
// ============================================================================

export class WebPlatformAdapter implements PlatformAdapter {
  fileSystem: FileSystemAdapter;
  database: DatabaseAdapter;
  schema: SchemaAdapter;
  structureCreator: StructureCreatorAdapter;
  validation: ValidationAdapter;
  templateImportExport: TemplateImportExportAdapter;
  watch: WatchAdapter;

  private indexedDB: IndexedDBAdapter;

  constructor() {
    this.indexedDB = new IndexedDBAdapter();
    this.fileSystem = new WebFileSystemAdapter();
    this.database = this.indexedDB;
    this.schema = new WebSchemaAdapter(this.database);
    this.structureCreator = new WebStructureCreatorAdapter();
    this.validation = new WebValidationAdapter();
    this.templateImportExport = new WebTemplateImportExportAdapter(this.database);
    this.watch = new WebWatchAdapter();
  }

  async initialize(): Promise<void> {
    // Check for File System Access API support before anything else
    if (
      !window.showOpenFilePicker ||
      !window.showDirectoryPicker ||
      !window.showSaveFilePicker
    ) {
      throw new Error(
        "Your browser does not support the File System Access API. " +
          "Please use a Chromium-based browser such as Google Chrome, Microsoft Edge, or Brave."
      );
    }

    await this.indexedDB.initialize();
  }
}

export const createWebAdapter = (): PlatformAdapter => {
  return new WebPlatformAdapter();
};

// Re-export utilities that might be needed elsewhere
export { substituteVariables } from "./transforms";
export { getHandleRegistry } from "./filesystem";
