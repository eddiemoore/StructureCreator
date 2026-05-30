// Auto-generated from Rust via specta. Do not edit by hand.
// Regenerate with: REGEN_TS=1 cargo test ipc_types_match_committed_typescript
export type JsonValue = unknown;
export type SchemaNode = { id?: string | null; type?: string; name?: string; url?: string | null; content?: string | null; children?: SchemaNode[] | null; condition_var?: string | null; 
/**
 * For repeat nodes: the count expression (variable like "%NUM%" or literal "3")
 */
repeat_count?: string | null; 
/**
 * For repeat nodes: the iteration variable name (e.g., "i" creates %i%)
 */
repeat_as?: string | null; 
/**
 * Generator type: "image" or "sqlite"
 */
generate?: string | null; 
/**
 * Generator configuration (child XML as string for parsing)
 */
generateConfig?: string | null; 
/**
 * If true, process {{if}}/{{for}} template directives in file content.
 * When false/None, {{...}} syntax is preserved as-is.
 */
template?: boolean | null; 
/**
 * Unrecognized XML attributes captured verbatim so they survive a
 * parse -> edit -> export round-trip. Keys exclude attributes already
 * mapped to dedicated fields above (name, url, var, count, as, generate,
 * template, and generator config attrs). Sorted for deterministic export.
 */
attributes?: { [key in string]: string } | null }
export type SchemaStats = { folders: number; files: number; downloads: number; generated?: number }
export type SchemaHooks = { post_create: string[] }
/**
 * Variable definition parsed from <variable> elements in the schema.
 * Provides metadata like description, placeholder, and validation rules.
 */
export type VariableDefinition = { name: string; description?: string | null; placeholder?: string | null; example?: string | null; required?: boolean | null; pattern?: string | null; minLength?: number | null; maxLength?: number | null }
export type SchemaTree = { root: SchemaNode; stats: SchemaStats; hooks?: SchemaHooks | null; variableDefinitions?: VariableDefinition[] | null }
/**
 * Validation rule for a variable (frontend API version).
 * 
 * This type mirrors `database::ValidationRule` but uses camelCase serialization
 * for frontend compatibility. We need both types because:
 * - `database::ValidationRule`: snake_case for SQLite JSON storage (backwards compatible)
 * - `schema::ValidationRule`: camelCase for frontend API responses
 * 
 * Use `From<database::ValidationRule>` for easy conversion.
 */
export type ValidationRule = { pattern?: string | null; minLength?: number | null; maxLength?: number | null; required?: boolean }
export type LogEntry = { log_type: string; message: string; details: string | null }
export type ResultSummary = { folders_created: number; files_created: number; files_downloaded: number; files_generated?: number; errors: number; skipped: number; hooks_executed?: number; hooks_failed?: number }
export type HookResult = { command: string; success: boolean; exit_code: number | null; stdout: string | null; stderr: string | null }
/**
 * Type of created item for undo tracking
 */
export type ItemType = "folder" | "file"
/**
 * Represents a created item for undo tracking
 */
export type CreatedItem = { 
/**
 * Full path of the created item
 */
path: string; 
/**
 * Type of the item
 */
item_type: ItemType; 
/**
 * True if this item existed before and was overwritten
 */
pre_existed: boolean }
export type CreateResult = { logs: LogEntry[]; summary: ResultSummary; hook_results: HookResult[]; 
/**
 * Items created during this operation, for undo support
 */
created_items: CreatedItem[] }
/**
 * Summary of undo operation results
 */
export type UndoSummary = { files_deleted: number; folders_deleted: number; items_skipped: number; errors: number }
/**
 * Result of an undo operation
 */
export type UndoResult = { logs: LogEntry[]; summary: UndoSummary }
/**
 * Validation error for a variable
 */
export type ValidationError = { variable_name: string; message: string }
/**
 * Represents the action that would be taken for a filesystem entry
 */
export type DiffAction = 
/**
 * Item will be created (does not exist)
 */
"create" | 
/**
 * Item exists and will be overwritten (when overwrite=true)
 */
"overwrite" | 
/**
 * Item exists and will be skipped (when overwrite=false)
 */
"skip" | 
/**
 * Folder exists, no action needed (but may contain changed children)
 */
"unchanged"
/**
 * Type of diff line
 */
export type DiffLineType = "add" | "remove" | "context" | 
/**
 * Indicates the diff was truncated (not actual file content)
 */
"truncated"
/**
 * A single line in a diff hunk
 */
export type DiffLine = { 
/**
 * Type of this diff line
 */
line_type: DiffLineType; 
/**
 * The line content
 */
content: string }
/**
 * A diff hunk representing a contiguous block of changes
 */
export type DiffHunk = { 
/**
 * Line number in old file (1-indexed)
 */
old_start: number; 
/**
 * Number of lines from old file in this hunk
 */
old_count: number; 
/**
 * Line number in new file (1-indexed)
 */
new_start: number; 
/**
 * Number of lines from new file in this hunk
 */
new_count: number; 
/**
 * The diff lines
 */
lines: DiffLine[] }
/**
 * Type of node in the diff tree
 */
export type DiffNodeType = "folder" | "file"
/**
 * Represents a file or folder in the diff preview tree
 */
