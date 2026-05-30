/**
 * Shared types for Structure Creator
 * These types are shared between the desktop app and website
 */

// ============================================================================
// Schema Types
// ============================================================================

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

// IPC type shapes are generated from the Rust structs via specta (ADR-0003,
// issues #97 + #102). See `./generated/types.ts` and the drift test
// `ipc_types_match_committed_typescript` in apps/desktop/src-tauri.
import type {
  SchemaNode as GeneratedSchemaNode,
  SchemaHooks as GeneratedSchemaHooks,
  SchemaStats as GeneratedSchemaStats,
  SchemaTree as GeneratedSchemaTree,
  VariableDefinition as GeneratedVariableDefinition,
  ValidationRule as GeneratedValidationRule,
  ValidationError as GeneratedValidationError,
  LogEntry as GeneratedLogEntry,
  ResultSummary as GeneratedResultSummary,
  HookResult as GeneratedHookResult,
  ItemType as GeneratedItemType,
  CreatedItem as GeneratedCreatedItem,
  CreateResult as GeneratedCreateResult,
  UndoSummary as GeneratedUndoSummary,
  UndoResult as GeneratedUndoResult,
  DiffAction as GeneratedDiffAction,
  DiffLineType as GeneratedDiffLineType,
  DiffLine as GeneratedDiffLine,
  DiffHunk as GeneratedDiffHunk,
  DiffNodeType as GeneratedDiffNodeType,
  DiffNode as GeneratedDiffNode,
  DiffSummary as GeneratedDiffSummary,
  DiffResult as GeneratedDiffResult,
} from "./generated/types";

/**
 * Strip `| null` from each property. Rust's `Option<T>` serializes as
 * `T | null` via specta, but the rest of the codebase treats absent values
 * as `undefined`, so we collapse the two on the consumption side.
 */
type WithoutNullFields<T> = { [K in keyof T]: Exclude<T[K], null> };

/**
 * Represents a single node in the schema tree structure.
 * Nodes can be files, folders, or control flow elements (if/else/repeat).
 *
 * Field shape is generated from the Rust `SchemaNode` struct via specta. The
 * frontend re-narrows two fields the Rust type system cannot express:
 *   - `type` is required and limited to {@link NodeType}.
 *   - `generate`, when present, is restricted to `"image" | "sqlite"`.
 * Adding a field on the Rust side propagates here automatically; the
 * codegen drift test (`ipc_types_match_committed_typescript`) fails on any
 * Rust↔TS divergence until the generated file is regenerated.
 */
export type SchemaNode = WithoutNullFields<
  Omit<GeneratedSchemaNode, "type" | "name" | "children" | "generate">
> & {
  type: NodeType;
  name: string;
  children?: SchemaNode[];
  generate?: "image" | "sqlite";
};

export type SchemaHooks = WithoutNullFields<GeneratedSchemaHooks>;
export type SchemaStats = WithoutNullFields<GeneratedSchemaStats>;
export type VariableDefinition = WithoutNullFields<GeneratedVariableDefinition>;

/** Tree of schema nodes plus parse-time metadata (stats, hooks, defs). */
export type SchemaTree = WithoutNullFields<
  Omit<GeneratedSchemaTree, "root" | "hooks" | "variableDefinitions">
> & {
  root: SchemaNode;
  hooks?: SchemaHooks;
  variableDefinitions?: VariableDefinition[];
};

// ============================================================================
// Variable Types
// ============================================================================

export type ValidationRule = WithoutNullFields<GeneratedValidationRule>;

export interface Variable {
  name: string;
  value: string;
  validation?: ValidationRule;
  /** Description explaining what this variable is for */
  description?: string;
  /** Example text shown in empty input */
  placeholder?: string;
  /** Concrete example value */
  example?: string;
}

export type ValidationError = GeneratedValidationError;

// ============================================================================
// IPC Result + Diff Types (generated, ADR-0003)
// ============================================================================

/**
 * Log entry returned by the native backend over IPC. `details` is treated as
 * optional on the consumer side (web/desktop construct entries without it);
 * the Rust struct's `Option<String>` matches this intent.
 */
export type BackendLogEntry = Omit<WithoutNullFields<GeneratedLogEntry>, "details"> & {
  details?: string;
};

/**
 * Per-run counts of created/skipped items + hook execution. The generated
 * type marks counts with `#[serde(default)]` as optional, but the Rust struct
 * always populates them on serialize, so the frontend treats them as required.
 */
export type ResultSummary = Required<WithoutNullFields<GeneratedResultSummary>>;
export type HookResult = WithoutNullFields<GeneratedHookResult>;
export type ItemType = GeneratedItemType;
export type CreatedItem = WithoutNullFields<GeneratedCreatedItem>;

export type CreateResult = WithoutNullFields<
  Omit<GeneratedCreateResult, "logs" | "summary" | "hook_results" | "created_items">
> & {
  logs: BackendLogEntry[];
  summary: ResultSummary;
  hook_results: HookResult[];
  created_items: CreatedItem[];
};

export type UndoSummary = WithoutNullFields<GeneratedUndoSummary>;
export type UndoResult = WithoutNullFields<
  Omit<GeneratedUndoResult, "logs" | "summary">
> & {
  logs: BackendLogEntry[];
  summary: UndoSummary;
};

export type DiffAction = GeneratedDiffAction;
export type DiffLineType = GeneratedDiffLineType;
export type DiffLine = WithoutNullFields<GeneratedDiffLine>;
export type DiffHunk = WithoutNullFields<
  Omit<GeneratedDiffHunk, "lines">
