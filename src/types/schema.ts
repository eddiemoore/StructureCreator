/**
 * Valid node types for schema elements.
 * - folder: Directory container
 * - file: File with optional content or URL
 * - if: Conditional block (renders children when condition_var is truthy)
 * - else: Alternative block (follows an if block)
 * - repeat: Loop block (repeats children count times)
 */
export const NODE_TYPES = ["folder", "file", "if", "else", "repeat"] as const;
export type NodeType = (typeof NODE_TYPES)[number];

/**
 * Represents a single node in the schema tree structure.
 * Nodes can be files, folders, or control flow elements (if/else/repeat).
 */
export interface SchemaNode {
  /** Unique identifier for tracking during editing and drag-drop operations */
  id?: string;
  /** The type of this schema element */
  type: NodeType;
  /** Display name (supports variable substitution with %VAR% syntax) */
  name: string;
  /** URL to download file content from (file nodes only) */
  url?: string;
  /** Inline file content (file nodes only) */
  content?: string;
  /** Child nodes (for folder, if, else, repeat types) */
  children?: SchemaNode[];
  /** Additional XML attributes to preserve during round-trips */
  attributes?: Record<string, string>;
  /** Variable name to check for conditional rendering (if nodes only, without % delimiters) */
  condition_var?: string;
  /**
   * Number of iterations for repeat loops. Can be a literal number or variable reference.
   * Examples: "3", "%NUM_MODULES%"
   * @default "1"
   */
  repeat_count?: string;
  /**
   * Iteration variable name for repeat loops (without % delimiters).
   * Available inside the loop as %name% (0-indexed) and %name_1% (1-indexed).
   * @default "i"
   */
  repeat_as?: string;
}

export interface SchemaHooks {
  post_create: string[];
}

export interface SchemaTree {
  root: SchemaNode;
  stats: {
    folders: number;
    files: number;
    downloads: number;
  };
  hooks?: SchemaHooks;
}

/**
 * Result of parsing a schema with template inheritance resolved.
 * Returned by cmd_parse_schema_with_inheritance.
 */
export interface ParseWithInheritanceResult {
  /** The fully resolved schema tree with inherited content merged */
  tree: SchemaTree;
  /** Variables merged from all base templates (child values override base) */
  mergedVariables: Record<string, string>;
  /** Validation rules merged from all base templates (child rules override base) */
  mergedVariableValidation: Record<string, ValidationRule>;
  /** List of base template names that were extended (in resolution order) */
  baseTemplates: string[];
}

export interface ValidationRule {
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  required?: boolean;
}

export interface Variable {
  name: string;
  value: string;
  validation?: ValidationRule;
}

export interface ValidationError {
  variable_name: string;
  message: string;
}

/**
 * Available variable transformations for the UI help section.
 * IMPORTANT: Keep in sync with src-tauri/src/transforms.rs parse_transform()
 * If you add a transformation in Rust, add it here too for the UI.
 */
export const TRANSFORMATIONS = [
  { id: "uppercase", label: "UPPERCASE", example: "hello → HELLO" },
  { id: "lowercase", label: "lowercase", example: "HELLO → hello" },
  { id: "camelCase", label: "camelCase", example: "hello world → helloWorld" },
  {
    id: "PascalCase",
    label: "PascalCase",
    example: "hello world → HelloWorld",
  },
  { id: "kebab-case", label: "kebab-case", example: "HelloWorld → hello-world" },
  { id: "snake_case", label: "snake_case", example: "HelloWorld → hello_world" },
  { id: "plural", label: "plural", example: "cat → cats" },
  { id: "length", label: "length", example: "hello → 5" },
] as const;

/**
 * Available date format options for the UI help section.
 * IMPORTANT: Keep in sync with src-tauri/src/transforms.rs format_date()
 *
 * Supported tokens: YYYY, YY, MMMM, MMM, MM, DD, D
 */
export const DATE_FORMATS = [
  { id: "YYYY-MM-DD", label: "ISO (2024-01-15)" },
  { id: "MM/DD/YYYY", label: "US (01/15/2024)" },
  { id: "DD/MM/YYYY", label: "EU (15/01/2024)" },
  { id: "YYYY", label: "Year only (2024)" },
  { id: "YY", label: "2-digit year (24)" },
  { id: "MMMM DD, YYYY", label: "Long (January 15, 2024)" },
  { id: "MMM D, YYYY", label: "Short (Jan 15, 2024)" },
] as const;

