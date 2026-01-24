/**
 * Template Import/Export for web mode.
 */

import type {
  Template,
  TemplateExportFile,
  TemplateExport,
  ImportResult,
  DuplicateStrategy,
} from "../../../types/schema";
import type { TemplateImportExportAdapter, DatabaseAdapter } from "../types";
import { isValidPublicUrl } from "./url-validation";
import { FETCH_TIMEOUT_MS, MAX_TEMPLATE_IMPORT_COUNT } from "./constants";

const EXPORT_VERSION = "1.0";
const MAX_IMPORT_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
const MAX_RENAME_ATTEMPTS = 100;
const MAX_TEMPLATE_NAME_LENGTH = 200;

// Shared DOMParser instance (stateless, safe to reuse)
const domParser = new DOMParser();

/**
 * Validate that a value is a non-empty string.
 */
const isNonEmptyString = (value: unknown): value is string => {
  return typeof value === "string" && value.trim().length > 0;
};

/**
 * Validate that a value is a string (can be empty).
 */
const isString = (value: unknown): value is string => {
  return typeof value === "string";
};

/**
 * Validate that a value is an object (not null, not array).
 */
const isObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

/**
 * Validate a template export object has the required structure.
 */
const validateTemplateExport = (data: unknown): data is TemplateExport => {
  if (!isObject(data)) {
    return false;
  }

  // Required: name must be a non-empty string
  if (!isNonEmptyString(data.name)) {
    return false;
  }

  // Required: schema_xml must be a non-empty string
  if (!isNonEmptyString(data.schema_xml)) {
    return false;
  }

  // Optional: description must be a string if present
  if (data.description !== undefined && !isString(data.description)) {
    return false;
  }

  // Optional: variables must be an object with string values if present
  if (data.variables !== undefined) {
    if (!isObject(data.variables)) {
      return false;
    }
    for (const value of Object.values(data.variables)) {
      if (!isString(value)) {
        return false;
      }
    }
  }

  // Optional: variable_validation must be an object if present
  if (data.variable_validation !== undefined && !isObject(data.variable_validation)) {
    return false;
  }

  // Optional: icon_color must be a string if present
  if (data.icon_color !== undefined && !isString(data.icon_color)) {
    return false;
  }

  return true;
};

/**
 * Validate that schema_xml is valid XML.
 */
const validateSchemaXml = (schemaXml: string): { valid: boolean; error?: string } => {
  try {
    const doc = domParser.parseFromString(schemaXml, "application/xml");
    const parseError = doc.querySelector("parsererror");
    if (parseError) {
      return { valid: false, error: `Invalid XML: ${parseError.textContent?.slice(0, 100)}` };
    }
    return { valid: true };
  } catch (e) {
    return { valid: false, error: `XML parsing failed: ${e instanceof Error ? e.message : String(e)}` };
  }
};

/**
 * Regex to match problematic Unicode characters:
 * - ASCII control characters (0x00-0x1F, 0x7F)
 * - Zero-width characters (U+200B-U+200F, U+FEFF)
 * - Bidirectional overrides (U+202A-U+202E, U+2066-U+2069)
 * - Other format characters that could cause display issues
 */
const PROBLEMATIC_UNICODE = /[\x00-\x1F\x7F\u200B-\u200F\uFEFF\u202A-\u202E\u2066-\u2069]/g;

/**
 * Sanitize and validate a template name.
 * Returns valid: true if the name can be used (possibly after sanitization).
 * Returns valid: false if the name is unusable (empty or too long).
 */
const sanitizeTemplateName = (name: string): { valid: boolean; sanitized: string; error?: string } => {
  // Trim whitespace
  const trimmed = name.trim();

  if (trimmed.length === 0) {
    return { valid: false, sanitized: "", error: "Template name cannot be empty" };
  }

  // Remove control characters and problematic Unicode
  const sanitized = trimmed.replace(PROBLEMATIC_UNICODE, "");

  // Check if sanitized name is empty (was all problematic characters)
  if (sanitized.length === 0) {
    return { valid: false, sanitized: "", error: "Template name contains only invalid characters" };
  }

  // Check length after sanitization
  if (sanitized.length > MAX_TEMPLATE_NAME_LENGTH) {
    return {
      valid: false,
      sanitized: "",
      error: `Template name exceeds maximum length of ${MAX_TEMPLATE_NAME_LENGTH} characters`
    };
  }

  return { valid: true, sanitized };
};

/**
 * Template Import/Export adapter for web mode.
 */
export class WebTemplateImportExportAdapter implements TemplateImportExportAdapter {
  constructor(private database: DatabaseAdapter) {}

  async exportTemplate(template: Template): Promise<string> {
    const exportData: TemplateExportFile = {
      version: EXPORT_VERSION,
      type: "template",
      exported_at: new Date().toISOString(),
      template: {
        name: template.name,
        description: template.description,
        schema_xml: template.schema_xml,
        variables: template.variables || {},
        variable_validation: template.variable_validation || {},
        icon_color: template.icon_color,
      },
    };

    return JSON.stringify(exportData, null, 2);
  }

  async exportTemplatesBulk(templates: Template[]): Promise<string> {
    const exportData: TemplateExportFile = {
      version: EXPORT_VERSION,
      type: "template_bundle",
      exported_at: new Date().toISOString(),
      templates: templates.map((t) => ({
        name: t.name,
        description: t.description,
        schema_xml: t.schema_xml,
        variables: t.variables || {},
        variable_validation: t.variable_validation || {},
        icon_color: t.icon_color,
      })),
    };

    return JSON.stringify(exportData, null, 2);
  }

