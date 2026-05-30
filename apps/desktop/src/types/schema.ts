/**
 * Re-export shared types from @structure-creator/shared
 * Desktop-specific types are defined below
 */

// Re-export all shared types
export {
  NODE_TYPES,
  TRANSFORMATIONS,
  DATE_FORMATS,
  DEFAULT_SETTINGS,
  ACCENT_COLORS,
} from '@structure-creator/shared';

export type {
  NodeType,
  SchemaNode,
  SchemaHooks,
  SchemaStats,
  SchemaTree,
  VariableDefinition,
  ValidationRule,
  Variable,
  ValidationError,
  // IPC result + diff types (generated from Rust via specta, ADR-0003)
  BackendLogEntry,
  ResultSummary,
  HookResult,
  ItemType,
  CreatedItem,
  CreateResult,
  UndoSummary,
  UndoResult,
  DiffAction,
  DiffLineType,
  DiffLine,
  DiffHunk,
  DiffNodeType,
  DiffNode,
  DiffSummary,
  DiffResult,
  WizardQuestionType,
  WizardChoice,
  WizardShowWhen,
  WizardQuestion,
  WizardStep,
  WizardSchemaModifier,
  WizardConfig,
  WizardAnswers,
  Template,
  TemplateExport,
  TemplateExportFile,
  ImportResult,
  DuplicateStrategy,
  TemplateSortOption,
  RecentProject,
  ThemeMode,
  AccentColor,
  Settings,
  ParseWithInheritanceResult,
  ValidationSeverity,
  ValidationIssueType,
  ValidationIssue,
  SchemaValidationResult,
  // Team Library types
  TeamLibrary,
  TeamTemplate,
  SyncLogEntry,
  TeamImportResult,
  // Plugin types
  PluginCapability,
  Plugin,
  PluginManifest,
} from '@structure-creator/shared';

// Import types needed for desktop-specific types
import type { Template, SchemaTree, WizardAnswers, Variable, ValidationError, ValidationRule, Settings, TemplateSortOption, RecentProject, SchemaNode, TeamLibrary, TeamTemplate, Plugin, VariableDefinition, DiffResult, CreatedItem } from '@structure-creator/shared';

// ============================================================================
// Desktop-specific Types
// ============================================================================

/** Editor mode for the middle panel */
export type EditorMode = "preview" | "visual" | "xml";

/** State for an active wizard session */
export interface WizardState {
  isOpen: boolean;
  template: Template | null;
  currentStep: number;
  answers: WizardAnswers;
  previewTree: SchemaTree | null;
}

/**
 * Frontend UI log entry. Separate from the backend log entry (see
 * `BackendLogEntry` re-exported from `@structure-creator/shared`); this is
 * the one rendered in the panel with its own id, timestamp, and UI severity.
 */
export interface LogEntry {
  id: string;
  type: "success" | "pending" | "error" | "info" | "warning";
  message: string;
  details?: string;
  timestamp: number;
}

export interface CreationProgress {
  current: number;
  total: number;
  status: "idle" | "running" | "completed" | "error";
  logs: LogEntry[];
}

// ============================================================================
// Update Types
// ============================================================================

/** Update check status */
export type UpdateStatus = "idle" | "checking" | "available" | "downloading" | "ready" | "error" | "up-to-date";

/** Information about an available update */
export interface UpdateInfo {
  version: string;
  currentVersion: string;
  body?: string;
  date?: string;
}

/** Download progress */
export interface UpdateProgress {
  downloaded: number;
  total: number;
}

/** Update state */
export interface UpdateState {
  status: UpdateStatus;
  info: UpdateInfo | null;
  progress: UpdateProgress | null;
  error: string | null;
}

export interface AppState {
  // Schema
  schemaPath: string | null;
  schemaContent: string | null;
  schemaTree: SchemaTree | null;

  // Schema editing
  isEditMode: boolean;
  editorMode: EditorMode;
  schemaDirty: boolean;
  schemaHistory: SchemaTree[];
  schemaHistoryIndex: number;

  // XML Editor state
  xmlEditorContent: string | null;
  xmlParseError: string | null;

  // Output settings
  outputPath: string | null;
  projectName: string;

  // Watch mode
  watchEnabled: boolean;
  watchAutoCreate: boolean;
  isWatching: boolean;

  // Variables
  variables: Variable[];
  validationErrors: ValidationError[];

  // Templates
  templates: Template[];
  templatesLoading: boolean;

  // Recent Projects
  recentProjects: RecentProject[];
  recentProjectsLoading: boolean;

  // Team Libraries
  teamLibraries: TeamLibrary[];
  teamLibrariesLoading: boolean;
  activeTeamLibrary: string | null;
  teamTemplates: TeamTemplate[];
  teamTemplatesLoading: boolean;

  // Plugins
  plugins: Plugin[];
  pluginsLoading: boolean;

  // Template filtering
  templateSearchQuery: string;
  templateFilterTags: string[];
  templateSortOption: TemplateSortOption;
  allTags: string[];

