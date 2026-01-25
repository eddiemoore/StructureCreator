import { useCallback, useMemo, useState } from "react";
import { useAppStore } from "../store/appStore";
import { api } from "../lib/api";
import {
  XIcon,
  LayersIcon,
  PlusIcon,
  FolderIcon,
  CheckIcon,
  ChevronRightIcon,
} from "./Icons";
import type { Template, SchemaNode } from "../types/schema";

// Step indicator component
const StepIndicator = ({
  step,
  currentStep,
  label,
}: {
  step: number;
  currentStep: number;
  label: string;
}) => {
  const isCompleted = currentStep > step;
  const isCurrent = currentStep === step;

  return (
    <div className="flex items-center gap-2">
      <div
        className={`w-7 h-7 rounded-full flex items-center justify-center text-mac-sm font-medium transition-colors ${
          isCompleted
            ? "bg-system-green text-white"
            : isCurrent
            ? "bg-accent text-white"
            : "bg-border-muted text-text-muted"
        }`}
      >
        {isCompleted ? <CheckIcon size={14} /> : step}
      </div>
      <span
        className={`text-mac-sm ${
          isCurrent ? "text-text-primary font-medium" : "text-text-muted"
        }`}
      >
        {label}
      </span>
    </div>
  );
};

// Recursive tree node component for preview
const TreeNode = ({
  node,
  depth = 0,
}: {
  node: SchemaNode;
  depth?: number;
}) => {
  const [isExpanded, setIsExpanded] = useState(depth < 2);
  const hasChildren = node.children && node.children.length > 0;

  const getNodeIcon = () => {
    switch (node.type) {
      case "folder":
        return <FolderIcon size={14} className="text-system-blue" />;
      case "file":
        return (
          <svg
            width={14}
            height={14}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-text-muted"
          >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
        );
      case "if":
      case "else":
        return (
          <svg
            width={14}
            height={14}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-system-orange"
          >
            <path d="M16 3h5v5" />
            <path d="M8 3H3v5" />
            <path d="M12 22v-8.3a4 4 0 0 0-1.172-2.872L3 3" />
            <path d="m15 9 6-6" />
          </svg>
        );
      case "repeat":
        return (
          <svg
            width={14}
            height={14}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-system-purple"
          >
            <path d="m17 2 4 4-4 4" />
            <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
            <path d="m7 22-4-4 4-4" />
            <path d="M21 13v1a4 4 0 0 1-4 4H3" />
          </svg>
        );
      default:
        return null;
    }
  };

  return (
    <div>
      <div
        className="flex items-center gap-1.5 py-1 px-2 rounded hover:bg-mac-bg-hover cursor-pointer"
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => hasChildren && setIsExpanded(!isExpanded)}
      >
        {hasChildren ? (
          <ChevronRightIcon
            size={12}
            className={`text-text-muted transition-transform ${
              isExpanded ? "rotate-90" : ""
            }`}
          />
        ) : (
          <span className="w-3" />
        )}
        {getNodeIcon()}
        <span className="text-mac-sm text-text-primary truncate">
          {node.name}
        </span>
        {node.type === "repeat" && node.repeat_count && (
          <span className="text-mac-xs text-system-purple">
            x{node.repeat_count}
          </span>
        )}
        {node.type === "if" && node.condition_var && (
          <span className="text-mac-xs text-system-orange">
            ?{node.condition_var}
          </span>
        )}
      </div>
      {hasChildren && isExpanded && (
        <div>
          {node.children!.map((child, index) => (
            <TreeNode key={child.id || index} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
};

export const TemplateWizard = () => {
  const {
    wizard,
    templates,
    closeWizard,
    setWizardStep,
    setWizardSelectedTemplate,
    setWizardSchemaTree,
    setWizardSchemaContent,
    setWizardVariables,
    updateWizardVariable,
    setWizardOutputPath,
    setWizardProjectName,
    setWizardIsCreating,
    setWizardCreationResult,
    addLog,
  } = useAppStore();

  const [localSearchQuery, setLocalSearchQuery] = useState("");

  // Filter templates based on search
  const filteredTemplates = useMemo(() => {
    if (!localSearchQuery.trim()) return templates;
    const query = localSearchQuery.toLowerCase();
    return templates.filter(
      (t) =>
        t.name.toLowerCase().includes(query) ||
        (t.description && t.description.toLowerCase().includes(query)) ||
        t.tags.some((tag) => tag.includes(query))
    );
  }, [templates, localSearchQuery]);

  // Handle escape key
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape" && !wizard.isCreating) {
        closeWizard();
      }
    },
    [closeWizard, wizard.isCreating]
  );

  // Set up escape key listener
  const handleBackdropClick = useCallback(() => {
    if (!wizard.isCreating) {
      closeWizard();
    }
  }, [closeWizard, wizard.isCreating]);

  // Handle template selection (Step 1)
  const handleSelectTemplate = async (template: Template | null) => {
    if (template) {
      setWizardSelectedTemplate(template.id);
      setWizardSchemaContent(template.schema_xml);

      try {
        const result = await api.schema.parseSchemaWithInheritance(
          template.schema_xml
        );
        setWizardSchemaTree(result.tree);

        // Merge variables from template
        const mergedVariables = {
          ...result.mergedVariables,
          ...template.variables,
        };
        const mergedValidation = {
          ...result.mergedVariableValidation,
          ...template.variable_validation,
        };

        if (Object.keys(mergedVariables).length > 0) {
          const loadedVariables = Object.entries(mergedVariables).map(
            ([name, value]) => ({
              name,
              value,
              validation: mergedValidation[name],
            })
          );
          setWizardVariables(loadedVariables);
        } else {
          setWizardVariables([
            { name: "%DATE%", value: new Date().toISOString().split("T")[0] },
          ]);
        }

        // Move to step 2
        setWizardStep(2);
      } catch (e) {
        const errorMessage = e instanceof Error ? e.message : String(e);
        addLog({
          type: "error",
          message: "Failed to parse template",
          details: errorMessage,
        });
      }
    } else {
      // Start with blank template
      setWizardSelectedTemplate(null);
      const blankSchema = `<?xml version="1.0" encoding="UTF-8"?>
<folder name="%PROJECT_NAME%">
  <file name="README.md">
# %PROJECT_NAME%

A new project created with Structure Creator.
  </file>
</folder>`;
      setWizardSchemaContent(blankSchema);

      try {
        const tree = await api.schema.parseSchema(blankSchema);
        setWizardSchemaTree(tree);
        setWizardVariables([
          { name: "%PROJECT_NAME%", value: wizard.wizardProjectName },
          { name: "%DATE%", value: new Date().toISOString().split("T")[0] },
        ]);
        setWizardStep(2);
      } catch (e) {
        const errorMessage = e instanceof Error ? e.message : String(e);
        addLog({
          type: "error",
          message: "Failed to create blank template",
          details: errorMessage,
        });
      }
    }
  };

  // Handle output folder selection
  const handleSelectOutput = async () => {
    try {
      const selected = await api.fileSystem.openDirectoryPicker();
      if (selected) {
        setWizardOutputPath(selected);
      }
    } catch (e) {
      console.error("Failed to select output folder:", e);
    }
  };

  // Handle structure creation (Step 5)
  const handleCreateStructure = async () => {
    if (
      !wizard.wizardSchemaTree ||
      !wizard.wizardOutputPath ||
      !wizard.wizardProjectName
    ) {
      return;
    }

    setWizardIsCreating(true);
    setWizardCreationResult(null);

    try {
      // Build variables map
      const variablesMap: Record<string, string> = {};
      for (const v of wizard.wizardVariables) {
        variablesMap[v.name] = v.value;
      }

      const result = await api.structureCreator.createStructureFromTree(
        wizard.wizardSchemaTree,
        {
          outputPath: `${wizard.wizardOutputPath}/${wizard.wizardProjectName}`,
          variables: variablesMap,
          dryRun: false,
          overwrite: false,
        }
      );

      setWizardCreationResult(result.summary);

      // Add success log
      addLog({
        type: "success",
        message: "Structure created successfully",
        details: `Created ${result.summary.folders_created} folders and ${result.summary.files_created} files`,
      });
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      addLog({
        type: "error",
        message: "Failed to create structure",
        details: errorMessage,
      });
    } finally {
      setWizardIsCreating(false);
    }
  };

  // Navigation helpers
  const canGoNext = (): boolean => {
    switch (wizard.currentStep) {
      case 1:
        return true; // Can always proceed (either with template or blank)
      case 2:
        return wizard.wizardVariables.every(
          (v) => !v.validation?.required || v.value.trim() !== ""
        );
      case 3:
        return wizard.wizardSchemaTree !== null;
      case 4:
        return (
          wizard.wizardOutputPath !== null &&
          wizard.wizardProjectName.trim() !== ""
        );
      case 5:
        return false; // Final step
      default:
        return false;
    }
  };

  const handleNext = () => {
    if (wizard.currentStep < 5 && canGoNext()) {
      setWizardStep((wizard.currentStep + 1) as 1 | 2 | 3 | 4 | 5);
    }
  };

  const handleBack = () => {
    if (wizard.currentStep > 1) {
      setWizardStep((wizard.currentStep - 1) as 1 | 2 | 3 | 4 | 5);
    }
  };

  if (!wizard.isOpen) return null;

  const stepLabels = [
    "Choose Template",
    "Configure",
    "Preview",
    "Customize",
    "Create",
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onKeyDown={(e) => handleKeyDown(e.nativeEvent)}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={handleBackdropClick}
      />

      {/* Modal */}
      <div className="relative bg-card-bg rounded-mac-lg shadow-mac-xl w-[800px] max-h-[85vh] overflow-hidden border border-border-muted flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-muted">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-accent/10 rounded-mac flex items-center justify-center text-accent">
              <LayersIcon size={18} />
            </div>
            <div>
              <h2 className="text-mac-lg font-semibold text-text-primary">
                Template Wizard
              </h2>
              <p className="text-mac-xs text-text-muted">
                Create a new project structure step by step
              </p>
            </div>
          </div>
          <button
            onClick={closeWizard}
            disabled={wizard.isCreating}
            className="w-7 h-7 flex items-center justify-center rounded-mac text-text-muted hover:bg-mac-bg-hover transition-colors disabled:opacity-50"
          >
            <XIcon size={16} />
          </button>
        </div>

        {/* Step Indicators */}
        <div className="flex items-center justify-between px-6 py-3 bg-bg-primary border-b border-border-muted">
          {stepLabels.map((label, index) => (
            <div key={label} className="flex items-center">
              <StepIndicator
                step={index + 1}
                currentStep={wizard.currentStep}
                label={label}
              />
              {index < stepLabels.length - 1 && (
                <div className="w-12 h-px bg-border-muted mx-3" />
              )}
            </div>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 mac-scroll">
          {/* Step 1: Choose Template */}
          {wizard.currentStep === 1 && (
            <div className="space-y-4">
              <div className="text-mac-base text-text-secondary mb-4">
                Choose a template to start with, or create a blank project.
              </div>

              {/* Search */}
              <div className="relative mb-4">
                <input
                  type="text"
                  value={localSearchQuery}
                  onChange={(e) => setLocalSearchQuery(e.target.value)}
                  placeholder="Search templates..."
                  className="w-full mac-input pr-8 text-mac-sm"
                  autoFocus
                />
                {localSearchQuery && (
                  <button
                    onClick={() => setLocalSearchQuery("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center rounded-full text-text-muted hover:text-text-primary"
                  >
                    <XIcon size={10} />
                  </button>
                )}
              </div>

              {/* Blank Template Option */}
              <div
                onClick={() => handleSelectTemplate(null)}
                className="p-4 border-2 border-dashed border-accent rounded-mac-lg cursor-pointer hover:bg-accent/5 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-accent/10 rounded-mac flex items-center justify-center text-accent">
                    <PlusIcon size={20} />
                  </div>
                  <div>
                    <div className="text-mac-base font-medium text-text-primary">
                      Start Blank
                    </div>
                    <div className="text-mac-sm text-text-muted">
                      Create a new project from scratch
                    </div>
                  </div>
                </div>
              </div>

              {/* Template List */}
              <div className="grid grid-cols-2 gap-3 mt-4">
                {filteredTemplates.map((template) => (
                  <div
                    key={template.id}
                    onClick={() => handleSelectTemplate(template)}
                    className={`p-4 bg-bg-primary border rounded-mac-lg cursor-pointer transition-colors hover:border-accent ${
                      wizard.selectedTemplateId === template.id
                        ? "border-accent ring-2 ring-accent/20"
                        : "border-border-muted"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className="w-10 h-10 rounded-mac flex items-center justify-center flex-shrink-0"
                        style={{
                          backgroundColor: `${
                            template.icon_color || "#0a84ff"
                          }15`,
                          color: template.icon_color || "#0a84ff",
                        }}
                      >
                        <LayersIcon size={18} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-mac-sm font-medium text-text-primary truncate">
                          {template.name}
                        </div>
                        <div className="text-mac-xs text-text-muted truncate">
                          {template.description ||
                            `Used ${template.use_count} times`}
                        </div>
                        {template.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {template.tags.slice(0, 3).map((tag) => (
                              <span
                                key={tag}
                                className="px-1.5 py-0.5 text-[10px] bg-border-muted text-text-muted rounded-full"
                              >
                                {tag}
                              </span>
                            ))}
                            {template.tags.length > 3 && (
                              <span className="text-[10px] text-text-muted">
                                +{template.tags.length - 3}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {filteredTemplates.length === 0 && templates.length > 0 && (
                <div className="text-center py-8 text-text-muted">
                  No templates match your search
                </div>
              )}

              {templates.length === 0 && (
                <div className="text-center py-8 text-text-muted">
                  <LayersIcon size={32} className="mx-auto mb-2 opacity-30" />
                  <div>No templates saved yet</div>
                  <div className="text-mac-xs mt-1">
                    Start with a blank project or import templates first
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Step 2: Configure Variables */}
          {wizard.currentStep === 2 && (
            <div className="space-y-4">
              <div className="text-mac-base text-text-secondary mb-4">
                Configure the variables for your project. These will be
                substituted in file and folder names.
              </div>

              <div className="space-y-3">
                {wizard.wizardVariables.map((variable) => {
                  const hasValidation =
                    variable.validation &&
                    (variable.validation.required ||
                      variable.validation.minLength ||
                      variable.validation.maxLength ||
                      variable.validation.pattern);
                  const isRequired = variable.validation?.required;
                  const isEmpty = variable.value.trim() === "";

                  return (
                    <div
                      key={variable.name}
                      className={`p-4 bg-bg-primary rounded-mac-lg border ${
                        isRequired && isEmpty
                          ? "border-system-red"
                          : "border-border-muted"
                      }`}
                    >
                      <div className="flex items-center gap-3 mb-2">
                        <span className="font-mono text-mac-sm font-medium text-system-orange bg-system-orange/10 px-2 py-1 rounded">
                          {variable.name}
                        </span>
                        {isRequired && (
                          <span className="text-mac-xs text-system-red">
                            Required
                          </span>
                        )}
                        {hasValidation && !isRequired && (
                          <span className="text-mac-xs text-text-muted">
                            Has validation rules
                          </span>
                        )}
                      </div>
                      <input
                        type="text"
                        value={variable.value}
                        onChange={(e) =>
                          updateWizardVariable(variable.name, e.target.value)
                        }
                        placeholder="Enter value..."
                        className="w-full mac-input font-mono text-mac-sm"
                      />
                      {variable.validation && (
                        <div className="mt-2 text-mac-xs text-text-muted">
                          {variable.validation.minLength !== undefined && (
                            <span className="mr-3">
                              Min: {variable.validation.minLength} chars
                            </span>
                          )}
                          {variable.validation.maxLength !== undefined && (
                            <span className="mr-3">
                              Max: {variable.validation.maxLength} chars
                            </span>
                          )}
                          {variable.validation.pattern && (
                            <span>Pattern: {variable.validation.pattern}</span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}

                {wizard.wizardVariables.length === 0 && (
                  <div className="text-center py-8 text-text-muted">
                    No variables to configure
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Step 3: Preview Schema */}
          {wizard.currentStep === 3 && (
            <div className="space-y-4">
              <div className="text-mac-base text-text-secondary mb-4">
                Preview the structure that will be created. Variables are shown
                as placeholders.
              </div>

              {wizard.wizardSchemaTree ? (
                <div className="bg-bg-primary rounded-mac-lg border border-border-muted p-4 max-h-[400px] overflow-auto mac-scroll">
                  <TreeNode node={wizard.wizardSchemaTree.root} />
                </div>
              ) : (
                <div className="text-center py-8 text-text-muted">
                  No schema to preview
                </div>
              )}

              {wizard.wizardSchemaTree && (
                <div className="flex gap-4 text-mac-sm text-text-muted">
                  <span>
                    {wizard.wizardSchemaTree.stats.folders} folder
                    {wizard.wizardSchemaTree.stats.folders !== 1 ? "s" : ""}
                  </span>
                  <span>
                    {wizard.wizardSchemaTree.stats.files} file
                    {wizard.wizardSchemaTree.stats.files !== 1 ? "s" : ""}
                  </span>
                  {wizard.wizardSchemaTree.stats.downloads > 0 && (
                    <span>
                      {wizard.wizardSchemaTree.stats.downloads} download
                      {wizard.wizardSchemaTree.stats.downloads !== 1 ? "s" : ""}
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Step 4: Customize */}
          {wizard.currentStep === 4 && (
            <div className="space-y-4">
              <div className="text-mac-base text-text-secondary mb-4">
                Set the output location and project name. You can also make
                final adjustments.
              </div>

              {/* Output Settings */}
              <div className="space-y-4">
                <div>
                  <label className="block text-mac-sm font-medium text-text-secondary mb-2">
                    Output Folder
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={wizard.wizardOutputPath || ""}
                      readOnly
                      placeholder="Select output folder..."
                      className="mac-input flex-1 font-mono text-mac-sm"
                    />
                    <button
                      onClick={handleSelectOutput}
                      className="mac-button-secondary px-4"
                    >
                      <FolderIcon size={16} className="mr-2" />
                      Browse
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-mac-sm font-medium text-text-secondary mb-2">
                    Project Name
                  </label>
                  <input
                    type="text"
                    value={wizard.wizardProjectName}
                    onChange={(e) => setWizardProjectName(e.target.value)}
                    placeholder="my-project"
                    className="w-full mac-input font-mono text-mac-sm"
                  />
                  <p className="mt-1 text-mac-xs text-text-muted">
                    This creates a folder with this name inside the output
                    folder
                  </p>
                </div>
              </div>

              {/* Preview of final path */}
              {wizard.wizardOutputPath && wizard.wizardProjectName && (
                <div className="p-4 bg-bg-primary rounded-mac-lg border border-border-muted">
                  <div className="text-mac-xs text-text-muted mb-1">
                    Final path:
                  </div>
                  <div className="font-mono text-mac-sm text-text-primary">
                    {wizard.wizardOutputPath}/{wizard.wizardProjectName}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Step 5: Create */}
          {wizard.currentStep === 5 && (
            <div className="space-y-4">
              {!wizard.creationResult ? (
                <>
                  <div className="text-mac-base text-text-secondary mb-4">
                    Ready to create your project structure. Review the summary
                    below and click Create to proceed.
                  </div>

                  {/* Summary */}
                  <div className="bg-bg-primary rounded-mac-lg border border-border-muted p-4 space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-mac-sm text-text-muted">
                        Template:
                      </span>
                      <span className="text-mac-sm text-text-primary font-medium">
                        {wizard.selectedTemplateId
                          ? templates.find(
                              (t) => t.id === wizard.selectedTemplateId
                            )?.name || "Unknown"
                          : "Blank Project"}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-mac-sm text-text-muted">
                        Project Name:
                      </span>
                      <span className="text-mac-sm text-text-primary font-medium font-mono">
                        {wizard.wizardProjectName}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-mac-sm text-text-muted">
                        Output Path:
                      </span>
                      <span className="text-mac-sm text-text-primary font-medium font-mono truncate max-w-[300px]">
                        {wizard.wizardOutputPath}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-mac-sm text-text-muted">
                        Variables:
                      </span>
                      <span className="text-mac-sm text-text-primary font-medium">
                        {wizard.wizardVariables.length} configured
                      </span>
                    </div>
                    {wizard.wizardSchemaTree && (
                      <>
                        <div className="flex justify-between items-center">
                          <span className="text-mac-sm text-text-muted">
                            Folders to create:
                          </span>
                          <span className="text-mac-sm text-text-primary font-medium">
                            {wizard.wizardSchemaTree.stats.folders}
                          </span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-mac-sm text-text-muted">
                            Files to create:
                          </span>
                          <span className="text-mac-sm text-text-primary font-medium">
                            {wizard.wizardSchemaTree.stats.files}
                          </span>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Create Button */}
                  <button
                    onClick={handleCreateStructure}
                    disabled={
                      wizard.isCreating ||
                      !wizard.wizardOutputPath ||
                      !wizard.wizardProjectName
                    }
                    className="w-full mac-button-primary py-3 text-mac-base font-medium disabled:opacity-50"
                  >
                    {wizard.isCreating ? (
                      <span className="flex items-center justify-center gap-2">
                        <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        Creating...
                      </span>
                    ) : (
                      "Create Structure"
                    )}
                  </button>
                </>
              ) : (
                <>
                  {/* Success State */}
                  <div className="text-center py-8">
                    <div className="w-16 h-16 bg-system-green/10 rounded-full flex items-center justify-center mx-auto mb-4">
                      <CheckIcon size={32} className="text-system-green" />
                    </div>
                    <h3 className="text-mac-lg font-semibold text-text-primary mb-2">
                      Structure Created Successfully!
                    </h3>
                    <p className="text-mac-sm text-text-muted mb-6">
                      Your project has been created at:
                    </p>
                    <div className="font-mono text-mac-sm text-text-primary bg-bg-primary rounded-mac p-3 mb-6">
                      {wizard.wizardOutputPath}/{wizard.wizardProjectName}
                    </div>

                    {/* Results Summary */}
                    <div className="grid grid-cols-3 gap-4 mb-6">
                      <div className="bg-bg-primary rounded-mac-lg p-4 border border-border-muted">
                        <div className="text-mac-xl font-semibold text-system-blue">
                          {wizard.creationResult.folders_created}
                        </div>
                        <div className="text-mac-xs text-text-muted">
                          Folders Created
                        </div>
                      </div>
                      <div className="bg-bg-primary rounded-mac-lg p-4 border border-border-muted">
                        <div className="text-mac-xl font-semibold text-system-green">
                          {wizard.creationResult.files_created}
                        </div>
                        <div className="text-mac-xs text-text-muted">
                          Files Created
                        </div>
                      </div>
                      <div className="bg-bg-primary rounded-mac-lg p-4 border border-border-muted">
                        <div className="text-mac-xl font-semibold text-system-orange">
                          {wizard.creationResult.files_downloaded}
                        </div>
                        <div className="text-mac-xs text-text-muted">
                          Downloaded
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={closeWizard}
                      className="mac-button-primary px-6 py-2"
                    >
                      Done
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer with Navigation */}
        {!wizard.creationResult && (
          <div className="px-6 py-4 border-t border-border-muted flex justify-between">
            <button
              onClick={handleBack}
              disabled={wizard.currentStep === 1 || wizard.isCreating}
              className="mac-button-secondary px-4 disabled:opacity-50"
            >
              Back
            </button>
            <div className="flex gap-3">
              <button
                onClick={closeWizard}
                disabled={wizard.isCreating}
                className="mac-button-secondary px-4"
              >
                Cancel
              </button>
              {wizard.currentStep < 5 && (
                <button
                  onClick={handleNext}
                  disabled={!canGoNext()}
                  className="mac-button-primary px-4 disabled:opacity-50"
                >
                  Next
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
