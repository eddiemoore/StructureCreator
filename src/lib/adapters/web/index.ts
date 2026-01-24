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

    // Check for extends
    const parser = new DOMParser();
    const doc = parser.parseFromString(content, "application/xml");
    const extendsElement = doc.querySelector("extends");

    let mergedVariables: Record<string, string> = {};
    let mergedVariableValidation: Record<string, ValidationRule> = {};
    const baseTemplates: string[] = [];

    if (extendsElement) {
      const baseName = extendsElement.getAttribute("template") || extendsElement.textContent?.trim();

      if (baseName) {
        // Recursively resolve base templates
        const resolveBase = async (
          templateName: string
        ): Promise<void> => {
          const baseTemplate = await this.database.getTemplateByName(templateName);
          if (!baseTemplate) {
            throw new Error(`Base template not found: ${templateName}`);
          }

          baseTemplates.push(templateName);

          // Check if base also extends another template
          const baseDoc = parser.parseFromString(
            baseTemplate.schema_xml,
            "application/xml"
          );
          const baseExtends = baseDoc.querySelector("extends");
          if (baseExtends) {
            const grandBaseName =
              baseExtends.getAttribute("template") ||
              baseExtends.textContent?.trim();
            if (grandBaseName) {
              await resolveBase(grandBaseName);
            }
          }

          // Merge variables (base values, child overrides)
          mergedVariables = {
            ...baseTemplate.variables,
            ...mergedVariables,
          };
          mergedVariableValidation = {
            ...baseTemplate.variable_validation,
            ...mergedVariableValidation,
          };
        };

        await resolveBase(baseName);
      }
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
        `Directory handle not found for path: ${folderPath}. ` +
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
// Combined Web Platform Adapter
// ============================================================================

export class WebPlatformAdapter implements PlatformAdapter {
  fileSystem: FileSystemAdapter;
  database: DatabaseAdapter;
  schema: SchemaAdapter;
  structureCreator: StructureCreatorAdapter;
  validation: ValidationAdapter;
  templateImportExport: TemplateImportExportAdapter;

  private indexedDB: IndexedDBAdapter;

  constructor() {
    this.indexedDB = new IndexedDBAdapter();
    this.fileSystem = new WebFileSystemAdapter();
    this.database = this.indexedDB;
    this.schema = new WebSchemaAdapter(this.database);
    this.structureCreator = new WebStructureCreatorAdapter();
    this.validation = new WebValidationAdapter();
    this.templateImportExport = new WebTemplateImportExportAdapter(this.database);
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
