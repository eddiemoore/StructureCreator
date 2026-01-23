import { useState, useEffect, useRef, useCallback, useMemo, useDeferredValue } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, readFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore, getFilteredTemplates } from "../store/appStore";
import { useClickAwayEscape } from "../hooks";
import {
  CheckIcon,
  XIcon,
  FolderIcon,
  FileIcon,
  UploadIcon,
  DownloadIcon,
  LayersIcon,
  PlusIcon,
  StarIcon,
  TrashIcon,
  SaveIcon,
  ImportIcon,
  ExportIcon,
  SearchIcon,
  TagIcon,
  SettingsIcon,
  ChevronDownIcon,
  ArrowUpIcon,
} from "./Icons";
import { ImportExportModal } from "./ImportExportModal";
import { TagInput } from "./TagInput";
import type { SchemaTree, Template, ValidationRule, ParseWithInheritanceResult, TemplateSortField } from "../types/schema";
import { TRANSFORMATIONS, DATE_FORMATS } from "../types/schema";
import type { ReactNode } from "react";

type SchemaSourceType = "xml" | "folder";

// Constants for UI limits (moved to module scope for performance)
const MAX_VISIBLE_FILTER_TAGS = 8;
const MAX_VISIBLE_TEMPLATE_TAGS = 3;
/** Duration to display tag operation errors before auto-dismissing (ms) */
const TAG_ERROR_DISPLAY_MS = 3000;

