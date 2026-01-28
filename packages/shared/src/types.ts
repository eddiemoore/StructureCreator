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
  /**
   * Generator type for binary file creation.
   * - "image": Creates a placeholder image (PNG/JPEG) with configurable dimensions and color
   * - "sqlite": Creates a SQLite database with defined schema
   */
  generate?: "image" | "sqlite";
  /**
   * Generator configuration (child XML content as string for parsing).
   * For image: width, height, background, format attributes
   * For sqlite: <table> or <sql> child elements
   */
  generateConfig?: string;
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
    /** Number of files that will be generated (images, databases) */
    generated?: number;
  };
  hooks?: SchemaHooks;
}

// ============================================================================
// Variable Types
// ============================================================================

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
