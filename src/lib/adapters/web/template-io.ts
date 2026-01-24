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

const EXPORT_VERSION = "1.0";
const FETCH_TIMEOUT_MS = 30000;

/**
 * Validate URL for security - block internal/private addresses.
 */
const isValidPublicUrl = (urlString: string): { valid: boolean; error?: string } => {
  try {
    const url = new URL(urlString);

    // Must be HTTPS
    if (url.protocol !== "https:") {
      return { valid: false, error: "URL must use HTTPS protocol" };
    }

    // Block localhost and common internal hostnames
    const hostname = url.hostname.toLowerCase();
    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "0.0.0.0" ||
      hostname === "[::1]" ||
      hostname.endsWith(".local") ||
      hostname.endsWith(".internal")
    ) {
      return { valid: false, error: "Cannot import from localhost or internal addresses" };
    }

    // Block private IP ranges (basic check - covers most cases)
    const ipMatch = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (ipMatch) {
      const [, a, b] = ipMatch.map(Number);
      // 10.x.x.x, 172.16-31.x.x, 192.168.x.x
      if (
        a === 10 ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        a === 127
      ) {
        return { valid: false, error: "Cannot import from private IP addresses" };
      }
    }

    return { valid: true };
  } catch {
    return { valid: false, error: "Invalid URL format" };
  }
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
        variables: template.variables,
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
        variables: t.variables,
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
      const data = JSON.parse(jsonContent) as TemplateExportFile;

      // Validate structure
      if (!data.version || !data.type) {
        throw new Error("Invalid template file format");
      }

      // Get templates to import
      let templatesToImport: TemplateExport[] = [];
      if (data.type === "template" && data.template) {
        templatesToImport = [data.template];
      } else if (data.type === "template_bundle" && data.templates) {
        templatesToImport = data.templates;
      } else {
        throw new Error("No templates found in file");
      }

      // Import each template
      for (const templateData of templatesToImport) {
        try {
          await this.importSingleTemplate(templateData, duplicateStrategy, result);
        } catch (e) {
          const errorMessage = e instanceof Error ? e.message : String(e);
          result.errors.push(`${templateData.name}: ${errorMessage}`);
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

      const contentLength = response.headers.get("content-length");
      if (contentLength && parseInt(contentLength) > 10 * 1024 * 1024) {
        throw new Error("File too large (max 10MB)");
      }

      const jsonContent = await response.text();
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
          // Find a unique name
          let newName = templateData.name;
          let counter = 1;
          while (await this.database.getTemplateByName(newName)) {
            newName = `${templateData.name} (${counter})`;
            counter++;
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
      variableValidation: {},
      iconColor: templateData.icon_color,
    });

    result.imported.push(templateData.name);
  }
}
