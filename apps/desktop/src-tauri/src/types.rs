//! Type definitions for structure creation, diff preview, and template import/export.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::database::ValidationRule;

// ============================================================================
// Structure Creation Types
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogEntry {
    pub log_type: String, // "success", "error", "warning", "info"
    pub message: String,
    pub details: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateResult {
    pub logs: Vec<LogEntry>,
    pub summary: ResultSummary,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub hook_results: Vec<HookResult>,
    /// Items created during this operation, for undo support
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub created_items: Vec<CreatedItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HookResult {
    pub command: String,
    pub success: bool,
    pub exit_code: Option<i32>,
    pub stdout: Option<String>,
    pub stderr: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResultSummary {
    pub folders_created: usize,
    pub files_created: usize,
    pub files_downloaded: usize,
    #[serde(default)]
    pub files_generated: usize,
    pub errors: usize,
    pub skipped: usize,
    #[serde(default)]
    pub hooks_executed: usize,
    #[serde(default)]
    pub hooks_failed: usize,
}

/// Type of created item for undo tracking
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ItemType {
    Folder,
    File,
}

/// Represents a created item for undo tracking
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreatedItem {
    /// Full path of the created item
    pub path: String,
    /// Type of the item
    pub item_type: ItemType,
    /// True if this item existed before and was overwritten
    pub pre_existed: bool,
}

/// Result of an undo operation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UndoResult {
    pub logs: Vec<LogEntry>,
    pub summary: UndoSummary,
}

/// Summary of undo operation results
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UndoSummary {
    pub files_deleted: usize,
    pub folders_deleted: usize,
    pub items_skipped: usize,
    pub errors: usize,
}

/// Validation error for a variable
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidationError {
    pub variable_name: String,
    pub message: String,
}

// ============================================================================
// Diff Preview Types
// ============================================================================

/// Represents the action that would be taken for a filesystem entry
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum DiffAction {
    /// Item will be created (does not exist)
    Create,
    /// Item exists and will be overwritten (when overwrite=true)
    Overwrite,
    /// Item exists and will be skipped (when overwrite=false)
    Skip,
    /// Folder exists, no action needed (but may contain changed children)
    Unchanged,
}

/// Type of diff line
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum DiffLineType {
    Add,
    Remove,
    Context,
    /// Indicates the diff was truncated (not actual file content)
    Truncated,
}

/// Type of node in the diff tree
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum DiffNodeType {
    Folder,
    File,
}

/// A single line in a diff hunk
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiffLine {
    /// Type of this diff line
    pub line_type: DiffLineType,
    /// The line content
    pub content: String,
}

/// A diff hunk representing a contiguous block of changes
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiffHunk {
    /// Line number in old file (1-indexed)
    pub old_start: usize,
    /// Number of lines from old file in this hunk
    pub old_count: usize,
    /// Line number in new file (1-indexed)
    pub new_start: usize,
    /// Number of lines from new file in this hunk
    pub new_count: usize,
    /// The diff lines
    pub lines: Vec<DiffLine>,
}

/// Represents a file or folder in the diff preview tree
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiffNode {
    /// Unique identifier for frontend tree navigation
    pub id: String,
    /// Type of this node (folder or file)
    pub node_type: DiffNodeType,
    /// Display name (with variables substituted)
    pub name: String,
    /// Full path relative to output directory
    pub path: String,
    /// Action to be taken
    pub action: DiffAction,
    /// For files: existing content (if overwriting, truncated for large files)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub existing_content: Option<String>,
    /// For files: new content to be written (truncated for large files)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub new_content: Option<String>,
    /// For files: computed diff hunks (for text files only)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diff_hunks: Option<Vec<DiffHunk>>,
    /// For files with URLs: the source URL
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    /// Whether this is a binary file (no text diff available)
    #[serde(default)]
    pub is_binary: bool,
    /// Child nodes (for folders)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<DiffNode>>,
}

/// Summary statistics for the diff preview
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiffSummary {
    pub total_items: usize,
    pub creates: usize,
    pub overwrites: usize,
    pub skips: usize,
    pub unchanged_folders: usize,
    /// Warnings generated during diff preview (e.g., invalid repeat counts)
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub warnings: Vec<String>,
}

/// Complete diff preview result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiffResult {
    pub root: DiffNode,
    pub summary: DiffSummary,
}

// ============================================================================
// Template Export/Import Types
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TemplateExport {
    pub name: String,
    pub description: Option<String>,
    pub schema_xml: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub variables: Option<HashMap<String, String>>,
    /// Validation rules for variables (optional, for backwards compatibility)
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub variable_validation: HashMap<String, ValidationRule>,
    pub icon_color: Option<String>,
    /// Tags for categorizing templates (optional, for backwards compatibility)
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    /// Wizard configuration for guided template setup (optional)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wizard_config: Option<serde_json::Value>,
}

/// Type of export file - single template or bundle
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExportFileType {
    /// Single template export
    Template,
    /// Multiple templates bundled together
    TemplateBundle,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TemplateExportFile {
    pub version: String,
    #[serde(rename = "type")]
    pub file_type: ExportFileType,
    pub exported_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub template: Option<TemplateExport>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub templates: Option<Vec<TemplateExport>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportResult {
    pub imported: Vec<String>,
    pub skipped: Vec<String>,
    pub errors: Vec<String>,
}

/// Strategy for handling duplicate template names during import
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DuplicateStrategy {
    /// Skip importing templates that already exist
    Skip,
    /// Replace existing templates with imported ones
    Replace,
    /// Rename imported templates by adding a suffix
    Rename,
}

// ============================================================================
// Watch Mode Types
// ============================================================================

/// Payload emitted when a watched schema file changes
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchemaFileChangedPayload {
    pub path: String,
    pub content: String,
}

/// Payload emitted when watch error occurs
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WatchErrorPayload {
    pub error: String,
}