  async importTemplatesFromJson(
    jsonContent: string,
    duplicateStrategy: DuplicateStrategy
  ): Promise<ImportResult> {
    const result: ImportResult = {
      imported: [],
      skipped: [],
      errors: [],
    };

    try {
      const data = JSON.parse(jsonContent) as unknown;

      // Validate basic structure
      if (!isObject(data)) {
        throw new Error("Invalid template file format: expected JSON object");
      }

      if (!isString(data.version) || !isString(data.type)) {
        throw new Error("Invalid template file format: missing version or type");
      }

      // Get templates to import
      let templatesToImport: unknown[] = [];
      if (data.type === "template" && data.template !== undefined) {
        templatesToImport = [data.template];
      } else if (data.type === "template_bundle" && Array.isArray(data.templates)) {
        templatesToImport = data.templates;
      } else {
        throw new Error("No templates found in file");
      }

      // Check template count to prevent resource exhaustion
      if (templatesToImport.length > MAX_TEMPLATE_IMPORT_COUNT) {
        throw new Error(
          `Too many templates in import file (${templatesToImport.length}). Maximum allowed is ${MAX_TEMPLATE_IMPORT_COUNT}.`
        );
      }

      // Validate and import each template
      for (let i = 0; i < templatesToImport.length; i++) {
        const templateData = templatesToImport[i];
        const templateIndex = templatesToImport.length > 1 ? ` (index ${i})` : "";

        try {
          // Validate template structure
          if (!validateTemplateExport(templateData)) {
            result.errors.push(`Template${templateIndex}: Invalid template structure - missing or invalid required fields`);
            continue;
          }

          // Validate schema XML
          const xmlValidation = validateSchemaXml(templateData.schema_xml);
          if (!xmlValidation.valid) {
            result.errors.push(`"${templateData.name}": ${xmlValidation.error}`);
            continue;
          }

          // Sanitize template name
          const nameValidation = sanitizeTemplateName(templateData.name);
          if (!nameValidation.valid) {
            result.errors.push(`Template${templateIndex}: ${nameValidation.error}`);
            continue;
          }

          // Use sanitized name
          const sanitizedTemplate: TemplateExport = {
            ...templateData,
            name: nameValidation.sanitized,
          };

          await this.importSingleTemplate(sanitizedTemplate, duplicateStrategy, result);
        } catch (e) {
          const errorMessage = e instanceof Error ? e.message : String(e);
          const name = isObject(templateData) && isString(templateData.name) ? templateData.name : `Template${templateIndex}`;
          result.errors.push(`"${name}": ${errorMessage}`);
        }
      }
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      result.errors.push(`Failed to parse JSON: ${errorMessage}`);
    }

    return result;
  }

  async importTemplatesFromUrl(
    url: string,
    duplicateStrategy: DuplicateStrategy
  ): Promise<ImportResult> {
    const result: ImportResult = {
      imported: [],
      skipped: [],
      errors: [],
    };

    // Validate URL for security
    const validation = isValidPublicUrl(url);
    if (!validation.valid) {
      result.errors.push(validation.error || "Invalid URL");
      return result;
    }

    try {
      // Use AbortController for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      let response: Response;
      try {
        response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
      } catch (e) {
        clearTimeout(timeoutId);
        if (e instanceof Error && e.name === "AbortError") {
          throw new Error(`Request timed out after ${FETCH_TIMEOUT_MS / 1000}s`);
        }
        throw e;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // Check Content-Length header if available (can be spoofed or omitted)
      const contentLength = response.headers.get("content-length");
      if (contentLength && parseInt(contentLength) > MAX_IMPORT_SIZE_BYTES) {
        throw new Error(`File too large (max ${MAX_IMPORT_SIZE_BYTES / 1024 / 1024}MB)`);
      }

      const jsonContent = await response.text();

      // Verify actual size after reading (Content-Length can be spoofed or omitted)
      if (jsonContent.length > MAX_IMPORT_SIZE_BYTES) {
        throw new Error(`Response too large (max ${MAX_IMPORT_SIZE_BYTES / 1024 / 1024}MB)`);
      }

      return this.importTemplatesFromJson(jsonContent, duplicateStrategy);
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      result.errors.push(`Failed to fetch URL: ${errorMessage}`);
      return result;
    }
  }

  private async importSingleTemplate(
    templateData: TemplateExport,
    duplicateStrategy: DuplicateStrategy,
    result: ImportResult
  ): Promise<void> {
    // Check if template with same name exists
    const existing = await this.database.getTemplateByName(templateData.name);

    if (existing) {
      switch (duplicateStrategy) {
        case "skip":
          result.skipped.push(templateData.name);
          return;

        case "replace":
          await this.database.deleteTemplate(existing.id);
          break;

        case "rename":
          // Find a unique name with upper bound to prevent infinite loops
          let newName = templateData.name;
          let counter = 1;
          while (await this.database.getTemplateByName(newName) && counter <= MAX_RENAME_ATTEMPTS) {
            newName = `${templateData.name} (${counter})`;
            counter++;
          }
          if (counter > MAX_RENAME_ATTEMPTS) {
            throw new Error(`Could not find unique name after ${MAX_RENAME_ATTEMPTS} attempts`);
          }
          templateData = { ...templateData, name: newName };
          break;
      }
    }

    // Create the template
    await this.database.createTemplate({
      name: templateData.name,
      description: templateData.description,
      schemaXml: templateData.schema_xml,
      variables: templateData.variables || {},
      variableValidation: templateData.variable_validation || {},
      iconColor: templateData.icon_color,
    });

    result.imported.push(templateData.name);
  }
}