  // Settings
  settings: Settings;
  settingsLoading: boolean;

  // Progress
  progress: CreationProgress;

  // Options
  dryRun: boolean;
  overwrite: boolean;

  // Diff Preview
  diffResult: DiffResult | null;
  diffLoading: boolean;
  diffError: string | null;
  showDiffModal: boolean;

  // Wizard
  wizardState: WizardState | null;

  // Update
  updateState: UpdateState;

  // Undo
  lastCreation: CreatedItem[] | null;

  // Actions
  setSchemaPath: (path: string | null) => void;
  setSchemaContent: (content: string | null) => void;
  setSchemaTree: (tree: SchemaTree | null) => void;
  setOutputPath: (path: string | null) => void;
  setProjectName: (name: string) => void;
  setVariables: (variables: Variable[]) => void;
  updateVariable: (name: string, value: string) => void;
  addVariable: (name: string, value: string) => void;
  removeVariable: (name: string) => void;
  mergeDetectedVariables: (detectedVarNames: string[], definitions?: VariableDefinition[]) => void;
  updateVariableValidation: (
    name: string,
    validation: ValidationRule | undefined
  ) => void;
  setValidationErrors: (errors: ValidationError[]) => void;
  setTemplates: (templates: Template[]) => void;
  setTemplatesLoading: (loading: boolean) => void;
  setRecentProjects: (projects: RecentProject[]) => void;
  setRecentProjectsLoading: (loading: boolean) => void;

  // Team Library actions
  setTeamLibraries: (libraries: TeamLibrary[]) => void;
  setTeamLibrariesLoading: (loading: boolean) => void;
  setActiveTeamLibrary: (id: string | null) => void;
  setTeamTemplates: (templates: TeamTemplate[]) => void;
  setTeamTemplatesLoading: (loading: boolean) => void;

  // Plugin actions
  setPlugins: (plugins: Plugin[]) => void;
  setPluginsLoading: (loading: boolean) => void;
  getEnabledPlugins: () => Plugin[];

  // Template filtering actions
  setTemplateSearchQuery: (query: string) => void;
  setTemplateFilterTags: (tags: string[]) => void;
  addTemplateFilterTag: (tag: string) => void;
  removeTemplateFilterTag: (tag: string) => void;
  clearTemplateFilters: () => void;
  setTemplateSortOption: (option: TemplateSortOption) => void;
  setAllTags: (tags: string[]) => void;
  getFilteredTemplates: () => Template[];
  setSettings: (settings: Settings) => void;
  setSettingsLoading: (loading: boolean) => void;
  updateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  setProgress: (progress: Partial<CreationProgress>) => void;
  addLog: (log: Omit<LogEntry, "id" | "timestamp">) => void;
  clearLogs: () => void;
  setDryRun: (dryRun: boolean) => void;
  setOverwrite: (overwrite: boolean) => void;
  setDiffResult: (result: DiffResult | null) => void;
  setDiffLoading: (loading: boolean) => void;
  setDiffError: (error: string | null) => void;
  setShowDiffModal: (show: boolean) => void;
  reset: () => void;

  // Watch mode actions
  setWatchEnabled: (enabled: boolean) => void;
  setWatchAutoCreate: (autoCreate: boolean) => void;
  setIsWatching: (watching: boolean) => void;

  // Schema editing actions
  setEditMode: (enabled: boolean) => void;
  setEditorMode: (mode: EditorMode) => Promise<boolean>;
  setXmlEditorContent: (content: string) => void;
  setXmlParseError: (error: string | null) => void;
  syncXmlToTree: () => Promise<boolean>;
  syncTreeToXml: () => Promise<void>;
  createNewSchema: () => void;
  updateSchemaNode: (nodeId: string, updates: Partial<SchemaNode>) => void;
  addSchemaNode: (parentId: string | null, node: Partial<SchemaNode>) => void;
  removeSchemaNode: (nodeId: string) => void;
  moveSchemaNode: (nodeId: string, targetParentId: string | null, index: number) => void;
  moveIfElseGroup: (ifNodeId: string, targetParentId: string | null, index: number) => void;
  getIfElseGroupIds: (ifNodeId: string) => string[];
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  // Wizard actions
  openWizard: (template: Template) => void;
  closeWizard: () => void;
  setWizardStep: (step: number) => void;
  updateWizardAnswer: (questionId: string, value: string | boolean | string[]) => void;
  setWizardPreviewTree: (tree: SchemaTree | null) => void;

  // Undo actions
  setLastCreation: (items: CreatedItem[] | null) => void;
  canUndoCreation: () => boolean;

  // Update actions
  setUpdateStatus: (status: UpdateStatus) => void;
  setUpdateInfo: (info: UpdateInfo | null) => void;
  setUpdateProgress: (progress: UpdateProgress | null) => void;
  setUpdateError: (error: string | null) => void;
  resetUpdateState: () => void;
}