export type DiffNode = { 
/**
 * Unique identifier for frontend tree navigation
 */
id: string; 
/**
 * Type of this node (folder or file)
 */
node_type: DiffNodeType; 
/**
 * Display name (with variables substituted)
 */
name: string; 
/**
 * Full path relative to output directory
 */
path: string; 
/**
 * Action to be taken
 */
action: DiffAction; 
/**
 * For files: existing content (if overwriting, truncated for large files)
 */
existing_content?: string | null; 
/**
 * For files: new content to be written (truncated for large files)
 */
new_content?: string | null; 
/**
 * For files: computed diff hunks (for text files only)
 */
diff_hunks?: DiffHunk[] | null; 
/**
 * For files with URLs: the source URL
 */
url?: string | null; 
/**
 * Whether this is a binary file (no text diff available)
 */
is_binary?: boolean; 
/**
 * Child nodes (for folders)
 */
children?: DiffNode[] | null }
/**
 * Summary statistics for the diff preview
 */
export type DiffSummary = { total_items: number; creates: number; overwrites: number; skips: number; unchanged_folders: number; 
/**
 * Warnings generated during diff preview (e.g., invalid repeat counts)
 */
warnings: string[] }
/**
 * Complete diff preview result
 */
export type DiffResult = { root: DiffNode; summary: DiffSummary }
/**
 * Type of export file - single template or bundle
 */
export type ExportFileType = 
/**
 * Single template export
 */
"template" | 
/**
 * Multiple templates bundled together
 */
"template_bundle"
export type TemplateExportFile = { version: string; type: ExportFileType; exported_at: string; template?: TemplateExport | null; templates?: TemplateExport[] | null }
export type TemplateExport = { name: string; description: string | null; schema_xml: string; variables?: { [key in string]: string } | null; 
/**
 * Validation rules for variables (optional, for backwards compatibility)
 */
variable_validation: { [key in string]: ValidationRule }; icon_color: string | null; 
/**
 * Tags for categorizing templates (optional, for backwards compatibility)
 */
tags: string[]; 
/**
 * Wizard configuration for guided template setup (optional)
 */
wizard_config?: JsonValue | null }
export type ImportResult = { imported: string[]; skipped: string[]; errors: string[] }
export type Template = { id: string; name: string; description: string | null; schema_xml: string; variables: { [key in string]: string }; variable_validation?: { [key in string]: ValidationRule }; icon_color: string | null; is_favorite: boolean; use_count: number; created_at: string; updated_at: string; tags?: string[]; 
/**
 * Wizard configuration for guided template setup (JSON)
 */
wizard_config: JsonValue | null }
/**
 * A recent project entry
 */
export type RecentProject = { id: string; project_name: string; output_path: string; schema_xml: string; variables: { [key in string]: string }; variable_validation?: { [key in string]: ValidationRule }; template_id: string | null; template_name: string | null; folders_created: number; files_created: number; created_at: string }
/**
 * A sync log entry for audit trail
 */
export type SyncLogEntry = { id: string; library_id: string; action: string; template_name: string | null; details: string | null; created_at: string }
/**
 * A configured team library (shared folder containing .sct template files)
 */
export type TeamLibrary = { id: string; name: string; path: string; sync_interval: number; last_sync_at: string | null; is_enabled: boolean; created_at: string; updated_at: string }
/**
 * Represents a template found in a team library folder
 */
export type TeamTemplate = { 
/**
 * Template name (derived from filename or export metadata)
 */
name: string; 
/**
 * Description from the template export file
 */
description: string | null; 
/**
 * Full path to the .sct file
 */
file_path: string; 
/**
 * File modification time (ISO 8601)
 */
modified_at: string; 
/**
 * File size in bytes
 */
size_bytes: number }
/**
 * Plugin capability types
 */
export type PluginCapability = "file-processor" | "variable-transformer" | "schema-validator" | "post-create-hook"
/**
 * A registered plugin
 */
export type Plugin = { id: string; name: string; version: string; description: string | null; path: string; capabilities: PluginCapability[]; file_types: string[]; user_settings: JsonValue; is_enabled: boolean; load_order: number; installed_at: string; updated_at: string }
/**
 * Plugin manifest structure (plugin.json)
 */
export type PluginManifest = { 
/**
 * Unique plugin name (used as directory name)
 */
name: string; 
/**
 * Semantic version (e.g., "1.0.0")
 */
version: string; 
/**
 * Human-readable description
 */
description?: string | null; 
/**
 * Plugin capabilities (what hooks it provides)
 */
capabilities?: string[]; 
/**
 * File extensions this plugin processes (for file-processor capability)
 */
fileTypes?: string[]; 
/**
 * Main entry point (default: "index.js")
 */
main?: string; 
/**
 * Plugin author
 */
author?: string | null; 
/**
 * Plugin license
 */
license?: string | null }
/**
 * Severity level for validation issues
 */
export type ValidationSeverity = "error" | "warning"
/**
 * Type of validation issue
 */
export type ValidationIssueType = "xml_syntax" | "undefined_variable" | "duplicate_name" | "circular_inheritance" | "inheritance_error" | "invalid_url"
/**
 * A single validation issue found in the schema
 */
export type ValidationIssue = { severity: ValidationSeverity; issueType: ValidationIssueType; message: string; 
/**
 * Path to the node where the issue was found (e.g., "root/src/components")
 */
nodePath?: string | null; 
/**
 * The problematic value (e.g., the undefined variable name or invalid URL)
 */
value?: string | null }
/**
 * Result of schema validation
 */
export type SchemaValidationResult = { 
/**
 * True if no errors were found (warnings don't affect this)
 */
isValid: boolean; 
/**
 * Error-level issues that block creation
 */
errors: ValidationIssue[]; 
/**
 * Warning-level issues that are advisory
 */
warnings: ValidationIssue[] }
/**
 * Result of parsing a schema with inheritance resolved
 */
export type ParseWithInheritanceResult = { tree: SchemaTree; mergedVariables: { [key in string]: string }; mergedVariableValidation: { [key in string]: ValidationRule }; baseTemplates: string[] }
