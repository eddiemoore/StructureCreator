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