> & {
  lines: DiffLine[];
};
export type DiffNodeType = GeneratedDiffNodeType;
export type DiffNode = WithoutNullFields<
  Omit<GeneratedDiffNode, "children" | "diff_hunks" | "generate">
> & {
  children?: DiffNode[];
  diff_hunks?: DiffHunk[];
  generate?: "image" | "sqlite";
};
export type DiffSummary = WithoutNullFields<GeneratedDiffSummary>;
export type DiffResult = WithoutNullFields<
  Omit<GeneratedDiffResult, "root" | "summary">
> & {
  root: DiffNode;
  summary: DiffSummary;
};

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

// ============================================================================
// Settings Types
// ============================================================================

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

// ============================================================================
// Parse Result Types
// ============================================================================

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

// ============================================================================
// Schema Validation Types
// ============================================================================

/**
 * Severity level for validation issues.
 * - error: Blocks structure creation
 * - warning: Advisory only, doesn't block creation
 */
export type ValidationSeverity = "error" | "warning";

/**
 * Type of validation issue found in the schema.
 */
export type ValidationIssueType =
  | "xml_syntax"
  | "undefined_variable"
  | "duplicate_name"
  | "circular_inheritance"
  | "inheritance_error"
  | "invalid_url";

/**
 * A single validation issue found during schema validation.
 */
export interface ValidationIssue {
  /** Severity level of the issue */
  severity: ValidationSeverity;
  /** Type of validation issue */
  issueType: ValidationIssueType;
  /** Human-readable description of the issue */
  message: string;
  /** Path to the node where the issue was found (e.g., "root/src/components") */
  nodePath?: string;
  /** The problematic value (e.g., the undefined variable name or invalid URL) */
  value?: string;
}

/**
 * Result of schema validation.
 * Returned by cmd_validate_schema.
 */
export interface SchemaValidationResult {
  /** True if no errors were found (warnings don't affect this) */
  isValid: boolean;
  /** Error-level issues that block creation */
  errors: ValidationIssue[];
  /** Warning-level issues that are advisory */
  warnings: ValidationIssue[];
}

// ============================================================================
// Team Library Types
// ============================================================================

/**
 * A configured team library (shared folder containing .sct template files).
 * Team libraries allow sharing templates across team members via network folders,
 * Dropbox, OneDrive, or other shared storage.
 */
export interface TeamLibrary {
  /** Unique identifier */
  id: string;
  /** Display name for the library */
  name: string;
  /** Full path to the shared folder */
  path: string;
  /** Sync interval in seconds (default: 300 = 5 minutes) */
  syncInterval: number;
  /** ISO timestamp of last successful scan, or null if never scanned */
  lastSyncAt: string | null;
  /** Whether this library is enabled for scanning */
  isEnabled: boolean;
  /** ISO timestamp when the library was added */
  createdAt: string;
  /** ISO timestamp when the library was last modified */
  updatedAt: string;
}

/**
 * A template found in a team library folder.
 * Represents metadata about a .sct file without loading its full content.
 */
export interface TeamTemplate {
  /** Template name (from the .sct file metadata) */
  name: string;
  /** Description from the template, if available */
  description: string | null;
  /** Full path to the .sct file */
  filePath: string;
  /** ISO timestamp when the file was last modified */
  modifiedAt: string;
  /** File size in bytes */
  sizeBytes: number;
}

/**
 * A sync log entry for auditing team library operations.
 */
export interface SyncLogEntry {
  /** Unique identifier */
  id: string;
  /** ID of the library this entry relates to */
  libraryId: string;
  /** Type of action: "scan", "import", or "error" */
  action: "scan" | "import" | "error";
  /** Name of the template involved (for import actions) */
  templateName: string | null;
  /** Additional details about the action */
  details: string | null;
  /** ISO timestamp when the action occurred */
  createdAt: string;
}

/**
 * Result of importing templates from a team library.
 */
export interface TeamImportResult {
  /** Names of successfully imported templates */
  imported: string[];
  /** Names of templates that were skipped (already exist) */
  skipped: string[];
  /** Error messages for templates that failed to import */
  errors: string[];
}

// ============================================================================
// Plugin Types
// ============================================================================

/**
 * Plugin capabilities define what hooks a plugin provides.
 */
export type PluginCapability =
  | "file-processor"
  | "variable-transformer"
  | "schema-validator"
  | "post-create-hook";

/**
 * A registered plugin in the system.
 */
export interface Plugin {
  /** Unique identifier */
  id: string;
  /** Plugin name (from plugin.json) */
  name: string;
  /** Semantic version */
  version: string;
  /** Human-readable description */
  description: string | null;
  /** Full path to the plugin directory */
  path: string;
  /** Plugin capabilities (what hooks it provides) */
  capabilities: PluginCapability[];
  /** File extensions this plugin processes (for file-processor capability) */
  fileTypes: string[];
  /** User-configurable settings */
  userSettings: Record<string, unknown>;
  /** Whether the plugin is enabled */
  isEnabled: boolean;
  /** Load order (lower numbers load first) */
  loadOrder: number;
  /** ISO timestamp when the plugin was installed */
  installedAt: string;
  /** ISO timestamp when the plugin was last updated */
  updatedAt: string;
}

/**
 * Plugin manifest structure (plugin.json).
 * This is the format plugins use to describe themselves.
 */
export interface PluginManifest {
  /** Unique plugin name */
  name: string;
  /** Semantic version */
  version: string;
  /** Human-readable description */
  description?: string;
  /** Plugin capabilities */
  capabilities: PluginCapability[];
  /** File extensions for file processors */
  fileTypes?: string[];
  /** Main entry point (default: "index.js") */
  main?: string;
  /** Plugin author */
  author?: string;
  /** License */
  license?: string;
}
