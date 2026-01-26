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
  SchemaTree,
  ValidationRule,
  Variable,
  ValidationError,
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
} from '@structure-creator/shared';

// Import types needed for desktop-specific types
import type { Template, SchemaTree, WizardAnswers, Variable, ValidationError, ValidationRule, Settings, TemplateSortOption, RecentProject, SchemaNode } from '@structure-creator/shared';

// ============================================================================
// Desktop-specific Types
// ============================================================================

/** State for an active wizard session */
export interface WizardState {
  isOpen: boolean;
  template: Template | null;
  currentStep: number;
  answers: WizardAnswers;
  previewTree: SchemaTree | null;
}

export interface LogEntry {
  id: string;
  type: "success" | "pending" | "error" | "info" | "warning";
  message: string;
  details?: string;
  timestamp: number;
}

export interface BackendLogEntry {
  log_type: string;
  message: string;
  details?: string;
}

export interface ResultSummary {
  folders_created: number;
  files_created: number;
  files_downloaded: number;
  errors: number;
  skipped: number;
  hooks_executed: number;
  hooks_failed: number;
}

export interface HookResult {
  command: string;
  success: boolean;
  exit_code: number | null;
  stdout: string | null;
  stderr: string | null;
}

export interface CreateResult {
  logs: BackendLogEntry[];
  summary: ResultSummary;
  hook_results: HookResult[];
}

// ============================================================================
// Diff Preview Types
// ============================================================================

/** Action that would be taken for a filesystem entry */
export type DiffAction = "create" | "overwrite" | "skip" | "unchanged";

/** Type of node in the diff tree */
export type DiffNodeType = "folder" | "file";

/** Type of diff line */
export type DiffLineType = "add" | "remove" | "context" | "truncated";

/** A single line in a diff hunk */
export interface DiffLine {
  /** Type of this diff line */
  line_type: DiffLineType;
  /** The line content */
  content: string;
}

/** A diff hunk representing a contiguous block of changes */
export interface DiffHunk {
  /** Line number in old file (1-indexed) */
  old_start: number;
  /** Number of lines from old file in this hunk */
  old_count: number;
  /** Line number in new file (1-indexed) */
  new_start: number;
  /** Number of lines from new file in this hunk */
  new_count: number;
  /** The diff lines */
  lines: DiffLine[];
}

/** Represents a file or folder in the diff preview tree */
export interface DiffNode {
  /** Unique identifier for frontend tree navigation */
  id: string;
  /** Type of this node (folder or file) */
  node_type: DiffNodeType;
  /** Display name (with variables substituted) */
  name: string;
  /** Full path relative to output directory */
  path: string;
  /** Action to be taken */
  action: DiffAction;
  /** For files: existing content (if overwriting) */
  existing_content?: string;
  /** For files: new content to be written */
  new_content?: string;
  /** For files: computed diff hunks (for text files only) */
  diff_hunks?: DiffHunk[];
  /** For files with URLs: the source URL */
  url?: string;
  /** Whether this is a binary file (no text diff available) */
  is_binary: boolean;
  /** Child nodes (for folders) */
  children?: DiffNode[];
}

/** Summary statistics for the diff preview */
export interface DiffSummary {
  total_items: number;
  creates: number;
  overwrites: number;
  skips: number;
  unchanged_folders: number;
  /** Warnings generated during diff preview (e.g., invalid repeat counts) */
  warnings?: string[];
}

/** Complete diff preview result */
export interface DiffResult {
  root: DiffNode;
  summary: DiffSummary;
}

export interface CreationProgress {
  current: number;
  total: number;
  status: "idle" | "running" | "completed" | "error";
  logs: LogEntry[];
}

export interface AppState {
  // Schema
  schemaPath: string | null;
  schemaContent: string | null;
  schemaTree: SchemaTree | null;

  // Schema editing
  isEditMode: boolean;
  schemaDirty: boolean;
  schemaHistory: SchemaTree[];
  schemaHistoryIndex: number;

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
  updateVariableValidation: (
    name: string,
    validation: ValidationRule | undefined
  ) => void;
  setValidationErrors: (errors: ValidationError[]) => void;
  setTemplates: (templates: Template[]) => void;
  setTemplatesLoading: (loading: boolean) => void;
  setRecentProjects: (projects: RecentProject[]) => void;
  setRecentProjectsLoading: (loading: boolean) => void;

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
}
