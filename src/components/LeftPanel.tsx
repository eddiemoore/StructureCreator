import { useState, useEffect, useRef, useCallback } from "react";
import { useAppStore } from "../store/appStore";
import { api } from "../lib/api";
import { useClickAwayEscape } from "../hooks";
import {
  CheckIcon,
  XIcon,
  FolderIcon,
  UploadIcon,
  LayersIcon,
  PlusIcon,
  StarIcon,
  TrashIcon,
  SaveIcon,
  ImportIcon,
  ExportIcon,
} from "./Icons";
import { ImportExportModal } from "./ImportExportModal";
import type { Template, ValidationRule } from "../types/schema";
import { TRANSFORMATIONS, DATE_FORMATS } from "../types/schema";
import type { ReactNode } from "react";

type SchemaSourceType = "xml" | "folder";

const SectionTitle = ({ children }: { children: ReactNode }) => (
  <div className="text-mac-xs font-medium text-text-muted mb-2">{children}</div>
);

const FileIcon = ({ size = 24, className = "" }: { size?: number; className?: string }) => (
  <svg
    className={className}
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
    <polyline points="10 9 9 9 8 9" />
  </svg>
);

const DownloadIcon = ({ size = 24, className = "" }: { size?: number; className?: string }) => (
  <svg
    className={className}
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

const SettingsIcon = ({ size = 24, className = "" }: { size?: number; className?: string }) => (
  <svg
    className={className}
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

const ChevronDownIcon = ({ size = 24, className = "" }: { size?: number; className?: string }) => (
  <svg
    className={className}
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

export const LeftPanel = () => {
  const {
    schemaPath,
    schemaContent,
    schemaTree,
    outputPath,
    projectName,
    variables,
    validationErrors,
    templates,
    templatesLoading,
    setSchemaPath,
    setSchemaContent,
    setSchemaTree,
    setOutputPath,
    setProjectName,
    updateVariable,
    addVariable,
    removeVariable,
    updateVariableValidation,
    setVariables,
    setTemplates,
    setTemplatesLoading,
    addLog,
  } = useAppStore();

  // State declarations
  const [sourceType, setSourceType] = useState<SchemaSourceType>("xml");
  const [isExporting, setIsExporting] = useState(false);
  const [isAddingVariable, setIsAddingVariable] = useState(false);
  const [newVarName, setNewVarName] = useState("");
  const [newVarValue, setNewVarValue] = useState("");
  const [editingValidation, setEditingValidation] = useState<string | null>(null);
  const [showTransformHelp, setShowTransformHelp] = useState(false);
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState("");
  const [newTemplateDescription, setNewTemplateDescription] = useState("");
  const [importExportMode, setImportExportMode] = useState<"import" | "export" | "bulk-export" | null>(null);
  const [exportTemplateId, setExportTemplateId] = useState<string | undefined>();

  // Refs for click-away detection
  const validationPopoverRef = useRef<HTMLDivElement>(null);
  const transformHelpRef = useRef<HTMLDivElement>(null);

  // Stable callbacks for click-away hooks
  const closeValidationPopover = useCallback(() => setEditingValidation(null), []);
  const closeTransformHelp = useCallback(() => setShowTransformHelp(false), []);

  // Click-away and Escape handlers for popovers
  useClickAwayEscape(validationPopoverRef, editingValidation !== null, closeValidationPopover);
  useClickAwayEscape(transformHelpRef, showTransformHelp, closeTransformHelp);

  // Helper to log inheritance resolution info
  const logInheritanceResolved = useCallback((baseTemplates: string[]) => {
    if (baseTemplates.length > 0) {
      addLog({
        type: "info",
        message: "Template inheritance resolved",
        details: `Extended: ${baseTemplates.join(" → ")}`,
      });
    }
  }, [addLog]);

  // Load templates on mount
  useEffect(() => {
    loadTemplates();
  }, []);

  const loadTemplates = async () => {
    setTemplatesLoading(true);
    try {
      const templates = await api.database.listTemplates();
      setTemplates(templates);
    } catch (e) {
      console.error("Failed to load templates:", e);
    } finally {
      setTemplatesLoading(false);
    }
  };

  const handleSaveAsTemplate = async () => {
    if (!schemaContent || !newTemplateName.trim()) return;

    try {
      // Convert variables array to a record/map for storage
      const variablesMap: Record<string, string> = {};
      const validationMap: Record<string, ValidationRule> = {};
      for (const v of variables) {
        variablesMap[v.name] = v.value;
        if (v.validation) {
          validationMap[v.name] = v.validation;
        }
      }

      await api.database.createTemplate({
        name: newTemplateName.trim(),
        description: newTemplateDescription.trim() || null,
        schemaXml: schemaContent,
        variables: variablesMap,
        variableValidation: validationMap,
        iconColor: null,
      });
      setIsSavingTemplate(false);
      setNewTemplateName("");
      setNewTemplateDescription("");
      loadTemplates();
    } catch (e) {
      console.error("Failed to save template:", e);
    }
  };

  const handleLoadTemplate = async (template: Template) => {
    try {
      // Increment use count
      await api.database.incrementUseCount(template.id);

      // Load the schema
      setSchemaPath(`template:${template.name}`);
      setSchemaContent(template.schema_xml);

      // Use inheritance-aware parsing to resolve any base templates
      const result = await api.schema.parseSchemaWithInheritance(template.schema_xml);
      setSchemaTree(result.tree);

      // Log info about inheritance if base templates were resolved
      logInheritanceResolved(result.baseTemplates);

      // Merge inherited variables with template's own variables
      // Template's own variables take precedence over inherited ones
      const mergedVariables = { ...result.mergedVariables, ...template.variables };

      // Merge validation rules: inherited rules first, then template's own rules override
      const mergedValidation = {
        ...result.mergedVariableValidation,
        ...template.variable_validation,
      };

      if (Object.keys(mergedVariables).length > 0) {
        const loadedVariables = Object.entries(mergedVariables).map(([name, value]) => ({
          name,
          value,
          validation: mergedValidation[name],
        }));
        setVariables(loadedVariables);
      }

      loadTemplates(); // Refresh to update use count
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      addLog({
        type: "error",
        message: "Failed to load template",
        details: errorMessage,
      });
    }
  };

  const handleToggleFavorite = async (e: React.MouseEvent, templateId: string) => {
    e.stopPropagation();
    try {
      await api.database.toggleFavorite(templateId);
      loadTemplates();
    } catch (e) {
      console.error("Failed to toggle favorite:", e);
    }
  };

  const handleDeleteTemplate = async (e: React.MouseEvent, templateId: string) => {
    e.stopPropagation();
    try {
      await api.database.deleteTemplate(templateId);
      loadTemplates();
    } catch (e) {
      console.error("Failed to delete template:", e);
    }
  };

  const handleExportTemplate = (e: React.MouseEvent, templateId: string) => {
    e.stopPropagation();
    setExportTemplateId(templateId);
    setImportExportMode("export");
  };

  const handleSelectSchema = async () => {
    try {
      const selected = await api.fileSystem.openFilePicker({
        multiple: false,
        filters: [
          { name: "Schema Files", extensions: ["xml", "zip"] },
          { name: "XML", extensions: ["xml"] },
          { name: "ZIP", extensions: ["zip"] },
        ],
      });

      if (selected) {
        const path = selected;
        setSchemaPath(path);

        const isZip = path.toLowerCase().endsWith(".zip");

        if (isZip) {
          // Handle ZIP file - read as binary and scan
          const data = await api.fileSystem.readBinaryFile(path);
          const filename = path.split("/").pop() || path.split("\\").pop() || "archive.zip";
          setSchemaContent(null); // ZIP doesn't have text content

          try {
            const tree = await api.schema.scanZip(data, filename);
            setSchemaTree(tree);
          } catch (e: unknown) {
            const errorMessage = e instanceof Error ? e.message : String(e);
            addLog({
              type: "error",
              message: "Failed to scan ZIP file",
              details: errorMessage,
            });
          }
        } else {
          // Handle XML file
          const content = await api.fileSystem.readTextFile(path);
          setSchemaContent(content);

          try {
            // Use inheritance-aware parsing to resolve any extends attributes
            const result = await api.schema.parseSchemaWithInheritance(content);
            setSchemaTree(result.tree);

            // Log info about inheritance if base templates were resolved
            logInheritanceResolved(result.baseTemplates);

            // If there are inherited variables/validation, set them
            // (matches template loading behavior - new schema replaces previous variables)
            if (Object.keys(result.mergedVariables).length > 0) {
              const loadedVariables = Object.entries(result.mergedVariables).map(([name, value]) => ({
                name,
                value,
                validation: result.mergedVariableValidation[name],
              }));
              setVariables(loadedVariables);
            }
          } catch (e: unknown) {
            const errorMessage = e instanceof Error ? e.message : String(e);
            addLog({
              type: "error",
              message: "Failed to parse schema",
              details: errorMessage,
            });
          }
        }
      }
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      addLog({
        type: "error",
        message: "Failed to open file dialog",
        details: errorMessage,
      });
    }
  };

  const handleSelectFolder = async () => {
    try {
      const selected = await api.fileSystem.openDirectoryPicker();

      if (selected) {
        const path = selected;
        setSchemaPath(path);
        setSchemaContent(null);

        try {
          const tree = await api.schema.scanFolder(path);
          setSchemaTree(tree);
        } catch (e: unknown) {
          const errorMessage = e instanceof Error ? e.message : String(e);
          addLog({
            type: "error",
            message: "Failed to scan folder",
            details: errorMessage,
          });
        }
      }
    } catch (e) {
      console.error("Failed to select folder:", e);
    }
  };

  const handleExportSchema = async () => {
    if (!schemaTree) return;

    setIsExporting(true);
    try {
      const xml = await api.schema.exportSchemaXml(schemaTree);

      const savePath = await api.fileSystem.saveFilePicker({
        filters: [{ name: "XML", extensions: ["xml"] }],
        defaultPath: `${schemaTree.root.name}-schema.xml`,
      });

      if (savePath) {
        await api.fileSystem.writeTextFile(savePath, xml);
        setSchemaContent(xml);
      }
    } catch (e) {
      console.error("Failed to export schema:", e);
    } finally {
      setIsExporting(false);
    }
  };

  const handleSelectOutput = async () => {
    try {
      const selected = await api.fileSystem.openDirectoryPicker();

      if (selected) {
        setOutputPath(selected);
      }
    } catch (e) {
      console.error("Failed to select output folder:", e);
    }
  };

  const handleRemoveSchema = () => {
    setSchemaPath(null);
    setSchemaContent(null);
    setSchemaTree(null);
  };

  const handleSourceTypeChange = (type: SchemaSourceType) => {
    setSourceType(type);
    handleRemoveSchema();
  };

  const fileName = schemaPath?.split("/").pop() || "";
  const lineCount = schemaContent?.split("\n").length || 0;
  const isFolderSource = sourceType === "folder";

  return (
    <aside className="bg-mac-sidebar border-r border-border-muted flex flex-col overflow-hidden">
      {/* Schema Source Section */}
      <div className="p-4 border-b border-border-muted">
        <SectionTitle>Schema Source</SectionTitle>

        {/* Source Type Toggle - macOS Segmented Control */}
        <div className="mac-segment mb-3">
          <button
            onClick={() => handleSourceTypeChange("xml")}
            className={`mac-segment-button flex items-center justify-center gap-1.5 ${
              sourceType === "xml" ? "active" : ""
            }`}
          >
            <FileIcon size={14} />
            File
          </button>
          <button
            onClick={() => handleSourceTypeChange("folder")}
            className={`mac-segment-button flex items-center justify-center gap-1.5 ${
              sourceType === "folder" ? "active" : ""
            }`}
          >
            <FolderIcon size={14} />
            Folder
          </button>
        </div>

        {schemaPath ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2.5 p-3 bg-card-bg rounded-mac border border-border-default">
              <div className="w-8 h-8 bg-system-green/10 rounded-mac flex items-center justify-center text-system-green">
                {isFolderSource ? <FolderIcon size={16} /> : <CheckIcon size={16} />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-mono text-mac-sm font-medium text-text-primary truncate">
                  {fileName}
                </div>
                <div className="text-mac-xs text-text-muted">
                  {isFolderSource ? (
                    schemaTree ? (
                      `${schemaTree.stats.folders} folders, ${schemaTree.stats.files} files`
                    ) : (
                      "Scanning..."
                    )
                  ) : (
                    `${lineCount} lines`
                  )}
                </div>
              </div>
              <button
                onClick={handleRemoveSchema}
                className="w-6 h-6 flex items-center justify-center rounded-mac text-text-muted hover:bg-system-red/10 hover:text-system-red transition-colors"
              >
                <XIcon size={14} />
              </button>
            </div>

            {isFolderSource && schemaTree && (
              <button
                onClick={handleExportSchema}
                disabled={isExporting}
                className="w-full py-2 px-3 text-mac-sm font-medium rounded-mac border border-border-default bg-card-bg text-text-secondary hover:bg-mac-bg-hover transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                <DownloadIcon size={14} />
                {isExporting ? "Exporting..." : "Export as XML"}
              </button>
            )}
          </div>
        ) : (
          <button
            onClick={isFolderSource ? handleSelectFolder : handleSelectSchema}
            className="w-full border-2 border-dashed border-accent rounded-mac-lg p-6 text-center hover:bg-accent/5 transition-all cursor-pointer"
          >
            {isFolderSource ? (
              <>
                <FolderIcon size={28} className="mx-auto mb-2 text-accent opacity-60" />
                <div className="text-mac-base text-text-secondary mb-0.5">
                  Select a folder
                </div>
                <div className="text-mac-xs text-text-muted">
                  Use existing folder as template
                </div>
              </>
            ) : (
              <>
                <UploadIcon size={28} className="mx-auto mb-2 text-accent opacity-60" />
                <div className="text-mac-base text-text-secondary mb-0.5">
                  Select schema file
                </div>
                <div className="text-mac-xs text-text-muted">
                  Click to browse
                </div>
              </>
            )}
          </button>
        )}
      </div>

      {/* Output Settings Section */}
      <div className="p-4 border-b border-border-muted">
        <SectionTitle>Output Settings</SectionTitle>
        <div className="space-y-3">
          <div>
            <label className="block text-mac-xs font-medium text-text-secondary mb-1">
              Output Folder
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={outputPath || ""}
                readOnly
                placeholder="Select folder..."
                className="mac-input flex-1 font-mono text-mac-sm"
              />
              <button
                onClick={handleSelectOutput}
                className="mac-button-secondary px-3"
              >
                <FolderIcon size={16} className="text-text-secondary" />
              </button>
            </div>
          </div>
          <div>
            <label className="block text-mac-xs font-medium text-text-secondary mb-1">
              Project Name
            </label>
            <input
              type="text"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="my-project"
              className="mac-input w-full font-mono text-mac-sm"
            />
          </div>
        </div>
      </div>

      {/* Variables Section */}
      <div className="p-4 border-b border-border-muted">
        <div className="flex items-center justify-between mb-2">
          <SectionTitle>Variables</SectionTitle>
          <button
            onClick={() => setIsAddingVariable(true)}
            className="w-5 h-5 flex items-center justify-center rounded text-text-muted hover:text-accent hover:bg-accent/10 transition-colors"
            title="Add variable"
          >
            <PlusIcon size={14} />
          </button>
        </div>
        <div className="space-y-1.5">
          {variables.map((variable) => {
            // Match by clean name (without % delimiters) since validation returns clean names
            const cleanName = variable.name.replace(/^%|%$/g, "");
            const varError = validationErrors.find(
              (e) => e.variable_name === cleanName
            );
            const hasValidation = variable.validation && (
              variable.validation.required ||
              variable.validation.minLength ||
              variable.validation.maxLength ||
              variable.validation.pattern
            );
            return (
              // Conditional ref: only the currently-editing variable's container gets the ref
              // This allows the click-away hook to detect clicks outside the active popover
              <div
                key={variable.name}
                className="relative"
                ref={editingValidation === variable.name ? validationPopoverRef : undefined}
              >
                <div
                  className={`flex items-center gap-2 p-2 bg-card-bg rounded-mac border group ${
                    varError ? "border-system-red" : "border-border-muted"
                  }`}
                >
                  <span className="font-mono text-mac-xs font-medium text-system-orange bg-system-orange/10 px-1.5 py-0.5 rounded flex-shrink-0">
                    {variable.name}
                  </span>
                  <span className="text-text-muted text-mac-xs">=</span>
                  <input
                    type="text"
                    value={variable.value}
                    onChange={(e) => updateVariable(variable.name, e.target.value)}
                    className="flex-1 min-w-0 bg-transparent font-mono text-mac-xs text-text-primary outline-none border-b border-transparent focus:border-accent transition-colors"
                    placeholder="Enter value..."
                    aria-invalid={varError ? "true" : undefined}
                    aria-describedby={varError ? `error-${variable.name}` : undefined}
                  />
                  <button
                    onClick={() =>
                      setEditingValidation(
                        editingValidation === variable.name ? null : variable.name
                      )
                    }
                    className={`w-5 h-5 flex items-center justify-center rounded transition-all ${
                      hasValidation
                        ? "text-accent"
                        : "text-text-muted opacity-0 group-hover:opacity-100"
                    } hover:text-accent hover:bg-accent/10`}
                    title="Configure validation"
                    aria-expanded={editingValidation === variable.name}
                    aria-controls={`validation-panel-${variable.name}`}
                    aria-label={`Configure validation for ${variable.name}`}
                  >
                    <SettingsIcon size={12} />
                  </button>
                  <button
                    onClick={() => removeVariable(variable.name)}
                    className="w-5 h-5 flex items-center justify-center rounded text-text-muted opacity-0 group-hover:opacity-100 hover:text-system-red hover:bg-system-red/10 transition-all"
                    title="Remove variable"
                  >
                    <XIcon size={12} />
                  </button>
                </div>
                {varError && (
                  <p
                    id={`error-${variable.name}`}
                    role="alert"
                    className="mt-0.5 text-mac-xs text-system-red pl-2"
                  >
                    {varError.message}
                  </p>
                )}
                {/* Validation Config Popover */}
                {editingValidation === variable.name && (
                  <div
                    id={`validation-panel-${variable.name}`}
                    role="region"
                    aria-label={`Validation settings for ${variable.name}`}
                    className="mt-1 p-2 bg-card-bg rounded-mac border border-accent text-mac-xs"
                  >
                    <div className="font-medium text-text-primary mb-2">
                      Validation Rules
                    </div>
                    <label className="flex items-center gap-2 mb-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={variable.validation?.required ?? false}
                        onChange={(e) =>
                          updateVariableValidation(variable.name, {
                            ...variable.validation,
                            required: e.target.checked,
                          })
                        }
                        className="rounded border-border-default"
                      />
                      <span className="text-text-secondary">Required</span>
                    </label>
                    <div className="flex gap-2 mb-2">
                      <label className="flex-1">
                        <span className="text-text-muted block mb-0.5">
                          Min length
                        </span>
                        <input
                          type="number"
                          min="0"
                          value={variable.validation?.minLength ?? ""}
                          onChange={(e) => {
                            const val = parseInt(e.target.value);
                            const minLength = !e.target.value ? undefined :
                              (isNaN(val) || val < 0) ? 0 : val;
                            // Ensure min doesn't exceed max
                            const maxLength = variable.validation?.maxLength;
                            updateVariableValidation(variable.name, {
                              ...variable.validation,
                              minLength,
                              maxLength: maxLength !== undefined && minLength !== undefined && minLength > maxLength
                                ? minLength : maxLength,
                            });
                          }}
                          className="w-full bg-bg-primary border border-border-default rounded px-2 py-1 text-text-primary outline-none focus:border-accent"
                          placeholder="0"
                        />
                      </label>
                      <label className="flex-1">
                        <span className="text-text-muted block mb-0.5">
                          Max length
                        </span>
                        <input
                          type="number"
                          min="0"
                          value={variable.validation?.maxLength ?? ""}
                          onChange={(e) => {
                            const val = parseInt(e.target.value);
                            const maxLength = !e.target.value ? undefined :
                              (isNaN(val) || val < 0) ? 0 : val;
                            // Ensure max isn't less than min
                            const minLength = variable.validation?.minLength;
                            updateVariableValidation(variable.name, {
                              ...variable.validation,
                              maxLength,
                              minLength: minLength !== undefined && maxLength !== undefined && maxLength < minLength
                                ? maxLength : minLength,
                            });
                          }}
                          className="w-full bg-bg-primary border border-border-default rounded px-2 py-1 text-text-primary outline-none focus:border-accent"
                          placeholder="None"
                        />
                      </label>
                    </div>
                    <label className="block mb-2">
                      <span className="text-text-muted block mb-0.5">
                        Pattern (regex)
                      </span>
                      <input
                        type="text"
                        value={variable.validation?.pattern ?? ""}
                        onChange={(e) =>
                          updateVariableValidation(variable.name, {
                            ...variable.validation,
                            pattern: e.target.value || undefined,
                          })
                        }
                        className="w-full bg-bg-primary border border-border-default rounded px-2 py-1 font-mono text-text-primary outline-none focus:border-accent"
                        placeholder="e.g., ^[a-z]+$"
                      />
                    </label>
                    <button
                      onClick={() => setEditingValidation(null)}
                      className="w-full px-2 py-1 text-accent hover:bg-accent/10 rounded transition-colors font-medium"
                    >
                      Done
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          {/* Add Variable Form */}
          {isAddingVariable && (
            <div className="p-2 bg-card-bg rounded-mac border border-accent">
              <div className="flex items-center gap-2 mb-2">
                <input
                  type="text"
                  value={newVarName}
                  onChange={(e) => setNewVarName(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ""))}
                  placeholder="VARIABLE_NAME"
                  className="flex-1 bg-transparent font-mono text-mac-xs text-text-primary outline-none border-b border-border-default focus:border-accent"
                  autoFocus
                />
              </div>
              <div className="flex items-center gap-2 mb-2">
                <input
                  type="text"
                  value={newVarValue}
                  onChange={(e) => setNewVarValue(e.target.value)}
                  placeholder="Value"
                  className="flex-1 bg-transparent font-mono text-mac-xs text-text-primary outline-none border-b border-border-default focus:border-accent"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => {
                    setIsAddingVariable(false);
                    setNewVarName("");
                    setNewVarValue("");
                  }}
                  className="px-2 py-1 text-mac-xs text-text-secondary hover:text-text-primary transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    if (newVarName.trim()) {
                      addVariable(newVarName, newVarValue);
                      setIsAddingVariable(false);
                      setNewVarName("");
                      setNewVarValue("");
                    }
                  }}
                  disabled={!newVarName.trim()}
                  className="px-2 py-1 text-mac-xs font-medium text-accent hover:bg-accent/10 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Add
                </button>
              </div>
            </div>
          )}
        </div>
        <p className="mt-2 text-mac-xs text-text-muted">
          Use %VARIABLE% in file names or content
        </p>

        {/* Transformation Help */}
        <div ref={transformHelpRef}>
          <button
            onClick={() => setShowTransformHelp(!showTransformHelp)}
            className="mt-2 flex items-center gap-1 text-mac-xs text-text-muted hover:text-accent transition-colors"
            aria-expanded={showTransformHelp}
            aria-controls="transform-help-panel"
          >
            <ChevronDownIcon
              size={12}
              className={`transition-transform ${showTransformHelp ? "rotate-180" : ""}`}
            />
            <span>Available transformations</span>
          </button>
          {showTransformHelp && (
            <div
              id="transform-help-panel"
              role="region"
              aria-label="Available variable transformations"
              className="mt-2 p-2 bg-card-bg rounded-mac border border-border-muted text-mac-xs space-y-1"
            >
              <div className="font-medium text-text-primary mb-1">
                Case transformations
              </div>
              {TRANSFORMATIONS.map((t) => (
                <div key={t.id} className="flex items-center gap-2">
                  <code className="font-mono text-accent bg-accent/10 px-1 rounded">
                    :{t.id}
                  </code>
                  <span className="text-text-muted">{t.example}</span>
                </div>
              ))}
              <div className="font-medium text-text-primary mt-2 mb-1">
                Date formatting
              </div>
              {DATE_FORMATS.map((f) => (
                <div key={f.id} className="flex items-center gap-2">
                  <code className="font-mono text-accent bg-accent/10 px-1 rounded">
                    :format({f.id})
                  </code>
                  <span className="text-text-muted">{f.label}</span>
                </div>
              ))}
              <div className="mt-2 pt-2 border-t border-border-muted text-text-muted">
                Example: <code className="font-mono">%NAME:kebab-case%</code>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Templates Section */}
      <div className="p-4 flex-1 overflow-auto mac-scroll flex flex-col">
        <div className="flex items-center justify-between mb-2">
          <SectionTitle>Templates</SectionTitle>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setImportExportMode("import")}
              className="w-5 h-5 flex items-center justify-center rounded text-text-muted hover:text-accent hover:bg-accent/10 transition-colors"
              title="Import templates"
            >
              <ImportIcon size={14} />
            </button>
            {templates.length > 0 && (
              <button
                onClick={() => setImportExportMode("bulk-export")}
                className="w-5 h-5 flex items-center justify-center rounded text-text-muted hover:text-accent hover:bg-accent/10 transition-colors"
                title="Export templates"
              >
                <ExportIcon size={14} />
              </button>
            )}
            {schemaContent && (
              <button
                onClick={() => setIsSavingTemplate(true)}
                className="w-5 h-5 flex items-center justify-center rounded text-text-muted hover:text-system-blue hover:bg-system-blue/10 transition-colors"
                title="Save as template"
              >
                <SaveIcon size={14} />
              </button>
            )}
          </div>
        </div>

        {/* Save Template Form */}
        {isSavingTemplate && (
          <div className="p-3 bg-card-bg rounded-mac border border-system-blue mb-3">
            <div className="text-mac-xs font-medium text-text-primary mb-2">Save as Template</div>
            <input
              type="text"
              value={newTemplateName}
              onChange={(e) => setNewTemplateName(e.target.value)}
              placeholder="Template name"
              className="w-full mac-input mb-2 text-mac-sm"
              autoFocus
            />
            <input
              type="text"
              value={newTemplateDescription}
              onChange={(e) => setNewTemplateDescription(e.target.value)}
              placeholder="Description (optional)"
              className="w-full mac-input mb-2 text-mac-sm"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  setIsSavingTemplate(false);
                  setNewTemplateName("");
                  setNewTemplateDescription("");
                }}
                className="px-2 py-1 text-mac-xs text-text-secondary hover:text-text-primary transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveAsTemplate}
                disabled={!newTemplateName.trim()}
                className="px-2 py-1 text-mac-xs font-medium text-accent hover:bg-accent/10 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Save
              </button>
            </div>
          </div>
        )}

        <div className="space-y-2 flex-1">
          {templatesLoading ? (
            <div className="text-center text-text-muted text-mac-sm py-4">
              Loading templates...
            </div>
          ) : templates.length === 0 ? (
            <div className="text-center text-text-muted text-mac-sm py-4">
              <LayersIcon size={24} className="mx-auto mb-2 opacity-30" />
              <div>No templates yet</div>
              <div className="text-mac-xs mt-1">Load a schema and save it as a template</div>
            </div>
          ) : (
            templates.map((template) => (
              <div
                key={template.id}
                onClick={() => handleLoadTemplate(template)}
                className="mac-sidebar-item p-3 bg-card-bg border border-border-muted rounded-mac cursor-pointer group"
              >
                <div
                  className="w-8 h-8 rounded-mac flex items-center justify-center flex-shrink-0"
                  style={{
                    backgroundColor: `${template.icon_color || "#0a84ff"}15`,
                    color: template.icon_color || "#0a84ff",
                  }}
                >
                  <LayersIcon size={16} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-mac-sm font-medium text-text-primary truncate">
                    {template.name}
                  </div>
                  <div className="text-mac-xs text-text-muted truncate">
                    {template.description || `Used ${template.use_count} times`}
                  </div>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(e) => handleToggleFavorite(e, template.id)}
                    className={`w-6 h-6 flex items-center justify-center rounded transition-colors ${
                      template.is_favorite
                        ? "text-system-orange"
                        : "text-text-muted hover:text-system-orange"
                    }`}
                    title={template.is_favorite ? "Remove from favorites" : "Add to favorites"}
                  >
                    <StarIcon size={14} filled={template.is_favorite} />
                  </button>
                  <button
                    onClick={(e) => handleExportTemplate(e, template.id)}
                    className="w-6 h-6 flex items-center justify-center rounded text-text-muted hover:text-accent hover:bg-accent/10 transition-colors"
                    title="Export template"
                  >
                    <ExportIcon size={14} />
                  </button>
                  <button
                    onClick={(e) => handleDeleteTemplate(e, template.id)}
                    className="w-6 h-6 flex items-center justify-center rounded text-text-muted hover:text-system-red hover:bg-system-red/10 transition-colors"
                    title="Delete template"
                  >
                    <TrashIcon size={14} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Import/Export Modal */}
      <ImportExportModal
        isOpen={importExportMode !== null}
        onClose={() => {
          setImportExportMode(null);
          setExportTemplateId(undefined);
        }}
        mode={importExportMode || "import"}
        templates={templates}
        selectedTemplateId={exportTemplateId}
        onComplete={loadTemplates}
      />
    </aside>
  );
};