// ============================================================================
// Template Wizard Types
// ============================================================================

/** Question types supported by the wizard */
export type WizardQuestionType = "boolean" | "single" | "multiple" | "text" | "select";

/** A choice option for single/multiple/select questions */
export interface WizardChoice {
  id: string;
  label: string;
  description?: string;
}

/** Conditional display rule for a question */
export interface WizardShowWhen {
  questionId: string;
  value: string | boolean | string[];
}

/** A single question in a wizard step */
export interface WizardQuestion {
  id: string;
  type: WizardQuestionType;
  question: string;
  helpText?: string;
  choices?: WizardChoice[];        // for single/multiple/select
  defaultValue?: string | boolean | string[];
  placeholder?: string;            // for text
  validation?: ValidationRule;     // for text
  showWhen?: WizardShowWhen;       // conditional display
}

/** A step containing one or more questions */
export interface WizardStep {
  id: string;
  title: string;
  description?: string;
  questions: WizardQuestion[];
}

/** How wizard answers affect the schema */
export interface WizardSchemaModifier {
  questionId: string;
  action: "include" | "exclude" | "set_variable";
  nodeConditionVar?: string;    // for include/exclude - the var name used in <if var="...">
  variableName?: string;        // for set_variable
  valueMap?: Record<string, string>; // maps answer values to variable values
}

/** Complete wizard configuration for a template */
export interface WizardConfig {
  title: string;
  description?: string;
  steps: WizardStep[];
  schemaModifiers: WizardSchemaModifier[];
}

/** User answers during wizard completion */
export type WizardAnswers = Record<string, string | boolean | string[]>;

/** State for an active wizard session */
export interface WizardState {
  isOpen: boolean;
  template: Template | null;
  currentStep: number;
  answers: WizardAnswers;
  previewTree: SchemaTree | null;
}

// ============================================================================
// Template Types
// ============================================================================

export interface Template {
  id: string;
  name: string;
  description: string | null;
  schema_xml: string;
  variables: Record<string, string>;
  variable_validation?: Record<string, ValidationRule>;
  icon_color: string | null;
  is_favorite: boolean;
  use_count: number;
  created_at: string;
  updated_at: string;
  tags: string[];
  wizard_config: WizardConfig | null;
}

export interface RecentProject {
  id: string;
  projectName: string;
  outputPath: string;
  schemaXml: string;
  variables: Record<string, string>;
  variableValidation: Record<string, ValidationRule>;
  templateId: string | null;
  templateName: string | null;
  foldersCreated: number;
  filesCreated: number;
  createdAt: string;
}

export type TemplateSortOption =
  | "default"
  | "name_asc"
  | "name_desc"
  | "created_asc"
  | "created_desc"
  | "updated_asc"
  | "updated_desc"
  | "usage_asc"
  | "usage_desc";

export interface TemplateExport {
  name: string;
  description: string | null;
  schema_xml: string;
  variables?: Record<string, string>;
  variable_validation?: Record<string, ValidationRule>;
  icon_color: string | null;
  tags?: string[];
  wizard_config?: WizardConfig | null;
}

export interface TemplateExportFile {
  version: string;
  type: "template" | "template_bundle";
  exported_at: string;
  template?: TemplateExport;
  templates?: TemplateExport[];
}

export interface ImportResult {
  imported: string[];
  skipped: string[];
  errors: string[];
}

export type DuplicateStrategy = "skip" | "replace" | "rename";

export type ThemeMode = "light" | "dark" | "system";

export type AccentColor = "blue" | "purple" | "green" | "orange" | "pink";

export interface Settings {
  defaultOutputPath: string | null;
  defaultProjectName: string;
  theme: ThemeMode;
  accentColor: AccentColor;
  watchAutoCreate: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  defaultOutputPath: null,
  defaultProjectName: "my-project",
  theme: "system",
  accentColor: "blue",
  watchAutoCreate: true,
};

export const ACCENT_COLORS: Record<AccentColor, string> = {
  blue: "#0a84ff",
  purple: "#bf5af2",
  green: "#30d158",
  orange: "#ff9f0a",
  pink: "#ff375f",
};

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