const SectionTitle = ({ children }: { children: ReactNode }) => (
  <div className="text-mac-xs font-medium text-text-muted mb-2">{children}</div>
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
    templateSearchQuery,
    templateSelectedTags,
    templateSortBy,
    templateSortOrder,
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
    setTemplateSearchQuery,
    toggleTemplateTag,
    setTemplateSelectedTags,
    setTemplateSortBy,
    setTemplateSortOrder,
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
  const [newTemplateTags, setNewTemplateTags] = useState<string[]>([]);
  const [importExportMode, setImportExportMode] = useState<"import" | "export" | "bulk-export" | null>(null);
  const [exportTemplateId, setExportTemplateId] = useState<string | undefined>();
  const [editingTagsTemplateId, setEditingTagsTemplateId] = useState<string | null>(null);
  const [editingTags, setEditingTags] = useState<string[]>([]);
  const [showAllFilterTags, setShowAllFilterTags] = useState(false);
  const [tagOperationError, setTagOperationError] = useState<string | null>(null);
  const [isUpdatingTags, setIsUpdatingTags] = useState(false);

  // Debounced search query for better performance
  const deferredSearchQuery = useDeferredValue(templateSearchQuery);

  // Refs for click-away detection
  const validationPopoverRef = useRef<HTMLDivElement>(null);
  const transformHelpRef = useRef<HTMLDivElement>(null);
  const tagEditingRef = useRef<HTMLDivElement>(null);
  // Ref for error timeout cleanup
  const errorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup error timeout on unmount
  useEffect(() => {
    return () => {
      if (errorTimeoutRef.current) {
        clearTimeout(errorTimeoutRef.current);
      }
    };
  }, []);

  // Stable callbacks for click-away hooks
  const closeValidationPopover = useCallback(() => setEditingValidation(null), []);
  const closeTransformHelp = useCallback(() => setShowTransformHelp(false), []);
  const closeTagEditing = useCallback(() => setEditingTagsTemplateId(null), []);

  // Click-away and Escape handlers for popovers
  useClickAwayEscape(validationPopoverRef, editingValidation !== null, closeValidationPopover);
  useClickAwayEscape(transformHelpRef, showTransformHelp, closeTransformHelp);
  useClickAwayEscape(tagEditingRef, editingTagsTemplateId !== null, closeTagEditing);

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

  // Load templates on mount (tags are derived from templates)
  useEffect(() => {
    loadTemplates();
  }, []);

  // Sync editingTags with current template data to prevent stale state
  useEffect(() => {
    if (editingTagsTemplateId) {
      const currentTemplate = templates.find((t) => t.id === editingTagsTemplateId);
      if (currentTemplate) {
        // Use null coalescing for legacy templates that might not have tags
        setEditingTags(currentTemplate.tags ?? []);
      } else {
        // Template was deleted, close the editor
        setEditingTagsTemplateId(null);
      }
    }
  }, [templates, editingTagsTemplateId]);

  // Focus trap for tag editing popover
  useEffect(() => {
    if (!editingTagsTemplateId || !tagEditingRef.current) return;

    // Auto-focus the first focusable element (TagInput's input)
    const focusTimer = setTimeout(() => {
      const firstFocusable = tagEditingRef.current?.querySelector<HTMLElement>(
        'input:not([disabled]), button:not([disabled])'
      );
      firstFocusable?.focus();
    }, 0);

    // Tab trap handler
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !tagEditingRef.current) return;

      const focusableElements = tagEditingRef.current.querySelectorAll<HTMLElement>(
        'input:not([disabled]), button:not([disabled])'
      );
      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (e.shiftKey && document.activeElement === firstElement) {
        e.preventDefault();
        lastElement?.focus();
      } else if (!e.shiftKey && document.activeElement === lastElement) {
        e.preventDefault();
        firstElement?.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      clearTimeout(focusTimer);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [editingTagsTemplateId]);

  const loadTemplates = async () => {
    setTemplatesLoading(true);
    try {
      const templates = await invoke<Template[]>("cmd_list_templates");
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

      await invoke("cmd_create_template", {
        name: newTemplateName.trim(),
        description: newTemplateDescription.trim() || null,
        schemaXml: schemaContent,
        variables: variablesMap,
        variableValidation: validationMap,
        iconColor: null,
        tags: newTemplateTags,
      });
      setIsSavingTemplate(false);
      setNewTemplateName("");
      setNewTemplateDescription("");
      setNewTemplateTags([]);
      loadTemplates();
      // Tags will be derived from templates, no need for separate loadAllTags()
    } catch (e) {
      console.error("Failed to save template:", e);
    }
  };

  const handleUpdateTemplateTags = async (templateId: string, tags: string[]) => {
    setIsUpdatingTags(true);
    setTagOperationError(null);
    // Clear any existing error timeout
    if (errorTimeoutRef.current) {
      clearTimeout(errorTimeoutRef.current);
    }
    try {
      await invoke("cmd_update_template_tags", { id: templateId, tags });
      loadTemplates();
      // Tags will be derived from templates, no need for separate loadAllTags()
    } catch (e) {
      // Show user-friendly message, log technical details for debugging
      setTagOperationError("Failed to update tags. Please try again.");
      // Auto-clear error after 3 seconds (tracked for cleanup)
      errorTimeoutRef.current = setTimeout(() => setTagOperationError(null), TAG_ERROR_DISPLAY_MS);
      console.error("Failed to update template tags:", e);
    } finally {
      setIsUpdatingTags(false);
    }
  };

  const handleLoadTemplate = async (template: Template) => {
    try {
      // Increment use count
      await invoke("cmd_use_template", { id: template.id });

      // Load the schema
      setSchemaPath(`template:${template.name}`);
      setSchemaContent(template.schema_xml);

      // Use inheritance-aware parsing to resolve any base templates
      const result = await invoke<ParseWithInheritanceResult>(
        "cmd_parse_schema_with_inheritance",
        { content: template.schema_xml }
      );
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
      await invoke("cmd_toggle_favorite", { id: templateId });
      loadTemplates();
    } catch (e) {
      console.error("Failed to toggle favorite:", e);
    }
  };

  const handleDeleteTemplate = async (e: React.MouseEvent, templateId: string) => {
    e.stopPropagation();
    try {
      await invoke("cmd_delete_template", { id: templateId });
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
      const selected = await open({
        multiple: false,
        filters: [
          { name: "Schema Files", extensions: ["xml", "zip"] },
          { name: "XML", extensions: ["xml"] },
          { name: "ZIP", extensions: ["zip"] },
        ],
      });

      if (selected) {
        const path = selected as string;
        setSchemaPath(path);

        const isZip = path.toLowerCase().endsWith(".zip");

        if (isZip) {
          // Handle ZIP file - read as binary and scan
          const data = await readFile(path);
          const filename = path.split("/").pop() || path.split("\\").pop() || "archive.zip";
          setSchemaContent(null); // ZIP doesn't have text content

          try {
            const tree = await invoke<SchemaTree>("cmd_scan_zip", {
              data: Array.from(data),
              filename,
            });
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
          const content = await readTextFile(path);
          setSchemaContent(content);

          try {
            // Use inheritance-aware parsing to resolve any extends attributes
            const result = await invoke<ParseWithInheritanceResult>(
              "cmd_parse_schema_with_inheritance",
              { content }
            );
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
      const selected = await open({
        directory: true,
        multiple: false,
      });

      if (selected) {
        const path = selected as string;
        setSchemaPath(path);
        setSchemaContent(null);

        try {
          const tree = await invoke<SchemaTree>("cmd_scan_folder", { folderPath: path });
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
      const xml = await invoke<string>("cmd_export_schema_xml", { tree: schemaTree });

      const savePath = await save({
        filters: [{ name: "XML", extensions: ["xml"] }],
        defaultPath: `${schemaTree.root.name}-schema.xml`,
      });

      if (savePath) {
        await writeTextFile(savePath, xml);
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
      const selected = await open({
        directory: true,
        multiple: false,
      });

      if (selected) {
        setOutputPath(selected as string);
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

  // Compute filtered and sorted templates (using deferred query for smooth typing)
  const filteredTemplates = useMemo(
    () =>
      getFilteredTemplates(
        templates,
        deferredSearchQuery,
        templateSelectedTags,
        templateSortBy,
        templateSortOrder
      ),
    [templates, deferredSearchQuery, templateSelectedTags, templateSortBy, templateSortOrder]
  );

  // Derive unique tags from templates (avoids separate API call)
  const availableTags = useMemo(() => {
    const tagSet = new Set<string>();
    templates.forEach((t) => (t.tags ?? []).forEach((tag) => tagSet.add(tag)));
    return Array.from(tagSet).sort();
  }, [templates]);

  // Check if search results are stale (for visual feedback)
  const isSearchStale = templateSearchQuery !== deferredSearchQuery;

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
            <div className="mb-2">
              <div className="text-mac-xs text-text-muted mb-1">Tags</div>
              <TagInput
                tags={newTemplateTags}
                onChange={setNewTemplateTags}
                suggestions={availableTags}
                placeholder="Add tags (e.g., react, typescript)..."
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  setIsSavingTemplate(false);
                  setNewTemplateName("");
                  setNewTemplateDescription("");
                  setNewTemplateTags([]);
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

        {/* Search Input */}
        {templates.length > 0 && (
          <div className="relative mb-2">
            <input
              type="text"
              value={templateSearchQuery}
              onChange={(e) => setTemplateSearchQuery(e.target.value)}
              placeholder="Search templates..."
              className={`w-full mac-input pl-8 text-mac-sm ${isSearchStale ? "opacity-70" : ""}`}
              aria-label="Search templates"
              aria-busy={isSearchStale}
            />
            <SearchIcon
              size={14}
              className={`absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none transition-colors ${
                isSearchStale ? "text-accent animate-pulse" : "text-text-muted"
              }`}
              aria-hidden="true"
            />
            {templateSearchQuery && (
              <button
                onClick={() => setTemplateSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
                aria-label="Clear search"
              >
                <XIcon size={12} />
              </button>
            )}
          </div>
        )}

        {/* Tag Filter Chips */}
        {availableTags.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2" role="group" aria-label="Filter by tags">
            {(showAllFilterTags ? availableTags : availableTags.slice(0, MAX_VISIBLE_FILTER_TAGS)).map((tag) => (
              <button
                key={tag}
                onClick={() => toggleTemplateTag(tag)}
                aria-pressed={templateSelectedTags.includes(tag)}
                className={`px-2 py-0.5 text-mac-xs rounded-full transition-colors ${
                  templateSelectedTags.includes(tag)
                    ? "bg-accent text-white"
                    : "bg-mac-bg-hover text-text-secondary hover:text-text-primary"
                }`}
              >
                {tag}
              </button>
            ))}
            {availableTags.length > MAX_VISIBLE_FILTER_TAGS && (
              <button
                onClick={() => setShowAllFilterTags(!showAllFilterTags)}
                aria-expanded={showAllFilterTags}
                className="px-2 py-0.5 text-mac-xs text-accent hover:text-accent/80"
              >
                {showAllFilterTags ? "Show less" : `+${availableTags.length - MAX_VISIBLE_FILTER_TAGS} more`}
              </button>
            )}
            {templateSelectedTags.length > 0 && (
              <button
                onClick={() => setTemplateSelectedTags([])}
                className="px-2 py-0.5 text-mac-xs text-text-muted hover:text-text-primary"
                aria-label="Clear all tag filters"
              >
                Clear
              </button>
            )}
          </div>
        )}

        {/* Tag operation error feedback */}
        {tagOperationError && (
          <div
            className="mb-2 px-2 py-1 text-mac-xs text-system-red bg-system-red/10 rounded"
            role="alert"
            aria-live="polite"
          >
            {tagOperationError}
          </div>
        )}

        {/* Sort Controls */}
        {templates.length > 0 && (
          <div className="flex items-center gap-2 mb-2">
            <label htmlFor="template-sort" className="text-mac-xs text-text-muted">Sort:</label>
            <select
              id="template-sort"
              value={templateSortBy}
              onChange={(e) => setTemplateSortBy(e.target.value as TemplateSortField)}
              className="mac-input text-mac-xs py-1 px-2 flex-1"
            >
              <option value="updated_at">Last Updated</option>
              <option value="use_count">Most Used</option>
              <option value="name">Name</option>
              <option value="created_at">Created</option>
            </select>
            <button
              onClick={() => setTemplateSortOrder(templateSortOrder === "asc" ? "desc" : "asc")}
              className="w-7 h-7 flex items-center justify-center rounded text-text-muted hover:text-text-primary hover:bg-mac-bg-hover transition-colors"
              title={templateSortOrder === "asc" ? "Ascending (click for descending)" : "Descending (click for ascending)"}
              aria-label={`Sort ${templateSortOrder === "asc" ? "ascending" : "descending"}, click to toggle`}
            >
              <ArrowUpIcon
                size={14}
                className={`transition-transform ${templateSortOrder === "asc" ? "" : "rotate-180"}`}
              />
            </button>
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
          ) : filteredTemplates.length === 0 ? (
            <div className="text-center text-text-muted text-mac-sm py-4">
              <SearchIcon size={24} className="mx-auto mb-2 opacity-30" />
              <div>No matching templates</div>
              <div className="text-mac-xs mt-1">Try a different search or filter</div>
            </div>
          ) : (
            filteredTemplates.map((template) => {
              const templateTags = template.tags ?? [];
              return (
              <div
                key={template.id}
                className="bg-card-bg border border-border-muted rounded-mac cursor-pointer group"
              >
                {/* Tag editing popover */}
                {editingTagsTemplateId === template.id && (
                  <div ref={tagEditingRef} className="p-3 border-b border-border-muted">
                    <div className="text-mac-xs text-text-muted mb-1">Edit tags</div>
                    <TagInput
                      tags={editingTags}
                      onChange={setEditingTags}
                      suggestions={availableTags}
                      placeholder="Add tags..."
                      disabled={isUpdatingTags}
                    />
                    <div className="flex justify-end gap-2 mt-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingTagsTemplateId(null);
                        }}
                        disabled={isUpdatingTags}
                        className="px-2 py-1 text-mac-xs text-text-secondary hover:text-text-primary disabled:opacity-50"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleUpdateTemplateTags(template.id, editingTags);
                          setEditingTagsTemplateId(null);
                        }}
                        disabled={isUpdatingTags}
                        className="px-2 py-1 text-mac-xs font-medium text-accent hover:bg-accent/10 rounded disabled:opacity-50"
                      >
                        {isUpdatingTags ? "Saving..." : "Save"}
                      </button>
                    </div>
                  </div>
                )}
                <div
                  onClick={() => handleLoadTemplate(template)}
                  className="mac-sidebar-item p-3"
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
                    {/* Tags display */}
                    {templateTags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {templateTags.slice(0, MAX_VISIBLE_TEMPLATE_TAGS).map((tag) => (
                          <span
                            key={tag}
                            className="px-1.5 py-0.5 text-mac-xs bg-mac-bg-hover text-text-muted rounded"
                          >
                            {tag}
                          </span>
                        ))}
                        {templateTags.length > MAX_VISIBLE_TEMPLATE_TAGS && (
                          <span className="text-mac-xs text-text-muted">
                            +{templateTags.length - MAX_VISIBLE_TEMPLATE_TAGS}
                          </span>
                        )}
                      </div>
                    )}
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
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingTags(templateTags);
                        setEditingTagsTemplateId(template.id);
                      }}
                      className="w-6 h-6 flex items-center justify-center rounded text-text-muted hover:text-accent hover:bg-accent/10 transition-colors"
                      title="Edit tags"
                      aria-label={`Edit tags for ${template.name}`}
                    >
                      <TagIcon size={14} />
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
              </div>
              );
            })
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
