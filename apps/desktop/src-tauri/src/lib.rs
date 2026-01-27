pub mod database;
pub mod schema;
pub mod transforms;
pub mod validation;

pub use database::{CreateTemplateInput, Database, Template, UpdateTemplateInput, ValidationRule, RecentProject, CreateRecentProjectInput};
pub use schema::{parse_xml_schema, scan_folder_to_schema, scan_zip_to_schema, schema_to_xml, SchemaTree, SchemaNode, SchemaStats, SchemaHooks, resolve_template_inheritance, ParseWithInheritanceResult, TemplateData};
pub use validation::{validate_schema, SchemaValidationResult, ValidationIssue, ValidationSeverity, ValidationIssueType};
use transforms::substitute_variables;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write, Cursor};
use std::path::PathBuf;
use zip::{ZipArchive, ZipWriter, write::SimpleFileOptions};

#[cfg(feature = "tauri-app")]
use std::sync::Mutex;
#[cfg(feature = "tauri-app")]
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    Manager, State, Emitter,
};

// File watcher imports
#[cfg(feature = "tauri-app")]
use notify_debouncer_mini::{new_debouncer, notify::RecursiveMode};
#[cfg(feature = "tauri-app")]
use std::time::Duration;
#[cfg(feature = "tauri-app")]
use std::sync::mpsc;

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
    pub errors: usize,
    pub skipped: usize,
    #[serde(default)]
    pub hooks_executed: usize,
    #[serde(default)]
    pub hooks_failed: usize,
}

/// Maximum allowed repeat count to prevent accidental resource exhaustion
const MAX_REPEAT_COUNT: usize = 10000;

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

/// Helper to log a repeat-related error and increment error count
fn log_repeat_error(logs: &mut Vec<LogEntry>, summary: &mut ResultSummary, message: String, details: String) {
    logs.push(LogEntry {
        log_type: "error".to_string(),
        message,
        details: Some(details),
    });
    summary.errors += 1;
}

#[cfg(feature = "tauri-app")]
#[tauri::command]
fn cmd_parse_schema(content: String) -> Result<SchemaTree, String> {
    parse_xml_schema(&content).map_err(|e| e.to_string())
}

#[cfg(feature = "tauri-app")]
#[tauri::command]
fn cmd_parse_schema_with_inheritance(
    state: State<Mutex<AppState>>,
    content: String,
) -> Result<ParseWithInheritanceResult, String> {
    let state_guard = state.lock().map_err(|e| e.to_string())?;

    // Create a template loader closure that looks up templates from the database
    let loader = |name: &str| -> Option<TemplateData> {
        state_guard
            .db
            .get_template_by_name(name)
            .ok()
            .flatten()
            .map(|t| TemplateData {
                schema_xml: t.schema_xml,
                variables: t.variables,
                variable_validation: t.variable_validation
                    .into_iter()
                    .map(|(k, v)| (k, v.into()))
                    .collect(),
            })
    };

    resolve_template_inheritance(&content, &loader).map_err(|e| e.to_string())
}

#[cfg(feature = "tauri-app")]
#[tauri::command]
fn cmd_scan_folder(folder_path: String) -> Result<SchemaTree, String> {
    scan_folder_to_schema(&folder_path).map_err(|e| e.to_string())
}

#[cfg(feature = "tauri-app")]
#[tauri::command]
fn cmd_scan_zip(data: Vec<u8>, filename: String) -> Result<SchemaTree, String> {
    scan_zip_to_schema(&data, &filename).map_err(|e| e.to_string())
}

#[cfg(feature = "tauri-app")]
#[tauri::command]
fn cmd_export_schema_xml(tree: SchemaTree) -> String {
    schema_to_xml(&tree)
}

#[cfg(feature = "tauri-app")]
#[tauri::command]
fn cmd_create_structure(
    content: String,
    output_path: String,
    variables: HashMap<String, String>,
    dry_run: bool,
    overwrite: bool,
) -> Result<CreateResult, String> {
    let tree = parse_xml_schema(&content).map_err(|e| e.to_string())?;
    create_structure_from_tree(&tree, &output_path, &variables, dry_run, overwrite)
}

#[cfg(feature = "tauri-app")]
#[tauri::command]
fn cmd_create_structure_from_tree(
    tree: SchemaTree,
    output_path: String,
    variables: HashMap<String, String>,
    dry_run: bool,
    overwrite: bool,
) -> Result<CreateResult, String> {
    create_structure_from_tree(&tree, &output_path, &variables, dry_run, overwrite)
}

pub fn create_structure_from_tree(
    tree: &SchemaTree,
    output_path: &str,
    variables: &HashMap<String, String>,
    dry_run: bool,
    overwrite: bool,
) -> Result<CreateResult, String> {
    let base_path = PathBuf::from(output_path);
    let mut logs: Vec<LogEntry> = Vec::new();
    let mut summary = ResultSummary {
        folders_created: 0,
        files_created: 0,
        files_downloaded: 0,
        errors: 0,
        skipped: 0,
        hooks_executed: 0,
        hooks_failed: 0,
    };
    let mut hook_results: Vec<HookResult> = Vec::new();

    // Create structure recursively
    create_node(&tree.root, &base_path, variables, dry_run, overwrite, &mut logs, &mut summary)?;

    // Execute post-create hooks if present and not in dry-run mode
    if let Some(ref hooks) = tree.hooks {
        if !hooks.post_create.is_empty() {
            // Determine the working directory for hooks
            // Use the root folder path if it was created, otherwise use output_path
            // Apply variable substitution to root name (same as in create_node)
            let substituted_root_name = substitute_variables(&tree.root.name, variables);
            let hook_working_dir = base_path.join(&substituted_root_name);
            let working_dir = if hook_working_dir.exists() {
                hook_working_dir
            } else {
                base_path.clone()
            };

            for cmd in &hooks.post_create {
                // Replace variables in command
                let resolved_cmd = substitute_variables(cmd, variables);

                if dry_run {
                    logs.push(LogEntry {
                        log_type: "info".to_string(),
                        message: format!("Would run hook: {}", resolved_cmd),
                        details: Some(format!("Working directory: {}", working_dir.display())),
                    });
                } else {
                    logs.push(LogEntry {
                        log_type: "info".to_string(),
                        message: format!("Running hook: {}", resolved_cmd),
                        details: Some(format!("Working directory: {}", working_dir.display())),
                    });

                    let result = execute_hook(&resolved_cmd, &working_dir);

                    if result.success {
                        summary.hooks_executed += 1;
                        logs.push(LogEntry {
                            log_type: "success".to_string(),
                            message: format!("Hook completed: {}", resolved_cmd),
                            details: result.stdout.clone(),
                        });
                    } else {
                        summary.hooks_failed += 1;
                        logs.push(LogEntry {
                            log_type: "error".to_string(),
                            message: format!("Hook failed: {}", resolved_cmd),
                            details: result.stderr.clone().or_else(|| {
                                Some(format!("Exit code: {:?}", result.exit_code))
                            }),
                        });
                    }

                    hook_results.push(result);
                }
            }
        }
    }

    Ok(CreateResult { logs, summary, hook_results })
}

/// Execute a hook command in the specified working directory
fn execute_hook(command: &str, working_dir: &PathBuf) -> HookResult {
    use std::process::Command;

    // Use shell to execute the command for proper parsing
    #[cfg(target_os = "windows")]
    let result = Command::new("cmd")
        .args(["/C", command])
        .current_dir(working_dir)
        .output();

    #[cfg(not(target_os = "windows"))]
    let result = Command::new("sh")
        .args(["-c", command])
        .current_dir(working_dir)
        .output();

    match result {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout).to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            let exit_code = output.status.code();
            let success = output.status.success();

            HookResult {
                command: command.to_string(),
                success,
                exit_code,
                stdout: if stdout.is_empty() { None } else { Some(stdout) },
                stderr: if stderr.is_empty() { None } else { Some(stderr) },
            }
        }
        Err(e) => HookResult {
            command: command.to_string(),
            success: false,
            exit_code: None,
            stdout: None,
            stderr: Some(format!("Failed to execute command: {}", e)),
        },
    }
}

/// Check if a string value is "truthy"
/// Empty strings and common falsy values ("false", "0", "no") are considered false
fn is_truthy(value: &str) -> bool {
    if value.is_empty() {
        return false;
    }
    // Check for common falsy string values (case-insensitive)
    !matches!(value.to_lowercase().as_str(), "false" | "0" | "no" | "off" | "disabled")
}

/// Evaluate if condition without side effects
fn evaluate_if_condition(
    node: &schema::SchemaNode,
    variables: &HashMap<String, String>,
) -> bool {
    if let Some(var_name) = &node.condition_var {
        // Variables are stored with % wrapping (e.g., %NAME%), so wrap the var name
        let lookup_key = format!("%{}%", var_name);
        variables.get(&lookup_key)
            .map(|v| is_truthy(v))
            .unwrap_or(false)
    } else {
        false
    }
}

/// Process a list of child nodes, tracking if/else state between siblings
fn process_children(
    children: &[schema::SchemaNode],
    parent_path: &PathBuf,
    variables: &HashMap<String, String>,
    dry_run: bool,
    overwrite: bool,
    logs: &mut Vec<LogEntry>,
    summary: &mut ResultSummary,
) -> Result<(), String> {
    let mut child_last_if = None;
    for child in children {
        create_node_internal(child, parent_path, variables, dry_run, overwrite, logs, summary, child_last_if)?;
        // Track if results for else blocks
        // Only if nodes followed immediately by else nodes form a valid if/else chain
        // Any other node type (folder, file) breaks the chain
        match child.node_type.as_str() {
            "if" => child_last_if = Some(evaluate_if_condition(child, variables)),
            "else" => child_last_if = None, // Break chain - only one else per if
            _ => child_last_if = None, // Non-conditional nodes break the if/else chain
        }
    }
    Ok(())
}

fn create_node(
    node: &schema::SchemaNode,
    parent_path: &PathBuf,
    variables: &HashMap<String, String>,
    dry_run: bool,
    overwrite: bool,
    logs: &mut Vec<LogEntry>,
    summary: &mut ResultSummary,
) -> Result<(), String> {
    create_node_internal(node, parent_path, variables, dry_run, overwrite, logs, summary, None)
}

fn create_node_internal(
    node: &schema::SchemaNode,
    parent_path: &PathBuf,
    variables: &HashMap<String, String>,
    dry_run: bool,
    overwrite: bool,
    logs: &mut Vec<LogEntry>,
    summary: &mut ResultSummary,
    last_if_result: Option<bool>,
) -> Result<(), String> {
    // Handle conditional and repeat nodes (if/else/repeat)
    match node.node_type.as_str() {
        "if" => {
            // Evaluate condition using shared helper
            let condition_met = evaluate_if_condition(node, variables);

            // Process children if condition is met
            if condition_met {
                if let Some(children) = &node.children {
                    process_children(children, parent_path, variables, dry_run, overwrite, logs, summary)?;
                }
            }

            return Ok(());
        }
        "else" => {
            // Execute else block only if there was a preceding if that evaluated to false
            // If there's no preceding if (None), skip this orphaned else block
            let should_execute = match last_if_result {
                Some(previous_if_was_true) => !previous_if_was_true,
                None => {
                    // Log warning for orphaned else block
                    logs.push(LogEntry {
                        log_type: "warning".to_string(),
                        message: "Skipped orphaned else block (no preceding if)".to_string(),
                        details: Some("Else blocks must immediately follow an if block".to_string()),
                    });
                    false
                }
            };

            if should_execute {
                if let Some(children) = &node.children {
                    process_children(children, parent_path, variables, dry_run, overwrite, logs, summary)?;
                }
            }

            return Ok(());
        }
        "repeat" => {
            let count_str = node.repeat_count.as_deref().unwrap_or("1");
            let as_var = node.repeat_as.as_deref().unwrap_or("i");

            // Validate 'as' variable name:
            // - Must be non-empty
            // - Must contain only alphanumeric characters or underscores
            // - Must not start with a digit (conventional variable naming)
            let first_char = as_var.chars().next();
            if as_var.is_empty()
                || !as_var.chars().all(|c| c.is_alphanumeric() || c == '_')
                || first_char.map_or(false, |c| c.is_ascii_digit())
            {
                log_repeat_error(
                    logs,
                    summary,
                    format!("Invalid repeat variable name: '{}'", as_var),
                    "Variable name must be non-empty, start with a letter or underscore, and contain only alphanumeric characters or underscores".to_string(),
                );
                return Ok(());
            }

            // Warn about potentially confusing variable names ending in _1
            // Since %var_1% is the 1-indexed version, %n_1% would create %n_1% and %n_1_1%
            if as_var.ends_with("_1") {
                logs.push(LogEntry {
                    log_type: "warning".to_string(),
                    message: format!("Variable name '{}' ends with '_1' which may be confusing", as_var),
                    details: Some(format!(
                        "The 1-indexed variable will be '%{}_1%'. Consider using a different name.",
                        as_var
                    )),
                });
            }

            // Resolve count (may contain variable references)
            let resolved = substitute_variables(count_str, variables);

            // Parse count to integer with safe bounds checking
            let count: usize = match resolved.trim().parse::<i64>() {
                Ok(n) if n < 0 => {
                    log_repeat_error(
                        logs,
                        summary,
                        format!("Repeat count cannot be negative: '{}'", resolved),
                        format!("Count must be a non-negative integer (resolved from '{}')", count_str),
                    );
                    return Ok(());
                }
                // Safe conversion: check against MAX_REPEAT_COUNT before casting
                // This prevents overflow on 32-bit systems where usize is smaller than i64
                Ok(n) if n as u64 > MAX_REPEAT_COUNT as u64 => {
                    log_repeat_error(
                        logs,
                        summary,
                        format!("Repeat count '{}' exceeds maximum of {}", n, MAX_REPEAT_COUNT),
                        "Consider reducing the count or splitting into multiple repeat blocks".to_string(),
                    );
                    return Ok(());
                }
                Ok(n) => n as usize,
                Err(_) => {
                    log_repeat_error(
                        logs,
                        summary,
                        format!("Invalid repeat count: '{}'", resolved),
                        format!("Count must be a non-negative integer (resolved from '{}')", count_str),
                    );
                    return Ok(());
                }
            };

            // Log the repeat operation
            if count == 0 {
                // Provide accurate details: distinguish literal "0" from variable that resolved to 0
                let details = if count_str == "0" {
                    "Count is explicitly set to 0".to_string()
                } else {
                    format!("Count '{}' resolved to 0", count_str)
                };
                logs.push(LogEntry {
                    log_type: "info".to_string(),
                    message: "Skipping repeat block (count is 0)".to_string(),
                    details: Some(details),
                });
            } else if dry_run {
                logs.push(LogEntry {
                    log_type: "info".to_string(),
                    message: format!("Would repeat {} times (as %{}%)", count, as_var),
                    details: None,
                });
            } else {
                logs.push(LogEntry {
                    log_type: "info".to_string(),
                    message: format!("Repeating {} times (as %{}%)", count, as_var),
                    details: None,
                });
            }

            // Process children N times
            if let Some(children) = &node.children {
                // Clone variables once before the loop for efficiency
                let mut scoped_vars = variables.clone();
                let var_0_key = format!("%{}%", as_var);
                let var_1_key = format!("%{}_1%", as_var);

                for i in 0..count {
                    // Update iteration variables in-place (more efficient than cloning per iteration)
                    scoped_vars.insert(var_0_key.clone(), i.to_string());
                    scoped_vars.insert(var_1_key.clone(), (i + 1).to_string());

                    process_children(children, parent_path, &scoped_vars, dry_run, overwrite, logs, summary)?;
                }
            }

            return Ok(());
        }
        _ => {}
    }

    // Replace variables in name
    let name = substitute_variables(&node.name, variables);

    let current_path = parent_path.join(&name);
    let display_path = current_path.display().to_string();

    match node.node_type.as_str() {
        "folder" => {
            if dry_run {
                logs.push(LogEntry {
                    log_type: "info".to_string(),
                    message: format!("Would create folder: {}", name),
                    details: Some(display_path.clone()),
                });
            } else if !current_path.exists() {
                match fs::create_dir_all(&current_path) {
                    Ok(_) => {
                        summary.folders_created += 1;
                        logs.push(LogEntry {
                            log_type: "success".to_string(),
                            message: format!("Created folder: {}", name),
                            details: Some(display_path.clone()),
                        });
                    }
                    Err(e) => {
                        summary.errors += 1;
                        logs.push(LogEntry {
                            log_type: "error".to_string(),
                            message: format!("Failed to create folder: {}", name),
                            details: Some(format!("Error: {}", e)),
                        });
                        return Err(format!("Failed to create folder {}: {}", display_path, e));
                    }
                }
            } else {
                logs.push(LogEntry {
                    log_type: "info".to_string(),
                    message: format!("Folder exists: {}", name),
                    details: Some(display_path.clone()),
                });
            }

            // Process children
            if let Some(children) = &node.children {
                process_children(children, &current_path, variables, dry_run, overwrite, logs, summary)?;
            }
        }
        "file" => {
            let file_exists = current_path.exists();

            if file_exists && !overwrite {
                summary.skipped += 1;
                logs.push(LogEntry {
                    log_type: "warning".to_string(),
                    message: format!("Skipped (exists): {}", name),
                    details: Some(display_path.clone()),
                });
                return Ok(());
            }

            if dry_run {
                if let Some(url) = &node.url {
                    logs.push(LogEntry {
                        log_type: "info".to_string(),
                        message: format!("Would download: {}", name),
                        details: Some(url.clone()),
                    });
                } else {
                    logs.push(LogEntry {
                        log_type: "info".to_string(),
                        message: format!("Would create file: {}", name),
                        details: Some(display_path.clone()),
                    });
                }
            } else {
                // Ensure parent directory exists
                if let Some(parent) = current_path.parent() {
                    if !parent.exists() {
                        fs::create_dir_all(parent)
                            .map_err(|e| format!("Failed to create parent dir: {}", e))?;
                    }
                }

                if let Some(url) = &node.url {
                    // Check if this is a binary file that needs special processing
                    if is_office_file(&name) || is_epub_file(&name) || is_pdf_file(&name)
                       || is_image_with_xmp(&name) || is_audio_with_metadata(&name)
                       || is_sqlite_database(&name) || is_processable_archive(&name) {
                        // Download as binary and process
                        match download_file_binary(url) {
                            Ok(data) => {
                                let (process_result, file_type) = if is_office_file(&name) {
                                    (process_office_file(&data, variables, &name), "Office")
                                } else if is_epub_file(&name) {
                                    (process_epub_file(&data, variables), "EPUB")
                                } else if is_pdf_file(&name) {
                                    (process_pdf_file(&data, variables), "PDF")
                                } else if is_audio_with_metadata(&name) {
                                    (process_audio_metadata(&data, variables, &name), "Audio")
                                } else if is_sqlite_database(&name) {
                                    (process_sqlite_database(&data, variables), "SQLite")
                                } else if is_processable_archive(&name) {
                                    (process_archive(&data, variables, &name, 0), "Archive")
                                } else {
                                    (process_image_xmp(&data, variables, &name), "Image")
                                };

                                match process_result {
                                    Ok(processed_data) => {
                                        match fs::write(&current_path, &processed_data) {
                                            Ok(_) => {
                                                summary.files_downloaded += 1;
                                                logs.push(LogEntry {
                                                    log_type: "success".to_string(),
                                                    message: format!("Downloaded & processed: {}", name),
                                                    details: Some(format!("From: {} ({} file, variables replaced)", url, file_type)),
                                                });
                                            }
                                            Err(e) => {
                                                summary.errors += 1;
                                                logs.push(LogEntry {
                                                    log_type: "error".to_string(),
                                                    message: format!("Failed to save file: {}", name),
                                                    details: Some(format!("Error writing to disk: {}", e)),
                                                });
                                            }
                                        }
                                    }
                                    Err(e) => {
                                        summary.errors += 1;
                                        logs.push(LogEntry {
                                            log_type: "error".to_string(),
                                            message: format!("Failed to process {} file: {}", file_type, name),
                                            details: Some(e),
                                        });
                                    }
                                }
                            }
                            Err(e) => {
                                summary.errors += 1;
                                let error_details = parse_download_error(url, &e);
                                logs.push(LogEntry {
                                    log_type: "error".to_string(),
                                    message: format!("Download failed: {}", name),
                                    details: Some(error_details),
                                });
                            }
                        }
                    } else if is_jupyter_notebook(&name) {
                        // Download Jupyter notebook and process JSON
                        match download_file(url) {
                            Ok(content) => {
                                let processed = match process_jupyter_notebook(&content, variables) {
                                    Ok(p) => p,
                                    Err(e) => {
                                        // If processing fails, fall back to simple string replacement
                                        logs.push(LogEntry {
                                            log_type: "warning".to_string(),
                                            message: format!("Notebook processing failed, using text replacement: {}", name),
                                            details: Some(e),
                                        });
                                        let fallback = substitute_variables(&content, variables);
                                        fallback
                                    }
                                };
                                match fs::write(&current_path, &processed) {
                                    Ok(_) => {
                                        summary.files_downloaded += 1;
                                        logs.push(LogEntry {
                                            log_type: "success".to_string(),
                                            message: format!("Downloaded & processed: {}", name),
                                            details: Some(format!("From: {} (Jupyter notebook, variables replaced)", url)),
                                        });
                                    }
                                    Err(e) => {
                                        summary.errors += 1;
                                        logs.push(LogEntry {
                                            log_type: "error".to_string(),
                                            message: format!("Failed to save file: {}", name),
                                            details: Some(format!("Error writing to disk: {}", e)),
                                        });
                                    }
                                }
                            }
                            Err(e) => {
                                summary.errors += 1;
                                let error_details = parse_download_error(url, &e);
                                logs.push(LogEntry {
                                    log_type: "error".to_string(),
                                    message: format!("Download failed: {}", name),
                                    details: Some(error_details),
                                });
                            }
                        }
                    } else {
                        // Download regular text file (includes SVG which is XML text)
                        match download_file(url) {
                            Ok(content) => {
                                // Replace variables in downloaded content
                                let file_content = substitute_variables(&content, variables);
                                match fs::write(&current_path, &file_content) {
                                    Ok(_) => {
                                        summary.files_downloaded += 1;
                                        let details = if is_svg_file(&name) {
                                            format!("From: {} (SVG, variables replaced)", url)
                                        } else {
                                            format!("From: {}", url)
                                        };
                                        logs.push(LogEntry {
                                            log_type: "success".to_string(),
                                            message: format!("Downloaded: {}", name),
                                            details: Some(details),
                                        });
                                    }
                                    Err(e) => {
                                        summary.errors += 1;
                                        logs.push(LogEntry {
                                            log_type: "error".to_string(),
                                            message: format!("Failed to save file: {}", name),
                                            details: Some(format!("Error writing to disk: {}", e)),
                                        });
                                    }
                                }
                            }
                            Err(e) => {
                                summary.errors += 1;
                                // Parse error for better user feedback
                                let error_details = parse_download_error(url, &e);
                                logs.push(LogEntry {
                                    log_type: "error".to_string(),
                                    message: format!("Download failed: {}", name),
                                    details: Some(error_details),
                                });
                                // Don't create file on download error
                            }
                        }
                    }
                } else {
                    // Create file with content (or empty if no content)
                    // Replace variables in file content
                    let file_content = substitute_variables(&node.content.clone().unwrap_or_default(), variables);
                    match fs::write(&current_path, &file_content) {
                        Ok(_) => {
                            summary.files_created += 1;
                            let has_content = node.content.is_some();
                            logs.push(LogEntry {
                                log_type: "success".to_string(),
                                message: format!("Created file: {}", name),
                                details: Some(if has_content {
                                    format!("{} ({} bytes)", display_path, file_content.len())
                                } else {
                                    display_path.clone()
                                }),
                            });
                        }
                        Err(e) => {
                            summary.errors += 1;
                            logs.push(LogEntry {
                                log_type: "error".to_string(),
                                message: format!("Failed to create file: {}", name),
                                details: Some(format!("Error: {}", e)),
                            });
                        }
                    }
                }
            }
        }
        _ => {}
    }

    Ok(())
}

fn parse_download_error(url: &str, error: &str) -> String {
    if error.contains("dns") || error.contains("resolve") {
        format!("Could not resolve host. Check if the URL is correct.\nURL: {}", url)
    } else if error.contains("timed out") || error.contains("timeout") {
        format!("Connection timed out. The server may be slow or unreachable.\nURL: {}", url)
    } else if error.contains("404") {
        format!("File not found (404). The file may have been moved or deleted.\nURL: {}", url)
    } else if error.contains("403") {
        format!("Access forbidden (403). You may not have permission to access this file.\nURL: {}", url)
    } else if error.contains("500") || error.contains("502") || error.contains("503") {
        format!("Server error. The server is experiencing issues.\nURL: {}", url)
    } else if error.contains("certificate") || error.contains("ssl") || error.contains("tls") {
        format!("SSL/TLS error. The connection could not be secured.\nURL: {}", url)
    } else if error.contains("connection refused") {
        format!("Connection refused. The server is not accepting connections.\nURL: {}", url)
    } else {
        format!("{}\nURL: {}", error, url)
    }
}

fn download_file(url: &str) -> Result<String, String> {
    match ureq::get(url)
        .timeout(std::time::Duration::from_secs(30))
        .call()
    {
        Ok(response) => {
            response
                .into_string()
                .map_err(|e| format!("Failed to read response: {}", e))
        }
        Err(ureq::Error::Status(code, _response)) => {
            // HTTP error status (4xx, 5xx)
            let status_text = match code {
                400 => "Bad Request",
                401 => "Unauthorized",
                403 => "Forbidden",
                404 => "Not Found",
                405 => "Method Not Allowed",
                408 => "Request Timeout",
                429 => "Too Many Requests",
                500 => "Internal Server Error",
                502 => "Bad Gateway",
                503 => "Service Unavailable",
                504 => "Gateway Timeout",
                _ => "HTTP Error",
            };
            Err(format!("HTTP {} {}", code, status_text))
        }
        Err(ureq::Error::Transport(transport)) => {
            // Network/transport error
            Err(format!("Network error: {}", transport))
        }
    }
}

fn download_file_binary(url: &str) -> Result<Vec<u8>, String> {
    match ureq::get(url)
        .timeout(std::time::Duration::from_secs(60))
        .call()
    {
        Ok(response) => {
            let mut bytes = Vec::new();
            response
                .into_reader()
                .read_to_end(&mut bytes)
                .map_err(|e| format!("Failed to read response: {}", e))?;
            Ok(bytes)
        }
        Err(ureq::Error::Status(code, _response)) => {
            let status_text = match code {
                400 => "Bad Request",
                401 => "Unauthorized",
                403 => "Forbidden",
                404 => "Not Found",
                405 => "Method Not Allowed",
                408 => "Request Timeout",
                429 => "Too Many Requests",
                500 => "Internal Server Error",
                502 => "Bad Gateway",
                503 => "Service Unavailable",
                504 => "Gateway Timeout",
                _ => "HTTP Error",
            };
            Err(format!("HTTP {} {}", code, status_text))
        }
        Err(ureq::Error::Transport(transport)) => {
            Err(format!("Network error: {}", transport))
        }
    }
}

/// Check if a file is a Microsoft Office format (ZIP-based)
fn is_office_file(filename: &str) -> bool {
    let lower = filename.to_lowercase();
    lower.ends_with(".docx")
        || lower.ends_with(".xlsx")
        || lower.ends_with(".pptx")
        || lower.ends_with(".odt")
        || lower.ends_with(".ods")
        || lower.ends_with(".odp")
}

/// Check if a file is an SVG (XML-based, can be processed as text)
fn is_svg_file(filename: &str) -> bool {
    filename.to_lowercase().ends_with(".svg")
}

/// Check if a file is a Jupyter notebook (JSON format)
fn is_jupyter_notebook(filename: &str) -> bool {
    filename.to_lowercase().ends_with(".ipynb")
}

/// Check if a file is an EPUB (ZIP-based e-book format)
fn is_epub_file(filename: &str) -> bool {
    filename.to_lowercase().ends_with(".epub")
}

/// Check if a file is a PDF
fn is_pdf_file(filename: &str) -> bool {
    filename.to_lowercase().ends_with(".pdf")
}

/// Check if a file is an image that may contain XMP metadata
fn is_image_with_xmp(filename: &str) -> bool {
    let lower = filename.to_lowercase();
    lower.ends_with(".jpg")
        || lower.ends_with(".jpeg")
        || lower.ends_with(".png")
        || lower.ends_with(".tiff")
        || lower.ends_with(".tif")
}

/// Check if a file is an audio file with editable metadata
fn is_audio_with_metadata(filename: &str) -> bool {
    let lower = filename.to_lowercase();
    lower.ends_with(".mp3")
        || lower.ends_with(".flac")
}

/// Check if a file is a SQLite database
fn is_sqlite_database(filename: &str) -> bool {
    let lower = filename.to_lowercase();
    lower.ends_with(".db")
        || lower.ends_with(".sqlite")
        || lower.ends_with(".sqlite3")
}

/// Check if a file is a processable archive
fn is_processable_archive(filename: &str) -> bool {
    let lower = filename.to_lowercase();
    lower.ends_with(".zip")
        || lower.ends_with(".tar")
        || lower.ends_with(".tar.gz")
        || lower.ends_with(".tgz")
}

/// Archive type enum
#[derive(Debug, Clone, Copy)]
enum ArchiveType {
    Zip,
    Tar,
    TarGz,
}

/// Get archive type from filename
fn get_archive_type(filename: &str) -> Option<ArchiveType> {
    let lower = filename.to_lowercase();
    if lower.ends_with(".zip") {
        Some(ArchiveType::Zip)
    } else if lower.ends_with(".tar.gz") || lower.ends_with(".tgz") {
        Some(ArchiveType::TarGz)
    } else if lower.ends_with(".tar") {
        Some(ArchiveType::Tar)
    } else {
        None
    }
}

/// Check if a file is likely text-based (for archive processing)
fn is_text_like_file(filename: &str) -> bool {
    let lower = filename.to_lowercase();
    lower.ends_with(".txt")
        || lower.ends_with(".md")
        || lower.ends_with(".json")
        || lower.ends_with(".xml")
        || lower.ends_with(".html")
        || lower.ends_with(".htm")
        || lower.ends_with(".css")
        || lower.ends_with(".js")
        || lower.ends_with(".ts")
        || lower.ends_with(".py")
        || lower.ends_with(".rs")
        || lower.ends_with(".yaml")
        || lower.ends_with(".yml")
        || lower.ends_with(".toml")
        || lower.ends_with(".ini")
        || lower.ends_with(".cfg")
        || lower.ends_with(".conf")
        || lower.ends_with(".sh")
        || lower.ends_with(".bat")
        || lower.ends_with(".ps1")
        || lower.ends_with(".svg")
        || lower.ends_with(".csv")
}

/// Process a Jupyter notebook by replacing variables in cell contents
fn process_jupyter_notebook(
    content: &str,
    variables: &HashMap<String, String>,
) -> Result<String, String> {
    let mut notebook: serde_json::Value = serde_json::from_str(content)
        .map_err(|e| format!("Invalid Jupyter notebook JSON: {}", e))?;

    // Process cells array
    if let Some(cells) = notebook.get_mut("cells").and_then(|c| c.as_array_mut()) {
        for cell in cells {
            // Replace variables in source array (code/markdown content)
            if let Some(source) = cell.get_mut("source").and_then(|s| s.as_array_mut()) {
                for line in source {
                    if let Some(text) = line.as_str() {
                        let replaced = substitute_variables(text, variables);
                        *line = serde_json::Value::String(replaced);
                    }
                }
            }
            // Also handle source as a single string (some notebooks use this format)
            if let Some(source) = cell.get_mut("source").and_then(|s| s.as_str().map(|t| t.to_string())) {
                let replaced = substitute_variables(&source, variables);
                cell["source"] = serde_json::Value::String(replaced);
            }
        }
    }

    // Also replace variables in metadata if present
    if let Some(metadata) = notebook.get_mut("metadata") {
        let metadata_str = serde_json::to_string(metadata)
            .map_err(|e| format!("Failed to serialize metadata: {}", e))?;
        let replaced = substitute_variables(&metadata_str, variables);
        if let Ok(new_metadata) = serde_json::from_str(&replaced) {
            *metadata = new_metadata;
        }
    }

    serde_json::to_string_pretty(&notebook)
        .map_err(|e| format!("Failed to serialize notebook: {}", e))
}

/// Process an EPUB file by replacing variables in its XHTML/XML content
fn process_epub_file(
    data: &[u8],
    variables: &HashMap<String, String>,
) -> Result<Vec<u8>, String> {
    let cursor = Cursor::new(data);
    let mut archive = ZipArchive::new(cursor)
        .map_err(|e| format!("Failed to open EPUB as ZIP: {}", e))?;

    let mut modified_files: HashMap<String, Vec<u8>> = HashMap::new();

    // First pass: identify and modify content files
    for i in 0..archive.len() {
        let mut file = archive.by_index(i)
            .map_err(|e| format!("Failed to read ZIP entry: {}", e))?;
        let name = file.name().to_string();

        // Process XHTML, HTML, XML, OPF, NCX, CSS files
        let should_modify = name.ends_with(".xhtml")
            || name.ends_with(".html")
            || name.ends_with(".htm")
            || name.ends_with(".xml")
            || name.ends_with(".opf")
            || name.ends_with(".ncx")
            || name.ends_with(".css");

        if should_modify {
            let mut content = String::new();
            if file.read_to_string(&mut content).is_ok() {
                let modified = substitute_variables(&content, variables);
                modified_files.insert(name, modified.into_bytes());
            }
        }
    }

    // Second pass: create new ZIP with modified content
    let mut output = Cursor::new(Vec::new());
    {
        let mut writer = ZipWriter::new(&mut output);
        let options = SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);

        // Re-open archive for reading
        let cursor = Cursor::new(data);
        let mut archive = ZipArchive::new(cursor)
            .map_err(|e| format!("Failed to re-open EPUB: {}", e))?;

        for i in 0..archive.len() {
            let mut file = archive.by_index(i)
                .map_err(|e| format!("Failed to read ZIP entry: {}", e))?;
            let name = file.name().to_string();

            writer.start_file(&name, options)
                .map_err(|e| format!("Failed to start ZIP entry: {}", e))?;

            if let Some(modified_content) = modified_files.get(&name) {
                writer.write_all(modified_content)
                    .map_err(|e| format!("Failed to write modified content: {}", e))?;
            } else {
                let mut content = Vec::new();
                file.read_to_end(&mut content)
                    .map_err(|e| format!("Failed to read original content: {}", e))?;
                writer.write_all(&content)
                    .map_err(|e| format!("Failed to write original content: {}", e))?;
            }
        }

        writer.finish()
            .map_err(|e| format!("Failed to finalize EPUB: {}", e))?;
    }

    Ok(output.into_inner())
}

/// Process a PDF file by replacing variables in metadata and form fields
fn process_pdf_file(
    data: &[u8],
    variables: &HashMap<String, String>,
) -> Result<Vec<u8>, String> {
    use lopdf::{Document, Object};

    let mut doc = Document::load_mem(data)
        .map_err(|e| format!("Failed to load PDF: {}", e))?;

    // Process Info dictionary (Title, Author, Subject, Keywords, Creator, Producer)
    let info_id = doc.trailer.get(b"Info")
        .ok()
        .and_then(|o| o.as_reference().ok());

    if let Some(info_ref) = info_id {
        if let Ok(Object::Dictionary(ref mut dict)) = doc.get_object_mut(info_ref) {
            let metadata_keys: [&[u8]; 6] = [b"Title", b"Author", b"Subject", b"Keywords", b"Creator", b"Producer"];

            for key in metadata_keys {
                if let Ok(Object::String(ref mut value, _format)) = dict.get_mut(key) {
                    let text = String::from_utf8_lossy(value).to_string();
                    let new_text = substitute_variables(&text, variables);
                    if new_text != text {
                        *value = new_text.into_bytes();
                    }
                }
            }
        }
    }

    // Process AcroForm fields if present
    if let Ok(Object::Reference(acroform_ref)) = doc.catalog().and_then(|c| c.get(b"AcroForm")) {
        let acroform_id = *acroform_ref;
        if let Ok(Object::Dictionary(acroform)) = doc.get_object(acroform_id) {
            if let Ok(Object::Array(fields)) = acroform.get(b"Fields") {
                let field_refs: Vec<lopdf::ObjectId> = fields.iter()
                    .filter_map(|f| f.as_reference().ok())
                    .collect();

                for field_ref in field_refs {
                    process_pdf_form_field(&mut doc, field_ref, variables);
                }
            }
        }
    }

    let mut output = Vec::new();
    doc.save_to(&mut output)
        .map_err(|e| format!("Failed to save PDF: {}", e))?;

    Ok(output)
}

/// Recursively process PDF form fields
fn process_pdf_form_field(
    doc: &mut lopdf::Document,
    field_ref: lopdf::ObjectId,
    variables: &HashMap<String, String>,
) {
    use lopdf::Object;

    if let Ok(Object::Dictionary(ref mut field)) = doc.get_object_mut(field_ref) {
        // Process field value (V)
        if let Ok(Object::String(ref mut value, _format)) = field.get_mut(b"V") {
            let text = String::from_utf8_lossy(value).to_string();
            let new_text = substitute_variables(&text, variables);
            if new_text != text {
                *value = new_text.into_bytes();
            }
        }

        // Process default value (DV)
        if let Ok(Object::String(ref mut value, _format)) = field.get_mut(b"DV") {
            let text = String::from_utf8_lossy(value).to_string();
            let new_text = substitute_variables(&text, variables);
            if new_text != text {
                *value = new_text.into_bytes();
            }
        }

        // Get child field references for recursive processing
        let child_refs: Vec<lopdf::ObjectId> = field.get(b"Kids")
            .ok()
            .and_then(|k| k.as_array().ok())
            .map(|kids| kids.iter().filter_map(|k| k.as_reference().ok()).collect())
            .unwrap_or_default();

        // Process children recursively
        for child_ref in child_refs {
            process_pdf_form_field(doc, child_ref, variables);
        }
    }
}

/// Process an image file by replacing variables in XMP metadata
fn process_image_xmp(
    data: &[u8],
    variables: &HashMap<String, String>,
    filename: &str,
) -> Result<Vec<u8>, String> {
    let lower = filename.to_lowercase();

    if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        process_jpeg_xmp(data, variables)
    } else if lower.ends_with(".png") {
        process_png_xmp(data, variables)
    } else {
        // TIFF and other formats: return unchanged for now
        Ok(data.to_vec())
    }
}

/// Process JPEG XMP metadata
/// XMP in JPEG is stored in APP1 segment with "http://ns.adobe.com/xap/1.0/" marker
fn process_jpeg_xmp(
    data: &[u8],
    variables: &HashMap<String, String>,
) -> Result<Vec<u8>, String> {
    // XMP marker in JPEG APP1 segment
    let xmp_marker = b"http://ns.adobe.com/xap/1.0/\0";

    // Find XMP segment
    if let Some(pos) = find_subsequence(data, xmp_marker) {
        let xmp_start = pos + xmp_marker.len();

        // Find the end of the APP1 segment (look for next segment marker 0xFF followed by non-0x00)
        // This is a simplified approach - for full robustness would need to parse JPEG structure
        if let Some(xmp_end) = find_xmp_end(&data[xmp_start..]) {
            let xmp_data = &data[xmp_start..xmp_start + xmp_end];
            let xmp_str = String::from_utf8_lossy(xmp_data);
            let modified_xmp = substitute_variables(&xmp_str, variables);

            if modified_xmp != xmp_str {
                // Reconstruct the file with modified XMP
                let mut output = Vec::new();
                output.extend_from_slice(&data[..xmp_start]);
                output.extend_from_slice(modified_xmp.as_bytes());
                output.extend_from_slice(&data[xmp_start + xmp_end..]);
                return Ok(output);
            }
        }
    }

    Ok(data.to_vec())
}

/// Find subsequence in byte slice
fn find_subsequence(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|window| window == needle)
}

/// Find the end of XMP data (simplified - looks for closing tag)
fn find_xmp_end(data: &[u8]) -> Option<usize> {
    let end_marker = b"</x:xmpmeta>";
    if let Some(pos) = find_subsequence(data, end_marker) {
        return Some(pos + end_marker.len());
    }
    // Alternative ending
    let alt_marker = b"<?xpacket end";
    if let Some(pos) = find_subsequence(data, alt_marker) {
        // Find the closing ?>
        if let Some(close) = find_subsequence(&data[pos..], b"?>") {
            return Some(pos + close + 2);
        }
    }
    None
}

/// Process PNG XMP metadata (stored in iTXt chunk with "XML:com.adobe.xmp" keyword)
fn process_png_xmp(
    data: &[u8],
    variables: &HashMap<String, String>,
) -> Result<Vec<u8>, String> {
    // PNG XMP is stored in iTXt chunk - for simplicity, do raw search and replace
    // Full implementation would parse PNG chunks properly
    let xmp_keyword = b"XML:com.adobe.xmp";

    if let Some(pos) = find_subsequence(data, xmp_keyword) {
        // XMP content follows the keyword
        if let Some(xmp_start_offset) = find_subsequence(&data[pos..], b"<x:xmpmeta") {
            let xmp_start = pos + xmp_start_offset;
            if let Some(xmp_len) = find_xmp_end(&data[xmp_start..]) {
                let xmp_data = &data[xmp_start..xmp_start + xmp_len];
                let xmp_str = String::from_utf8_lossy(xmp_data);
                let modified_xmp = substitute_variables(&xmp_str, variables);

                if modified_xmp != xmp_str {
                    let mut output = Vec::new();
                    output.extend_from_slice(&data[..xmp_start]);
                    output.extend_from_slice(modified_xmp.as_bytes());
                    output.extend_from_slice(&data[xmp_start + xmp_len..]);
                    return Ok(output);
                }
            }
        }
    }

    Ok(data.to_vec())
}

/// Process an audio file by replacing variables in metadata tags
fn process_audio_metadata(
    data: &[u8],
    variables: &HashMap<String, String>,
    filename: &str,
) -> Result<Vec<u8>, String> {
    let lower = filename.to_lowercase();

    if lower.ends_with(".mp3") {
        process_mp3_id3(data, variables)
    } else if lower.ends_with(".flac") {
        process_flac_vorbis(data, variables)
    } else {
        Ok(data.to_vec())
    }
}

/// Process MP3 ID3v2 tags
fn process_mp3_id3(
    data: &[u8],
    variables: &HashMap<String, String>,
) -> Result<Vec<u8>, String> {
    use id3::{Tag, TagLike, Version};

    // Try to read existing tag, or create a new one
    let mut tag = Tag::read_from2(Cursor::new(data))
        .unwrap_or_else(|_| Tag::new());

    let mut modified = false;

    // Process common text frames
    // TIT2 = Title, TPE1 = Artist, TALB = Album, TCON = Genre, TYER = Year
    let frame_ids = ["TIT2", "TPE1", "TALB", "TCON", "TYER", "COMM"];

    for frame_id in frame_ids {
        if let Some(text) = tag.get(frame_id).and_then(|f| f.content().text()) {
            let original = text.to_string();
            let new_text = substitute_variables(&original, variables);
            if new_text != original {
                tag.set_text(frame_id, new_text);
                modified = true;
            }
        }
    }

    if !modified {
        return Ok(data.to_vec());
    }

    // Write modified tag back to the file data
    // ID3 tags are prepended to the MP3 data
    let mut output = Vec::new();
    tag.write_to(&mut output, Version::Id3v24)
        .map_err(|e| format!("Failed to write ID3 tag: {}", e))?;

    // Find where the audio data starts in the original file (skip existing ID3 tag)
    let audio_start = find_mp3_audio_start(data);
    output.extend_from_slice(&data[audio_start..]);

    Ok(output)
}

/// Find where the actual MP3 audio data starts (after any ID3v2 tag)
fn find_mp3_audio_start(data: &[u8]) -> usize {
    // Check for ID3v2 header
    if data.len() >= 10 && &data[0..3] == b"ID3" {
        // ID3v2 size is stored in bytes 6-9 as syncsafe integers
        let size = ((data[6] as usize & 0x7F) << 21)
            | ((data[7] as usize & 0x7F) << 14)
            | ((data[8] as usize & 0x7F) << 7)
            | (data[9] as usize & 0x7F);
        return 10 + size; // 10-byte header + tag size
    }
    0
}

/// Process FLAC Vorbis comments
fn process_flac_vorbis(
    data: &[u8],
    variables: &HashMap<String, String>,
) -> Result<Vec<u8>, String> {
    use metaflac::Tag;

    let mut tag = Tag::read_from(&mut Cursor::new(data))
        .map_err(|e| format!("Failed to read FLAC tag: {}", e))?;

    let mut modified = false;

    // vorbis_comments_mut() returns &mut VorbisComment directly
    let vorbis = tag.vorbis_comments_mut();

    // Get all keys to iterate over
    let keys: Vec<String> = vorbis.comments.keys().cloned().collect();

    for key in keys {
        if let Some(values) = vorbis.comments.get_mut(&key) {
            for value in values.iter_mut() {
                let original = value.clone();
                *value = substitute_variables(value, variables);
                if *value != original {
                    modified = true;
                }
            }
        }
    }

    if !modified {
        return Ok(data.to_vec());
    }

    let mut output = Vec::new();
    tag.write_to(&mut output)
        .map_err(|e| format!("Failed to write FLAC tag: {}", e))?;

    Ok(output)
}

/// Process a SQLite database by replacing variables in text columns
fn process_sqlite_database(
    data: &[u8],
    variables: &HashMap<String, String>,
) -> Result<Vec<u8>, String> {
    use rusqlite::{Connection, OpenFlags};
    use std::io::Read as IoRead;
    use tempfile::NamedTempFile;

    // Write data to temp file (SQLite needs file access)
    let mut temp_file = NamedTempFile::new()
        .map_err(|e| format!("Failed to create temp file: {}", e))?;
    std::io::Write::write_all(&mut temp_file, data)
        .map_err(|e| format!("Failed to write temp file: {}", e))?;

    let conn = Connection::open_with_flags(
        temp_file.path(),
        OpenFlags::SQLITE_OPEN_READ_WRITE,
    ).map_err(|e| format!("Failed to open SQLite database: {}", e))?;

    // Check for _variables config table
    let has_config = conn.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='_variables'")
        .and_then(|mut stmt| stmt.exists([]))
        .unwrap_or(false);

    if has_config {
        process_sqlite_with_config(&conn, variables)?;
    } else {
        // Fallback: scan all text columns for variable patterns
        process_sqlite_scan_all(&conn, variables)?;
    }

    drop(conn);

    // Read back the modified database
    let mut output = Vec::new();
    std::fs::File::open(temp_file.path())
        .and_then(|mut f| f.read_to_end(&mut output))
        .map_err(|e| format!("Failed to read modified database: {}", e))?;

    Ok(output)
}

/// Process SQLite with explicit _variables config table
fn process_sqlite_with_config(
    conn: &rusqlite::Connection,
    variables: &HashMap<String, String>,
) -> Result<(), String> {
    let mut config_stmt = conn.prepare(
        "SELECT table_name, column_name FROM _variables WHERE enabled = 1"
    ).map_err(|e| format!("Failed to query config: {}", e))?;

    let configs: Vec<(String, String)> = config_stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(|e| format!("Config query failed: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    for (table, column) in configs {
        // Validate table and column names to prevent SQL injection
        if !is_valid_sql_identifier(&table) || !is_valid_sql_identifier(&column) {
            continue;
        }

        for (var_name, var_value) in variables {
            let sql = format!(
                "UPDATE \"{}\" SET \"{}\" = REPLACE(\"{}\", ?, ?) WHERE \"{}\" LIKE ?",
                table, column, column, column
            );
            let pattern = format!("%{}%", var_name);
            let _ = conn.execute(&sql, [var_name, var_value, &pattern]);
        }
    }

    Ok(())
}

/// Process SQLite by scanning all TEXT columns
fn process_sqlite_scan_all(
    conn: &rusqlite::Connection,
    variables: &HashMap<String, String>,
) -> Result<(), String> {
    // Get all tables
    let mut tables_stmt = conn.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '_variables'"
    ).map_err(|e| e.to_string())?;

    let tables: Vec<String> = tables_stmt
        .query_map([], |row| row.get(0))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    for table in tables {
        if !is_valid_sql_identifier(&table) {
            continue;
        }

        // Get TEXT columns for this table
        let pragma_sql = format!("PRAGMA table_info(\"{}\")", table);
        let mut cols_stmt = conn.prepare(&pragma_sql).map_err(|e| e.to_string())?;

        let text_columns: Vec<String> = cols_stmt
            .query_map([], |row| {
                let col_type: String = row.get(2)?;
                let col_name: String = row.get(1)?;
                Ok((col_name, col_type))
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .filter(|(_, t)| {
                let upper = t.to_uppercase();
                upper.contains("TEXT") || upper.contains("VARCHAR") || upper.contains("CHAR")
            })
            .map(|(n, _)| n)
            .collect();

        for column in text_columns {
            if !is_valid_sql_identifier(&column) {
                continue;
            }

            for (var_name, var_value) in variables {
                let sql = format!(
                    "UPDATE \"{}\" SET \"{}\" = REPLACE(\"{}\", ?, ?) WHERE \"{}\" LIKE ?",
                    table, column, column, column
                );
                let pattern = format!("%{}%", var_name);
                let _ = conn.execute(&sql, [var_name, var_value, &pattern]);
            }
        }
    }

    Ok(())
}

/// Validate SQL identifier to prevent injection
fn is_valid_sql_identifier(s: &str) -> bool {
    !s.is_empty() && s.chars().all(|c| c.is_alphanumeric() || c == '_')
}

/// Process an archive by recursively processing its contents
fn process_archive(
    data: &[u8],
    variables: &HashMap<String, String>,
    filename: &str,
    depth: usize,
) -> Result<Vec<u8>, String> {
    // Prevent infinite recursion from nested archives
    const MAX_DEPTH: usize = 3;
    if depth > MAX_DEPTH {
        return Ok(data.to_vec());
    }

    match get_archive_type(filename) {
        Some(ArchiveType::Zip) => process_zip_archive(data, variables, depth),
        Some(ArchiveType::TarGz) => process_tar_gz_archive(data, variables, depth),
        Some(ArchiveType::Tar) => process_tar_archive(data, variables, depth),
        None => Ok(data.to_vec()),
    }
}

/// Process a ZIP archive recursively
fn process_zip_archive(
    data: &[u8],
    variables: &HashMap<String, String>,
    depth: usize,
) -> Result<Vec<u8>, String> {
    let cursor = Cursor::new(data);
    let mut archive = ZipArchive::new(cursor)
        .map_err(|e| format!("Failed to open ZIP: {}", e))?;

    let mut modified_files: HashMap<String, Vec<u8>> = HashMap::new();

    // First pass: process each file
    for i in 0..archive.len() {
        let mut file = archive.by_index(i)
            .map_err(|e| format!("Failed to read ZIP entry: {}", e))?;
        let name = file.name().to_string();

        if file.is_dir() {
            continue;
        }

        let mut content = Vec::new();
        file.read_to_end(&mut content)
            .map_err(|e| format!("Failed to read entry content: {}", e))?;

        // Process the file through the appropriate handler
        let processed = process_file_content(&content, variables, &name, depth)?;

        if processed != content {
            modified_files.insert(name, processed);
        }
    }

    // Second pass: create new archive with modifications
    let mut output = Cursor::new(Vec::new());
    {
        let mut writer = ZipWriter::new(&mut output);
        let options = SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);

        let cursor = Cursor::new(data);
        let mut archive = ZipArchive::new(cursor)
            .map_err(|e| format!("Failed to re-open ZIP: {}", e))?;

        for i in 0..archive.len() {
            let mut file = archive.by_index(i)
                .map_err(|e| format!("Failed to read ZIP entry: {}", e))?;
            let name = file.name().to_string();

            if file.is_dir() {
                writer.add_directory(&name, options)
                    .map_err(|e| format!("Failed to add directory: {}", e))?;
            } else {
                writer.start_file(&name, options)
                    .map_err(|e| format!("Failed to start file: {}", e))?;

                if let Some(modified) = modified_files.get(&name) {
                    writer.write_all(modified)
                        .map_err(|e| format!("Failed to write modified: {}", e))?;
                } else {
                    let mut content = Vec::new();
                    file.read_to_end(&mut content)
                        .map_err(|e| format!("Failed to read original: {}", e))?;
                    writer.write_all(&content)
                        .map_err(|e| format!("Failed to write original: {}", e))?;
                }
            }
        }

        writer.finish()
            .map_err(|e| format!("Failed to finalize ZIP: {}", e))?;
    }

    Ok(output.into_inner())
}

/// Process a TAR.GZ archive
fn process_tar_gz_archive(
    data: &[u8],
    variables: &HashMap<String, String>,
    depth: usize,
) -> Result<Vec<u8>, String> {
    use flate2::read::GzDecoder;
    use flate2::write::GzEncoder;
    use flate2::Compression;

    // Decompress
    let decoder = GzDecoder::new(Cursor::new(data));
    let mut decompressed = Vec::new();
    std::io::BufReader::new(decoder).read_to_end(&mut decompressed)
        .map_err(|e| format!("Failed to decompress gzip: {}", e))?;

    // Process tar
    let processed_tar = process_tar_archive(&decompressed, variables, depth)?;

    // Recompress
    let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
    encoder.write_all(&processed_tar)
        .map_err(|e| format!("Failed to compress: {}", e))?;

    encoder.finish()
        .map_err(|e| format!("Failed to finish compression: {}", e))
}

/// Process a TAR archive
fn process_tar_archive(
    data: &[u8],
    variables: &HashMap<String, String>,
    depth: usize,
) -> Result<Vec<u8>, String> {
    use tar::{Archive, Builder, Header};

    let mut archive = Archive::new(Cursor::new(data));
    let mut output = Vec::new();

    // Collect all entries first (since we can't iterate and build simultaneously)
    let mut entries_data: Vec<(String, Vec<u8>, u32, bool)> = Vec::new();

    for entry_result in archive.entries().map_err(|e| format!("Failed to read tar: {}", e))? {
        let mut entry = entry_result.map_err(|e| format!("Failed to read entry: {}", e))?;
        let path = entry.path().map_err(|e| e.to_string())?.to_path_buf();
        let path_str = path.to_string_lossy().to_string();
        let mode = entry.header().mode().unwrap_or(0o644);
        let is_dir = entry.header().entry_type().is_dir();

        let mut content = Vec::new();
        if !is_dir {
            entry.read_to_end(&mut content)
                .map_err(|e| format!("Failed to read entry: {}", e))?;
        }

        entries_data.push((path_str, content, mode, is_dir));
    }

    // Now build the new archive
    {
        let mut builder = Builder::new(&mut output);

        for (path_str, content, mode, is_dir) in entries_data {
            if is_dir {
                let mut header = Header::new_gnu();
                header.set_path(&path_str).map_err(|e| e.to_string())?;
                header.set_size(0);
                header.set_entry_type(tar::EntryType::Directory);
                header.set_mode(mode);
                header.set_cksum();

                builder.append(&header, std::io::empty())
                    .map_err(|e| format!("Failed to append dir: {}", e))?;
            } else {
                let processed = process_file_content(&content, variables, &path_str, depth)?;

                let mut header = Header::new_gnu();
                header.set_path(&path_str).map_err(|e| e.to_string())?;
                header.set_size(processed.len() as u64);
                header.set_mode(mode);
                header.set_cksum();

                builder.append(&header, Cursor::new(processed))
                    .map_err(|e| format!("Failed to append: {}", e))?;
            }
        }

        builder.finish().map_err(|e| format!("Failed to finish tar: {}", e))?;
    }

    Ok(output)
}

/// Route file content through the appropriate processor (for archive processing)
fn process_file_content(
    data: &[u8],
    variables: &HashMap<String, String>,
    filename: &str,
    depth: usize,
) -> Result<Vec<u8>, String> {
    // Nested archives - recursive processing
    if is_processable_archive(filename) {
        return process_archive(data, variables, filename, depth + 1);
    }

    // Binary file types with variable support
    if is_office_file(filename) {
        return process_office_file(data, variables, filename);
    }
    if is_epub_file(filename) {
        return process_epub_file(data, variables);
    }
    if is_pdf_file(filename) {
        return process_pdf_file(data, variables);
    }
    if is_image_with_xmp(filename) {
        return process_image_xmp(data, variables, filename);
    }
    if is_audio_with_metadata(filename) {
        return process_audio_metadata(data, variables, filename);
    }
    if is_sqlite_database(filename) {
        return process_sqlite_database(data, variables);
    }
    if is_jupyter_notebook(filename) {
        if let Ok(text) = String::from_utf8(data.to_vec()) {
            return process_jupyter_notebook(&text, variables)
                .map(|s| s.into_bytes());
        }
    }

    // Text files - simple string replacement
    if is_text_like_file(filename) {
        if let Ok(text) = String::from_utf8(data.to_vec()) {
            let processed = substitute_variables(&text, variables);
            return Ok(processed.into_bytes());
        }
    }

    // Unknown binary files - return unchanged
    Ok(data.to_vec())
}

/// Get the XML files that contain content for each Office format
fn get_content_paths(filename: &str) -> Vec<&'static str> {
    let lower = filename.to_lowercase();
    if lower.ends_with(".docx") {
        vec!["word/document.xml", "word/header1.xml", "word/header2.xml", "word/header3.xml",
             "word/footer1.xml", "word/footer2.xml", "word/footer3.xml"]
    } else if lower.ends_with(".xlsx") {
        vec!["xl/sharedStrings.xml", "xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml",
             "xl/worksheets/sheet3.xml", "xl/worksheets/sheet4.xml", "xl/worksheets/sheet5.xml"]
    } else if lower.ends_with(".pptx") {
        vec!["ppt/slides/slide1.xml", "ppt/slides/slide2.xml", "ppt/slides/slide3.xml",
             "ppt/slides/slide4.xml", "ppt/slides/slide5.xml", "ppt/slides/slide6.xml",
             "ppt/slides/slide7.xml", "ppt/slides/slide8.xml", "ppt/slides/slide9.xml",
             "ppt/slides/slide10.xml"]
    } else if lower.ends_with(".odt") || lower.ends_with(".ods") || lower.ends_with(".odp") {
        vec!["content.xml", "styles.xml"]
    } else {
        vec![]
    }
}

/// Process an Office file by replacing variables in its XML content
fn process_office_file(
    data: &[u8],
    variables: &HashMap<String, String>,
    filename: &str,
) -> Result<Vec<u8>, String> {
    let cursor = Cursor::new(data);
    let mut archive = ZipArchive::new(cursor)
        .map_err(|e| format!("Failed to open Office file as ZIP: {}", e))?;

    let content_paths = get_content_paths(filename);
    let mut modified_files: HashMap<String, Vec<u8>> = HashMap::new();

    // First pass: read and modify content files
    for i in 0..archive.len() {
        let mut file = archive.by_index(i)
            .map_err(|e| format!("Failed to read ZIP entry: {}", e))?;
        let name = file.name().to_string();

        // Check if this is a content file we should modify
        let should_modify = content_paths.iter().any(|p| name == *p)
            || (name.ends_with(".xml") && (
                name.starts_with("word/")
                || name.starts_with("xl/worksheets/")
                || name.starts_with("ppt/slides/")
                || name == "xl/sharedStrings.xml"
                || name == "content.xml"
            ));

        if should_modify {
            let mut content = String::new();
            file.read_to_string(&mut content)
                .map_err(|e| format!("Failed to read XML content: {}", e))?;

            // Replace variables
            let modified = substitute_variables(&content, variables);

            modified_files.insert(name, modified.into_bytes());
        }
    }

    // Second pass: create new ZIP with modified content
    let mut output = Cursor::new(Vec::new());
    {
        let mut writer = ZipWriter::new(&mut output);
        let options = SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);

        // Re-open archive for reading
        let cursor = Cursor::new(data);
        let mut archive = ZipArchive::new(cursor)
            .map_err(|e| format!("Failed to re-open Office file: {}", e))?;

        for i in 0..archive.len() {
            let mut file = archive.by_index(i)
                .map_err(|e| format!("Failed to read ZIP entry: {}", e))?;
            let name = file.name().to_string();

            writer.start_file(&name, options)
                .map_err(|e| format!("Failed to start ZIP entry: {}", e))?;

            if let Some(modified_content) = modified_files.get(&name) {
                // Write modified content
                writer.write_all(modified_content)
                    .map_err(|e| format!("Failed to write modified content: {}", e))?;
            } else {
                // Copy original content
                let mut content = Vec::new();
                file.read_to_end(&mut content)
                    .map_err(|e| format!("Failed to read original content: {}", e))?;
                writer.write_all(&content)
                    .map_err(|e| format!("Failed to write original content: {}", e))?;
            }
        }

        writer.finish()
            .map_err(|e| format!("Failed to finalize ZIP: {}", e))?;
    }

    Ok(output.into_inner())
}

// Template export/import types
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

/// Maximum file size for URL imports (5 MB)
const MAX_IMPORT_FILE_SIZE: u64 = 5 * 1024 * 1024;

/// Download a file from URL with size limit for template imports
fn download_file_with_limit(url: &str, max_size: u64) -> Result<String, String> {
    let response = ureq::get(url)
        .timeout(std::time::Duration::from_secs(30))
        .call()
        .map_err(|e| match e {
            ureq::Error::Status(code, _) => format!("HTTP error {}", code),
            ureq::Error::Transport(t) => format!("Network error: {}", t),
        })?;

    // Check Content-Length if available
    if let Some(content_length) = response.header("Content-Length")
        .and_then(|s| s.parse::<u64>().ok())
    {
        if content_length > max_size {
            return Err(format!(
                "File too large: {} bytes (max {} bytes)",
                content_length, max_size
            ));
        }
    }

    // Read with size limit
    let mut body = String::new();
    let mut reader = response.into_reader().take(max_size + 1);
    reader.read_to_string(&mut body)
        .map_err(|e| format!("Failed to read response: {}", e))?;

    // Check if we hit the limit (read more than max_size)
    if body.len() as u64 > max_size {
        return Err(format!("File too large (max {} bytes)", max_size));
    }

    Ok(body)
}

/// Regex pattern for valid version strings: 1.x or 1.x.y where x,y are digits
fn is_valid_version(version: &str) -> bool {
    // Must start with "1." followed by one or more digits, optionally followed by ".digits"
    let bytes = version.as_bytes();
    if bytes.len() < 3 || bytes[0] != b'1' || bytes[1] != b'.' {
        return false;
    }

    let rest = &version[2..];
    let mut has_digit = false;
    let mut seen_dot = false;

    for (i, c) in rest.chars().enumerate() {
        match c {
            '0'..='9' => {
                has_digit = true;
            }
            '.' => {
                if i == 0 || seen_dot {
                    return false; // Leading dot or multiple dots
                }
                seen_dot = true;
                has_digit = false; // Reset for next segment
            }
            _ => return false, // Invalid character
        }
    }

    has_digit // Must end with a digit
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

/// Maximum allowed length for template names
const MAX_TEMPLATE_NAME_LENGTH: usize = 100;

/// Validate a template name for import
fn validate_template_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();

    if trimmed.is_empty() {
        return Err("Template name cannot be empty".to_string());
    }

    if trimmed.len() > MAX_TEMPLATE_NAME_LENGTH {
        return Err(format!(
            "Template name cannot exceed {} characters (got {})",
            MAX_TEMPLATE_NAME_LENGTH,
            trimmed.len()
        ));
    }

    // Check for control characters
    if trimmed.chars().any(|c| c.is_control()) {
        return Err("Template name cannot contain control characters".to_string());
    }

    Ok(trimmed.to_string())
}

// Template commands (Tauri-specific)
#[cfg(feature = "tauri-app")]
pub struct AppState {
    pub db: Database,
    /// Channel sender to stop the file watcher
    pub watch_stop_tx: Option<mpsc::Sender<()>>,
    /// Currently watched file path
    pub watch_path: Option<String>,
}

#[cfg(feature = "tauri-app")]
#[tauri::command]
fn cmd_list_templates(state: State<Mutex<AppState>>) -> Result<Vec<Template>, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    state.db.list_templates().map_err(|e| e.to_string())
}

#[cfg(feature = "tauri-app")]
#[tauri::command]
fn cmd_get_template(state: State<Mutex<AppState>>, id: String) -> Result<Option<Template>, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    state.db.get_template(&id).map_err(|e| e.to_string())
}

#[cfg(feature = "tauri-app")]
#[tauri::command]
fn cmd_create_template(
    state: State<Mutex<AppState>>,
    name: String,
    description: Option<String>,
    schema_xml: String,
    variables: HashMap<String, String>,
    variable_validation: Option<HashMap<String, ValidationRule>>,
    icon_color: Option<String>,
    tags: Option<Vec<String>>,
    wizard_config: Option<serde_json::Value>,
) -> Result<Template, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    state
        .db
        .create_template(CreateTemplateInput {
            name,
            description,
            schema_xml,
            variables,
            variable_validation: variable_validation.unwrap_or_default(),
            icon_color,
            is_favorite: false,
            tags: tags.unwrap_or_default(),
            wizard_config,
        })
        .map_err(|e| e.to_string())
}

#[cfg(feature = "tauri-app")]
#[tauri::command]
fn cmd_update_template(
    state: State<Mutex<AppState>>,
    id: String,
    name: Option<String>,
    description: Option<String>,
    icon_color: Option<String>,
    wizard_config: Option<serde_json::Value>,
) -> Result<Option<Template>, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    state
        .db
        .update_template(
            &id,
            UpdateTemplateInput {
                name,
                description,
                icon_color,
                wizard_config,
            },
        )
        .map_err(|e| e.to_string())
}

#[cfg(feature = "tauri-app")]
#[tauri::command]
fn cmd_delete_template(state: State<Mutex<AppState>>, id: String) -> Result<bool, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    state.db.delete_template(&id).map_err(|e| e.to_string())
}

#[cfg(feature = "tauri-app")]
#[tauri::command]
fn cmd_toggle_favorite(state: State<Mutex<AppState>>, id: String) -> Result<Option<Template>, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    state.db.toggle_favorite(&id).map_err(|e| e.to_string())
}

#[cfg(feature = "tauri-app")]
#[tauri::command]
fn cmd_use_template(state: State<Mutex<AppState>>, id: String) -> Result<Option<Template>, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    state.db.increment_use_count(&id).map_err(|e| e.to_string())?;
    state.db.get_template(&id).map_err(|e| e.to_string())
}

#[cfg(feature = "tauri-app")]
#[tauri::command]
fn cmd_get_all_tags(state: State<Mutex<AppState>>) -> Result<Vec<String>, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    state.db.get_all_tags().map_err(|e| e.to_string())
}

#[cfg(feature = "tauri-app")]
#[tauri::command]
fn cmd_update_template_tags(
    state: State<Mutex<AppState>>,
    id: String,
    tags: Vec<String>,
) -> Result<Option<Template>, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    state.db.update_template_tags(&id, tags).map_err(|e| e.to_string())
}

/// Check if an IPv4 address is private/internal
fn is_private_ipv4(ipv4: &std::net::Ipv4Addr) -> bool {
    ipv4.is_loopback()           // 127.0.0.0/8
        || ipv4.is_private()     // 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
        || ipv4.is_link_local()  // 169.254.0.0/16 (includes cloud metadata 169.254.169.254)
        || ipv4.is_broadcast()   // 255.255.255.255
        || ipv4.is_unspecified() // 0.0.0.0
}

// URL validation for import to prevent SSRF attacks
fn validate_import_url(url: &str) -> Result<(), String> {
    let parsed = url::Url::parse(url)
        .map_err(|e| format!("Invalid URL: {}", e))?;

    // Only allow HTTPS - provides protection against DNS rebinding via certificate validation
    // and prevents MITM attacks on template downloads
    match parsed.scheme() {
        "https" => {}
        "http" => return Err("HTTP is not allowed for security reasons. Please use HTTPS.".to_string()),
        scheme => return Err(format!("URL scheme '{}' is not allowed. Use HTTPS.", scheme)),
    }

    // Block access to private/internal networks
    match parsed.host() {
        Some(url::Host::Domain(domain)) => {
            let domain_lower = domain.to_lowercase();

            // Block localhost
            if domain_lower == "localhost" {
                return Err("Access to localhost is not allowed".to_string());
            }

            // Block common internal hostnames
            if domain_lower == "internal" || domain_lower.ends_with(".local") || domain_lower.ends_with(".internal") {
                return Err("Access to internal network hosts is not allowed".to_string());
            }
        }
        Some(url::Host::Ipv4(ipv4)) => {
            if is_private_ipv4(&ipv4) {
                return Err(format!("Access to private/internal IP address '{}' is not allowed", ipv4));
            }
        }
        Some(url::Host::Ipv6(ipv6)) => {
            let segments = ipv6.segments();
            let is_loopback = ipv6.is_loopback();           // ::1
            let is_unspecified = ipv6.is_unspecified();     // ::
            let is_unique_local = (segments[0] & 0xfe00) == 0xfc00;  // fc00::/7
            let is_link_local = (segments[0] & 0xffc0) == 0xfe80;    // fe80::/10

            // Check for IPv4-mapped IPv6 addresses (::ffff:x.x.x.x)
            // These could bypass IPv4 private range checks
            let is_ipv4_mapped = segments[0..5].iter().all(|&s| s == 0) && segments[5] == 0xffff;
            if is_ipv4_mapped {
                let ipv4 = std::net::Ipv4Addr::new(
                    (segments[6] >> 8) as u8,
                    segments[6] as u8,
                    (segments[7] >> 8) as u8,
                    segments[7] as u8,
                );
                if is_private_ipv4(&ipv4) {
                    return Err(format!("Access to private/internal IP address '{}' is not allowed", ipv6));
                }
            }

            if is_loopback || is_unspecified || is_unique_local || is_link_local {
                return Err(format!("Access to private/internal IP address '{}' is not allowed", ipv6));
            }
        }
        None => {
            return Err("URL must have a valid host".to_string());
        }
    }

    Ok(())
}

// Shared import logic used by both JSON and URL import commands
fn import_templates_from_json_internal(
    db: &crate::database::Database,
    json_content: &str,
    duplicate_strategy: DuplicateStrategy,
    include_variables: bool,
) -> Result<ImportResult, String> {
    let export_file: TemplateExportFile = serde_json::from_str(json_content)
        .map_err(|e| format!("Invalid .sct file format: {}", e))?;

    // Validate version using strict validation
    if !is_valid_version(&export_file.version) {
        return Err(format!("Unsupported file version: '{}'. Expected format: 1.x (e.g., 1.0)", export_file.version));
    }

    // Collect templates to import based on file type (now using enum)
    let templates_to_import: Vec<TemplateExport> = match export_file.file_type {
        ExportFileType::Template => {
            export_file.template
                .map(|t| vec![t])
                .ok_or_else(|| "Missing template data in single-template export".to_string())?
        }
        ExportFileType::TemplateBundle => {
            export_file.templates
                .ok_or_else(|| "Missing templates array in bundle export".to_string())?
        }
    };

    let mut result = ImportResult {
        imported: Vec::new(),
        skipped: Vec::new(),
        errors: Vec::new(),
    };

    for template_export in templates_to_import {
        // Validate template name
        let validated_name = match validate_template_name(&template_export.name) {
            Ok(name) => name,
            Err(e) => {
                result.errors.push(format!("Invalid template '{}': {}", template_export.name, e));
                continue;
            }
        };

        // Check for duplicate (use validated/trimmed name)
        let existing = db.get_template_by_name(&validated_name)
            .map_err(|e| e.to_string())?;

        let final_name = if existing.is_some() {
            match duplicate_strategy {
                DuplicateStrategy::Skip => {
                    result.skipped.push(validated_name.clone());
                    continue;
                }
                DuplicateStrategy::Replace => {
                    // Delete existing template
                    if let Err(e) = db.delete_template_by_name(&validated_name) {
                        result.errors.push(format!("Failed to replace '{}': {}", validated_name, e));
                        continue;
                    }
                    validated_name.clone()
                }
                DuplicateStrategy::Rename => {
                    match db.generate_unique_template_name(&validated_name) {
                        Ok(name) => name,
                        Err(e) => {
                            result.errors.push(format!("Failed to generate unique name for '{}': {}", validated_name, e));
                            continue;
                        }
                    }
                }
            }
        } else {
            validated_name.clone()
        };

        // Validate schema XML before importing
        if let Err(e) = crate::schema::parse_xml_schema(&template_export.schema_xml) {
            result.errors.push(format!("Invalid schema in '{}': {}", validated_name, e));
            continue;
        }

        // Determine variables and validation to use
        let (variables, variable_validation) = if include_variables {
            (template_export.variables.unwrap_or_default(), template_export.variable_validation)
        } else {
            (HashMap::new(), HashMap::new())
        };

        // Create the template
        let input = CreateTemplateInput {
            name: final_name.clone(),
            description: template_export.description,
            schema_xml: template_export.schema_xml,
            variables,
            variable_validation,
            icon_color: template_export.icon_color,
            is_favorite: false,
            tags: template_export.tags,
            wizard_config: template_export.wizard_config,
        };

        match db.create_template(input) {
            Ok(_) => result.imported.push(final_name),
            Err(e) => result.errors.push(format!("Failed to import '{}': {}", final_name, e)),
        }
    }

    Ok(result)
}

// Template export/import commands
#[cfg(feature = "tauri-app")]
#[tauri::command]
fn cmd_export_template(
    state: State<Mutex<AppState>>,
    template_id: String,
    include_variables: bool,
) -> Result<String, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    let template = state.db.get_template(&template_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Template not found: {}", template_id))?;

    let export = TemplateExport {
        name: template.name,
        description: template.description,
        schema_xml: template.schema_xml,
        variables: if include_variables { Some(template.variables) } else { None },
        variable_validation: if include_variables { template.variable_validation } else { HashMap::new() },
        icon_color: template.icon_color,
        tags: template.tags,
        wizard_config: template.wizard_config,
    };

    let export_file = TemplateExportFile {
        version: "1.0".to_string(),
        file_type: ExportFileType::Template,
        exported_at: chrono::Utc::now().to_rfc3339(),
        template: Some(export),
        templates: None,
    };

    serde_json::to_string_pretty(&export_file)
        .map_err(|e| format!("Failed to serialize export: {}", e))
}

#[cfg(feature = "tauri-app")]
#[tauri::command]
fn cmd_export_templates_bulk(
    state: State<Mutex<AppState>>,
    template_ids: Vec<String>,
    include_variables: bool,
) -> Result<String, String> {
    let state = state.lock().map_err(|e| e.to_string())?;

    // If no IDs provided, export all templates
    let templates = if template_ids.is_empty() {
        state.db.list_templates().map_err(|e| e.to_string())?
    } else {
        let mut result = Vec::new();
        for id in &template_ids {
            if let Some(t) = state.db.get_template(id).map_err(|e| e.to_string())? {
                result.push(t);
            }
        }
        result
    };

    let exports: Vec<TemplateExport> = templates
        .into_iter()
        .map(|t| TemplateExport {
            name: t.name,
            description: t.description,
            schema_xml: t.schema_xml,
            variables: if include_variables { Some(t.variables) } else { None },
            variable_validation: if include_variables { t.variable_validation } else { HashMap::new() },
            icon_color: t.icon_color,
            tags: t.tags,
            wizard_config: t.wizard_config,
        })
        .collect();

    let export_file = TemplateExportFile {
        version: "1.0".to_string(),
        file_type: ExportFileType::TemplateBundle,
        exported_at: chrono::Utc::now().to_rfc3339(),
        template: None,
        templates: Some(exports),
    };

    serde_json::to_string_pretty(&export_file)
        .map_err(|e| format!("Failed to serialize export: {}", e))
}

#[cfg(feature = "tauri-app")]
#[tauri::command]
fn cmd_import_templates_from_json(
    state: State<Mutex<AppState>>,
    json_content: String,
    duplicate_strategy: DuplicateStrategy,
    include_variables: bool,
) -> Result<ImportResult, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    import_templates_from_json_internal(&state.db, &json_content, duplicate_strategy, include_variables)
}

#[cfg(feature = "tauri-app")]
#[tauri::command]
fn cmd_import_templates_from_url(
    url: String,
    state: State<Mutex<AppState>>,
    duplicate_strategy: DuplicateStrategy,
    include_variables: bool,
) -> Result<ImportResult, String> {
    // Validate URL to prevent SSRF attacks
    validate_import_url(&url)?;

    // Download the .sct file with size limit
    let json_content = download_file_with_limit(&url, MAX_IMPORT_FILE_SIZE)?;

    // Reuse the shared import logic
    let state = state.lock().map_err(|e| e.to_string())?;
    import_templates_from_json_internal(&state.db, &json_content, duplicate_strategy, include_variables)
}

// Settings commands
#[cfg(feature = "tauri-app")]
#[tauri::command]
fn cmd_get_settings(state: State<Mutex<AppState>>) -> Result<std::collections::HashMap<String, String>, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    state.db.get_all_settings().map_err(|e| e.to_string())
}

#[cfg(feature = "tauri-app")]
#[tauri::command]
fn cmd_set_setting(state: State<Mutex<AppState>>, key: String, value: String) -> Result<(), String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    state.db.set_setting(&key, &value).map_err(|e| e.to_string())
}

// Recent Projects commands

#[cfg(feature = "tauri-app")]
#[tauri::command]
fn cmd_list_recent_projects(state: State<Mutex<AppState>>) -> Result<Vec<RecentProject>, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    state.db.list_recent_projects().map_err(|e| e.to_string())
}

#[cfg(feature = "tauri-app")]
#[tauri::command]
fn cmd_get_recent_project(state: State<Mutex<AppState>>, id: String) -> Result<Option<RecentProject>, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    state.db.get_recent_project(&id).map_err(|e| e.to_string())
}

#[cfg(feature = "tauri-app")]
#[tauri::command]
fn cmd_add_recent_project(
    state: State<Mutex<AppState>>,
    project_name: String,
    output_path: String,
    schema_xml: String,
    variables: std::collections::HashMap<String, String>,
    variable_validation: std::collections::HashMap<String, ValidationRule>,
    template_id: Option<String>,
    template_name: Option<String>,
    folders_created: i32,
    files_created: i32,
) -> Result<RecentProject, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    state.db.add_recent_project(CreateRecentProjectInput {
        project_name,
        output_path,
        schema_xml,
        variables,
        variable_validation,
        template_id,
        template_name,
        folders_created,
        files_created,
    }).map_err(|e| e.to_string())
}

#[cfg(feature = "tauri-app")]
#[tauri::command]
fn cmd_delete_recent_project(state: State<Mutex<AppState>>, id: String) -> Result<bool, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    state.db.delete_recent_project(&id).map_err(|e| e.to_string())
}

#[cfg(feature = "tauri-app")]
#[tauri::command]
fn cmd_clear_recent_projects(state: State<Mutex<AppState>>) -> Result<usize, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    state.db.clear_recent_projects().map_err(|e| e.to_string())
}

// ============================================================================
// Watch Mode Commands
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

/// Start watching a schema file for changes
#[cfg(feature = "tauri-app")]
#[tauri::command]
fn cmd_start_watch(
    app: tauri::AppHandle,
    state: State<Mutex<AppState>>,
    path: String,
) -> Result<(), String> {
    let mut state_guard = state.lock().map_err(|e| e.to_string())?;

    // Stop any existing watcher first
    if let Some(tx) = state_guard.watch_stop_tx.take() {
        let _ = tx.send(());
    }

    // Validate the path exists and is a file
    let watch_path = PathBuf::from(&path);
    if !watch_path.exists() {
        return Err(format!("File does not exist: {}", path));
    }
    if !watch_path.is_file() {
        return Err(format!("Path is not a file: {}", path));
    }

    // Create a channel to stop the watcher
    let (stop_tx, stop_rx) = mpsc::channel::<()>();

    // Store the watcher state
    state_guard.watch_stop_tx = Some(stop_tx);
    state_guard.watch_path = Some(path.clone());

    // Get the parent directory to watch (notify doesn't always work well watching single files)
    let watch_dir = watch_path.parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| watch_path.clone());
    let file_name = watch_path.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();

    // Clone values for the watcher thread
    let app_handle = app.clone();
    let watched_path = path.clone();
    let watched_file_name = file_name;

    // Spawn a thread to run the file watcher
    std::thread::spawn(move || {
        // Create a debounced watcher with 500ms delay to avoid rapid-fire events
        let (tx, rx) = std::sync::mpsc::channel();

        let mut debouncer = match new_debouncer(Duration::from_millis(500), tx) {
            Ok(d) => d,
            Err(e) => {
                let _ = app_handle.emit("watch-error", WatchErrorPayload {
                    error: format!("Failed to create file watcher: {}", e),
                });
                return;
            }
        };

        // Start watching the directory
        if let Err(e) = debouncer.watcher().watch(&watch_dir, RecursiveMode::NonRecursive) {
            let _ = app_handle.emit("watch-error", WatchErrorPayload {
                error: format!("Failed to watch directory: {}", e),
            });
            return;
        }

        loop {
            // Check if we should stop
            if stop_rx.try_recv().is_ok() {
                break;
            }

            // Check for file change events with a timeout
            match rx.recv_timeout(Duration::from_millis(100)) {
                Ok(result) => {
                    match result {
                        Ok(events) => {
                            // Check if any event is for our watched file
                            let relevant_event = events.iter().any(|event| {
                                event.path.file_name()
                                    .map(|n| n.to_string_lossy() == watched_file_name)
                                    .unwrap_or(false)
                            });

                            if relevant_event {
                                // Read the file content
                                match std::fs::read_to_string(&watched_path) {
                                    Ok(content) => {
                                        let _ = app_handle.emit("schema-file-changed", SchemaFileChangedPayload {
                                            path: watched_path.clone(),
                                            content,
                                        });
                                    }
                                    Err(e) => {
                                        let _ = app_handle.emit("watch-error", WatchErrorPayload {
                                            error: format!("Failed to read file: {}", e),
                                        });
                                    }
                                }
                            }
                        }
                        Err(e) => {
                            let _ = app_handle.emit("watch-error", WatchErrorPayload {
                                error: format!("Watch error: {:?}", e),
                            });
                        }
                    }
                }
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                    // Continue the loop
                }
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                    // Watcher disconnected, exit the loop
                    break;
                }
            }
        }
    });

    Ok(())
}

/// Stop watching the schema file
#[cfg(feature = "tauri-app")]
#[tauri::command]
fn cmd_stop_watch(state: State<Mutex<AppState>>) -> Result<(), String> {
    let mut state_guard = state.lock().map_err(|e| e.to_string())?;

    // Send stop signal to the watcher thread
    if let Some(tx) = state_guard.watch_stop_tx.take() {
        let _ = tx.send(());
    }

    state_guard.watch_path = None;

    Ok(())
}

/// Get the currently watched path (if any)
#[cfg(feature = "tauri-app")]
#[tauri::command]
fn cmd_get_watch_status(state: State<Mutex<AppState>>) -> Result<Option<String>, String> {
    let state_guard = state.lock().map_err(|e| e.to_string())?;
    Ok(state_guard.watch_path.clone())
}

/// Strip % delimiters from variable name for user-friendly display
fn display_var_name(name: &str) -> &str {
    name.trim_start_matches('%').trim_end_matches('%')
}

/// Maximum allowed length for regex patterns to prevent DoS via complex patterns
const MAX_REGEX_PATTERN_LENGTH: usize = 1000;

/// Error type for regex pattern compilation failures
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PatternError {
    TooLong,
    InvalidRegex,
}

/// Validate variables against their validation rules.
///
/// Returns a list of validation errors sorted by variable name for consistent ordering.
/// Pre-compiles regex patterns for efficiency when validating multiple variables.
pub fn validate_variables(
    variables: &HashMap<String, String>,
    rules: &HashMap<String, ValidationRule>,
) -> Vec<ValidationError> {
    let mut errors = Vec::new();

    // Pre-compile all regex patterns to avoid recompilation on each validation
    // Patterns exceeding MAX_REGEX_PATTERN_LENGTH are treated as invalid
    let compiled_patterns: HashMap<&String, Result<Regex, PatternError>> = rules
        .iter()
        .filter_map(|(name, rule)| {
            rule.pattern.as_ref().map(|pattern| {
                if pattern.len() > MAX_REGEX_PATTERN_LENGTH {
                    (name, Err(PatternError::TooLong))
                } else {
                    (name, Regex::new(pattern).map_err(|_| PatternError::InvalidRegex))
                }
            })
        })
        .collect();

    // Sort rules by name for deterministic error ordering
    let mut sorted_rules: Vec<_> = rules.iter().collect();
    sorted_rules.sort_by(|a, b| a.0.cmp(b.0));

    for (name, rule) in sorted_rules {
        let value = variables.get(name).map(|s| s.as_str()).unwrap_or("");
        // Use clean display name (without % delimiters) for both variable_name and messages
        let display_name = display_var_name(name).to_string();

        // Validate rule sanity: min_length should not exceed max_length
        if let (Some(min), Some(max)) = (rule.min_length, rule.max_length) {
            if min > max {
                errors.push(ValidationError {
                    variable_name: display_name.clone(),
                    message: format!("Invalid rule for {}: min length ({}) exceeds max length ({})", display_name, min, max),
                });
                continue;
            }
        }

        if rule.required && value.is_empty() {
            errors.push(ValidationError {
                variable_name: display_name.clone(),
                message: format!("{} is required", display_name),
            });
            continue;
        }

        if !value.is_empty() {
            // Use chars().count() for proper Unicode character counting
            let char_count = value.chars().count();

            if let Some(min) = rule.min_length {
                if char_count < min {
                    errors.push(ValidationError {
                        variable_name: display_name.clone(),
                        message: format!("{} must be at least {} characters", display_name, min),
                    });
                }
            }

            if let Some(max) = rule.max_length {
                if char_count > max {
                    errors.push(ValidationError {
                        variable_name: display_name.clone(),
                        message: format!("{} must be at most {} characters", display_name, max),
                    });
                }
            }

            // Use pre-compiled regex pattern
            if let Some(compiled_result) = compiled_patterns.get(name) {
                match compiled_result {
                    Ok(re) => {
                        if !re.is_match(value) {
                            errors.push(ValidationError {
                                variable_name: display_name.clone(),
                                message: format!("{} does not match required pattern", display_name),
                            });
                        }
                    }
                    Err(PatternError::TooLong) => {
                        errors.push(ValidationError {
                            variable_name: display_name.clone(),
                            message: format!("Regex pattern for {} exceeds maximum length of {} characters", display_name, MAX_REGEX_PATTERN_LENGTH),
                        });
                    }
                    Err(PatternError::InvalidRegex) => {
                        errors.push(ValidationError {
                            variable_name: display_name.clone(),
                            message: format!("Invalid regex pattern for {}", display_name),
                        });
                    }
                }
            }
        }
    }

    errors
}

#[cfg(feature = "tauri-app")]
#[tauri::command]
fn cmd_validate_variables(
    variables: HashMap<String, String>,
    rules: HashMap<String, ValidationRule>,
) -> Result<Vec<ValidationError>, String> {
    Ok(validate_variables(&variables, &rules))
}

#[cfg(feature = "tauri-app")]
#[tauri::command]
fn cmd_validate_schema(
    state: State<Mutex<AppState>>,
    content: String,
    variables: HashMap<String, String>,
) -> Result<SchemaValidationResult, String> {
    let state_guard = state.lock().map_err(|e| e.to_string())?;

    // Create a template loader closure that looks up templates from the database
    let loader = |name: &str| -> Option<TemplateData> {
        state_guard
            .db
            .get_template_by_name(name)
            .ok()
            .flatten()
            .map(|t| TemplateData {
                schema_xml: t.schema_xml,
                variables: t.variables,
                variable_validation: t.variable_validation
                    .into_iter()
                    .map(|(k, v)| (k, v.into()))
                    .collect(),
            })
    };

    Ok(validate_schema(&content, &variables, Some(&loader)))
}

// ============================================================================
// Diff Preview Implementation
// ============================================================================

/// Maximum content size to include in diff preview (characters)
const MAX_DIFF_CONTENT_SIZE: usize = 50000;
/// Maximum number of lines to show in diff
const MAX_DIFF_LINES: usize = 1000;
/// Maximum iterations for repeat blocks in diff preview
const MAX_REPEAT_ITERATIONS: usize = 100;
/// Maximum characters to show for condition values in if block names
const MAX_CONDITION_DISPLAY_LEN: usize = 20;
/// Truncated display length (leaving room for "...")
const TRUNCATED_CONDITION_LEN: usize = 17;
/// Sample size for binary content detection (8KB)
const BINARY_SAMPLE_SIZE: usize = 8192;
/// Threshold percentage for binary detection (if >10% non-printable, treat as binary)
const BINARY_THRESHOLD_DIVISOR: usize = 10;

/// Check if content appears to be binary (contains null bytes or high ratio of non-text bytes)
fn is_binary_content(content: &[u8]) -> bool {
    let sample_size = content.len().min(BINARY_SAMPLE_SIZE);
    let sample = &content[..sample_size];

    // Check for null bytes (common in binary files)
    if sample.contains(&0) {
        return true;
    }

    // Check ratio of non-printable characters (excluding common whitespace)
    let non_printable = sample.iter()
        .filter(|&&b| b < 0x20 && b != b'\n' && b != b'\r' && b != b'\t')
        .count();

    non_printable > sample_size / BINARY_THRESHOLD_DIVISOR
}

/// Truncate a string at a safe UTF-8 boundary
fn truncate_utf8(s: &str, max_chars: usize) -> String {
    if s.chars().count() <= max_chars {
        return s.to_string();
    }
    let truncated: String = s.chars().take(max_chars).collect();
    format!("{}... (truncated)", truncated)
}

/// Compute unified diff between old and new content
fn compute_diff(old_content: &str, new_content: &str) -> Vec<DiffHunk> {
    use similar::{ChangeTag, TextDiff};

    let diff = TextDiff::from_lines(old_content, new_content);
    let mut hunks = Vec::new();
    let mut total_lines = 0;

    'groups: for group in diff.grouped_ops(3) {
        let mut lines = Vec::new();
        let mut old_start = 0;
        let mut old_count = 0;
        let mut new_start = 0;
        let mut new_count = 0;
        let mut first = true;

        for op in group {
            for change in diff.iter_changes(&op) {
                // Check limit before adding more lines
                if total_lines >= MAX_DIFF_LINES {
                    lines.push(DiffLine {
                        line_type: DiffLineType::Truncated,
                        content: "... (diff truncated)".to_string(),
                    });
                    // Push current hunk and exit all loops
                    if !lines.is_empty() {
                        hunks.push(DiffHunk {
                            old_start,
                            old_count,
                            new_start,
                            new_count,
                            lines,
                        });
                    }
                    break 'groups;
                }

                if first {
                    old_start = change.old_index().map(|i| i + 1).unwrap_or(1);
                    new_start = change.new_index().map(|i| i + 1).unwrap_or(1);
                    first = false;
                }

                let line_type = match change.tag() {
                    ChangeTag::Delete => {
                        old_count += 1;
                        DiffLineType::Remove
                    }
                    ChangeTag::Insert => {
                        new_count += 1;
                        DiffLineType::Add
                    }
                    ChangeTag::Equal => {
                        old_count += 1;
                        new_count += 1;
                        DiffLineType::Context
                    }
                };

                lines.push(DiffLine {
                    line_type,
                    content: change.value().to_string(),
                });
                total_lines += 1;
            }
        }

        if !lines.is_empty() {
            hunks.push(DiffHunk {
                old_start,
                old_count,
                new_start,
                new_count,
                lines,
            });
        }
    }

    hunks
}

/// Generate a unique ID for diff nodes
fn generate_diff_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

/// Check if a variable value is considered "truthy" for conditional evaluation
/// Returns the resolved value along with the truthiness result
fn check_var_truthy(var_name: &str, variables: &HashMap<String, String>) -> (bool, String) {
    let var_key = format!("%{}%", var_name);
    let value = variables.get(&var_key)
        .or_else(|| variables.get(var_name))
        .cloned()
        .unwrap_or_default();
    let is_truthy = !value.is_empty() && value != "0" && value.to_lowercase() != "false";
    (is_truthy, value)
}

/// Recursively generate diff nodes for the schema tree
fn generate_diff_node(
    node: &SchemaNode,
    current_path: &PathBuf,
    variables: &HashMap<String, String>,
    overwrite: bool,
    summary: &mut DiffSummary,
) -> Result<Option<DiffNode>, String> {
    let schema_node_type = &node.node_type;

    // Handle control flow nodes (if, else, repeat)
    // NOTE: "if" and "else" cases here are fallbacks for edge cases (e.g., if the root node
    // is an "if" block). In normal operation, process_diff_children handles these inline
    // to properly track if/else pairing context.
    match schema_node_type.as_str() {
        "if" => {
            // Fallback handler for "if" nodes not processed by process_diff_children
            let var_name = node.condition_var.as_deref().unwrap_or("CONDITION");
            let (is_truthy, resolved_value) = check_var_truthy(var_name, variables);

            if is_truthy {
                let children = process_diff_children(node, current_path, variables, overwrite, summary)?;
                if children.is_empty() {
                    return Ok(None);
                }
                let display_value = if resolved_value.chars().count() > MAX_CONDITION_DISPLAY_LEN {
                    format!("{}...", resolved_value.chars().take(TRUNCATED_CONDITION_LEN).collect::<String>())
                } else {
                    resolved_value
                };
                return Ok(Some(DiffNode {
                    id: generate_diff_id(),
                    node_type: DiffNodeType::Folder,
                    name: format!("if {} ({})", var_name, display_value),
                    path: current_path.to_string_lossy().to_string(),
                    action: DiffAction::Unchanged,
                    existing_content: None,
                    new_content: None,
                    diff_hunks: None,
                    url: None,
                    is_binary: false,
                    children: Some(children),
                }));
            }
            return Ok(None);
        }
        "else" => {
            // Fallback: else blocks without context are skipped (proper handling is in process_diff_children)
            return Ok(None);
        }
        "repeat" => {
            // Expand repeat blocks
            let count_str = node.repeat_count.as_deref().unwrap_or("1");
            let resolved_count_str = substitute_variables(count_str, variables);
            let count = match resolved_count_str.parse::<usize>() {
                Ok(n) => {
                    if n > MAX_REPEAT_ITERATIONS {
                        summary.warnings.push(format!(
                            "Repeat count {} exceeds maximum ({}), clamped to {}",
                            n, MAX_REPEAT_ITERATIONS, MAX_REPEAT_ITERATIONS
                        ));
                    }
                    n.min(MAX_REPEAT_ITERATIONS)
                }
                Err(_) => {
                    summary.warnings.push(format!(
                        "Invalid repeat count '{}' (resolved from '{}'), defaulting to 1",
                        resolved_count_str, count_str
                    ));
                    1
                }
            };

            let as_var = node.repeat_as.as_deref().unwrap_or("i");
            let mut all_children = Vec::new();

            for i in 0..count {
                // Create iteration variables
                let mut iter_vars = variables.clone();
                iter_vars.insert(format!("%{}%", as_var), i.to_string());
                iter_vars.insert(format!("%{}_1%", as_var), (i + 1).to_string());

                // Use process_diff_children to properly handle if/else pairs
                let iteration_children = process_diff_children(node, current_path, &iter_vars, overwrite, summary)?;
                all_children.extend(iteration_children);
            }

            if all_children.is_empty() {
                return Ok(None);
            }

            return Ok(Some(DiffNode {
                id: generate_diff_id(),
                node_type: DiffNodeType::Folder,
                name: format!("repeat {} as {}", count, as_var),
                path: current_path.to_string_lossy().to_string(),
                action: DiffAction::Unchanged,
                existing_content: None,
                new_content: None,
                diff_hunks: None,
                url: None,
                is_binary: false,
                children: Some(all_children),
            }));
        }
        _ => {}
    }

    // Apply variable substitution to name
    let resolved_name = substitute_variables(&node.name, variables);
    let node_path = current_path.join(&resolved_name);

    // Check if path exists, handling potential errors gracefully
    let exists = node_path.try_exists().unwrap_or(false);

    match schema_node_type.as_str() {
        "folder" => {
            let children = process_diff_children(node, &node_path, variables, overwrite, summary)?;

            let action = if exists {
                summary.unchanged_folders += 1;
                DiffAction::Unchanged
            } else {
                summary.creates += 1;
                DiffAction::Create
            };

            Ok(Some(DiffNode {
                id: generate_diff_id(),
                node_type: DiffNodeType::Folder,
                name: resolved_name,
                path: node_path.to_string_lossy().to_string(),
                action,
                existing_content: None,
                new_content: None,
                diff_hunks: None,
                url: None,
                is_binary: false,
                children: if children.is_empty() { None } else { Some(children) },
            }))
        }
        "file" => {
            let action = if exists {
                if overwrite {
                    summary.overwrites += 1;
                    DiffAction::Overwrite
                } else {
                    summary.skips += 1;
                    DiffAction::Skip
                }
            } else {
                summary.creates += 1;
                DiffAction::Create
            };

            // Get new content (using safe UTF-8 truncation)
            let new_content = if let Some(url) = &node.url {
                Some(format!("[Content from URL: {}]", url))
            } else if let Some(content) = &node.content {
                let resolved = substitute_variables(content, variables);
                Some(truncate_utf8(&resolved, MAX_DIFF_CONTENT_SIZE))
            } else {
                None
            };

            // Get existing content and compute diff if overwriting
            let (existing_content, diff_hunks, is_binary) = if action == DiffAction::Overwrite {
                match fs::read(&node_path) {
                    Ok(bytes) => {
                        if is_binary_content(&bytes) {
                            (None, None, true)
                        } else {
                            let existing = String::from_utf8_lossy(&bytes);
                            let existing_str = truncate_utf8(&existing, MAX_DIFF_CONTENT_SIZE);

                            let hunks = if let Some(ref new) = new_content {
                                if !new.starts_with("[Content from URL:") {
                                    Some(compute_diff(&existing_str, new))
                                } else {
                                    None
                                }
                            } else {
                                None
                            };

                            (Some(existing_str), hunks, false)
                        }
                    }
                    Err(_) => (None, None, false)
                }
            } else {
                (None, None, false)
            };

            Ok(Some(DiffNode {
                id: generate_diff_id(),
                node_type: DiffNodeType::File,
                name: resolved_name,
                path: node_path.to_string_lossy().to_string(),
                action,
                existing_content,
                new_content,
                diff_hunks,
                url: node.url.clone(),
                is_binary,
                children: None,
            }))
        }
        _ => Ok(None)
    }
}

/// Process children of a node, handling if/else conditional pairs correctly.
///
/// The if/else handling works as follows:
/// 1. When we encounter an "if" node, we check its condition
/// 2. If truthy, we process its children and set skip_next_else=true
/// 3. If falsy, we skip its children and set skip_next_else=false
/// 4. When we encounter an "else" node immediately after, we check skip_next_else
/// 5. The skip flag is reset after processing an else, or when a non-else node
///    follows something other than an if (handles malformed schemas gracefully)
fn process_diff_children(
    node: &SchemaNode,
    current_path: &PathBuf,
    variables: &HashMap<String, String>,
    overwrite: bool,
    summary: &mut DiffSummary,
) -> Result<Vec<DiffNode>, String> {
    let mut children = Vec::new();

    if let Some(node_children) = &node.children {
        let mut skip_next_else = false;
        let mut last_was_if = false;

        for child in node_children {
            // Handle if/else pairs
            if child.node_type == "if" {
                let var_name = child.condition_var.as_deref().unwrap_or("CONDITION");
                let (is_truthy, _) = check_var_truthy(var_name, variables);

                skip_next_else = is_truthy;

                if is_truthy {
                    // Use process_diff_children recursively to properly handle nested if/else pairs
                    let nested_children = process_diff_children(child, current_path, variables, overwrite, summary)?;
                    children.extend(nested_children);
                }
                last_was_if = true;
                continue;
            }

            if child.node_type == "else" {
                if !skip_next_else {
                    // Use process_diff_children recursively to properly handle nested if/else pairs
                    let nested_children = process_diff_children(child, current_path, variables, overwrite, summary)?;
                    children.extend(nested_children);
                }
                skip_next_else = false;
                last_was_if = false;
                continue;
            }

            // Reset skip flag when a non-else node follows a non-if node.
            // This handles edge cases where the schema might have unexpected ordering.
            if !last_was_if {
                skip_next_else = false;
            }
            last_was_if = false;

            if let Some(diff_node) = generate_diff_node(child, current_path, variables, overwrite, summary)? {
                children.push(diff_node);
            }
        }
    }

    Ok(children)
}

/// Generate a diff preview for the schema tree
pub fn generate_diff_preview(
    tree: &SchemaTree,
    output_path: &str,
    variables: &HashMap<String, String>,
    overwrite: bool,
) -> Result<DiffResult, String> {
    let base_path = PathBuf::from(output_path);
    let mut summary = DiffSummary {
        total_items: 0,
        creates: 0,
        overwrites: 0,
        skips: 0,
        unchanged_folders: 0,
        warnings: Vec::new(),
    };

    let root = generate_diff_node(&tree.root, &base_path, variables, overwrite, &mut summary)?
        .ok_or_else(|| "Failed to generate diff for root node".to_string())?;

    // Compute total_items from the individual counts
    summary.total_items = summary.creates + summary.overwrites + summary.skips + summary.unchanged_folders;

    Ok(DiffResult { root, summary })
}

#[cfg(feature = "tauri-app")]
#[tauri::command]
fn cmd_generate_diff_preview(
    tree: SchemaTree,
    output_path: String,
    variables: HashMap<String, String>,
    overwrite: bool,
) -> Result<DiffResult, String> {
    generate_diff_preview(&tree, &output_path, &variables, overwrite)
}

#[cfg(feature = "tauri-app")]
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            // Get app data directory
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("Failed to get app data directory");

            // Initialize database
            let db = Database::new(app_data_dir).expect("Failed to initialize database");

            // Store app state
            app.manage(Mutex::new(AppState {
                db,
                watch_stop_tx: None,
                watch_path: None,
            }));

            // Create native menu
            let handle = app.handle();

            // Settings menu item
            let settings_item = MenuItem::with_id(handle, "settings", "Settings...", true, Some("CmdOrCtrl+,"))?;

            // Check for Updates menu item
            let check_updates_item = MenuItem::with_id(handle, "check_updates", "Check for Updates...", true, None::<&str>)?;

            // App submenu (macOS style)
            let app_submenu = Submenu::with_items(
                handle,
                "Structure Creator",
                true,
                &[
                    &PredefinedMenuItem::about(handle, Some("About Structure Creator"), None)?,
                    &check_updates_item,
                    &PredefinedMenuItem::separator(handle)?,
                    &settings_item,
                    &PredefinedMenuItem::separator(handle)?,
                    &PredefinedMenuItem::services(handle, None)?,
                    &PredefinedMenuItem::separator(handle)?,
                    &PredefinedMenuItem::hide(handle, None)?,
                    &PredefinedMenuItem::hide_others(handle, None)?,
                    &PredefinedMenuItem::show_all(handle, None)?,
                    &PredefinedMenuItem::separator(handle)?,
                    &PredefinedMenuItem::quit(handle, None)?,
                ],
            )?;

            // File submenu
            let new_schema_item = MenuItem::with_id(handle, "new_schema", "New Schema", true, Some("CmdOrCtrl+N"))?;
            let file_submenu = Submenu::with_items(
                handle,
                "File",
                true,
                &[
                    &new_schema_item,
                ],
            )?;

            // Edit submenu
            let edit_submenu = Submenu::with_items(
                handle,
                "Edit",
                true,
                &[
                    &PredefinedMenuItem::undo(handle, None)?,
                    &PredefinedMenuItem::redo(handle, None)?,
                    &PredefinedMenuItem::separator(handle)?,
                    &PredefinedMenuItem::cut(handle, None)?,
                    &PredefinedMenuItem::copy(handle, None)?,
                    &PredefinedMenuItem::paste(handle, None)?,
                    &PredefinedMenuItem::select_all(handle, None)?,
                ],
            )?;

            // Window submenu
            let window_submenu = Submenu::with_items(
                handle,
                "Window",
                true,
                &[
                    &PredefinedMenuItem::minimize(handle, None)?,
                    &PredefinedMenuItem::maximize(handle, None)?,
                    &PredefinedMenuItem::separator(handle)?,
                    &PredefinedMenuItem::close_window(handle, None)?,
                ],
            )?;

            // Build menu
            let menu = Menu::with_items(
                handle,
                &[&app_submenu, &file_submenu, &edit_submenu, &window_submenu],
            )?;

            app.set_menu(menu)?;

            // Handle menu events
            app.on_menu_event(move |app_handle, event| {
                match event.id().as_ref() {
                    "settings" => {
                        let _ = app_handle.emit("open-settings", ());
                    }
                    "new_schema" => {
                        let _ = app_handle.emit("new-schema", ());
                    }
                    "check_updates" => {
                        let _ = app_handle.emit("check-for-updates", ());
                    }
                    _ => {}
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            cmd_parse_schema,
            cmd_parse_schema_with_inheritance,
            cmd_scan_folder,
            cmd_scan_zip,
            cmd_export_schema_xml,
            cmd_create_structure,
            cmd_create_structure_from_tree,
            cmd_list_templates,
            cmd_get_template,
            cmd_create_template,
            cmd_update_template,
            cmd_delete_template,
            cmd_toggle_favorite,
            cmd_use_template,
            cmd_get_all_tags,
            cmd_update_template_tags,
            cmd_export_template,
            cmd_export_templates_bulk,
            cmd_import_templates_from_json,
            cmd_import_templates_from_url,
            cmd_get_settings,
            cmd_set_setting,
            cmd_validate_variables,
            cmd_validate_schema,
            cmd_generate_diff_preview,
            cmd_list_recent_projects,
            cmd_get_recent_project,
            cmd_add_recent_project,
            cmd_delete_recent_project,
            cmd_clear_recent_projects,
            cmd_start_watch,
            cmd_stop_watch,
            cmd_get_watch_status
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    mod validate_template_name_tests {
        use super::*;

        #[test]
        fn accepts_valid_name() {
            assert_eq!(
                validate_template_name("My Template"),
                Ok("My Template".to_string())
            );
        }

        #[test]
        fn trims_whitespace() {
            assert_eq!(
                validate_template_name("  My Template  "),
                Ok("My Template".to_string())
            );
        }

        #[test]
        fn rejects_empty_name() {
            assert!(validate_template_name("").is_err());
            assert!(validate_template_name("   ").is_err());
        }

        #[test]
        fn rejects_name_exceeding_max_length() {
            let long_name = "a".repeat(101);
            let result = validate_template_name(&long_name);
            assert!(result.is_err());
            assert!(result.unwrap_err().contains("100 characters"));
        }

        #[test]
        fn accepts_name_at_max_length() {
            let max_name = "a".repeat(100);
            assert!(validate_template_name(&max_name).is_ok());
        }

        #[test]
        fn rejects_control_characters() {
            assert!(validate_template_name("My\x00Template").is_err());
            assert!(validate_template_name("My\nTemplate").is_err());
            assert!(validate_template_name("My\tTemplate").is_err());
        }

        #[test]
        fn accepts_unicode() {
            assert_eq!(
                validate_template_name("模板名称"),
                Ok("模板名称".to_string())
            );
            assert_eq!(
                validate_template_name("Plantilla España"),
                Ok("Plantilla España".to_string())
            );
        }

        #[test]
        fn accepts_special_characters() {
            assert_eq!(
                validate_template_name("My-Template_v2.0 (Final)"),
                Ok("My-Template_v2.0 (Final)".to_string())
            );
        }
    }

    mod validate_import_url_tests {
        use super::*;

        #[test]
        fn accepts_https_url() {
            assert!(validate_import_url("https://example.com/template.sct").is_ok());
        }

        #[test]
        fn rejects_http_url() {
            // HTTP is rejected for security (MITM/DNS rebinding protection)
            let result = validate_import_url("http://example.com/template.sct");
            assert!(result.is_err());
            assert!(result.unwrap_err().contains("HTTP is not allowed"));
        }

        #[test]
        fn rejects_file_scheme() {
            let result = validate_import_url("file:///etc/passwd");
            assert!(result.is_err());
            assert!(result.unwrap_err().contains("not allowed"));
        }

        #[test]
        fn rejects_ftp_scheme() {
            let result = validate_import_url("ftp://example.com/file");
            assert!(result.is_err());
        }

        #[test]
        fn rejects_localhost() {
            assert!(validate_import_url("https://localhost/template.sct").is_err());
            assert!(validate_import_url("https://localhost:8080/template.sct").is_err());
            assert!(validate_import_url("https://LOCALHOST/template.sct").is_err());
        }

        #[test]
        fn rejects_local_domain() {
            assert!(validate_import_url("https://myserver.local/template.sct").is_err());
            assert!(validate_import_url("https://app.internal/template.sct").is_err());
        }

        #[test]
        fn rejects_ipv4_loopback() {
            assert!(validate_import_url("https://127.0.0.1/template.sct").is_err());
            assert!(validate_import_url("https://127.0.0.255/template.sct").is_err());
        }

        #[test]
        fn rejects_ipv4_private_class_a() {
            assert!(validate_import_url("https://10.0.0.1/template.sct").is_err());
            assert!(validate_import_url("https://10.255.255.255/template.sct").is_err());
        }

        #[test]
        fn rejects_ipv4_private_class_b() {
            assert!(validate_import_url("https://172.16.0.1/template.sct").is_err());
            assert!(validate_import_url("https://172.31.255.255/template.sct").is_err());
        }

        #[test]
        fn rejects_ipv4_private_class_c() {
            assert!(validate_import_url("https://192.168.0.1/template.sct").is_err());
            assert!(validate_import_url("https://192.168.255.255/template.sct").is_err());
        }

        #[test]
        fn rejects_ipv4_link_local() {
            // This includes AWS metadata endpoint 169.254.169.254
            assert!(validate_import_url("https://169.254.169.254/latest/meta-data/").is_err());
            assert!(validate_import_url("https://169.254.0.1/template.sct").is_err());
        }

        #[test]
        fn rejects_ipv6_loopback() {
            assert!(validate_import_url("https://[::1]/template.sct").is_err());
        }

        #[test]
        fn rejects_ipv6_unique_local() {
            assert!(validate_import_url("https://[fc00::1]/template.sct").is_err());
            assert!(validate_import_url("https://[fd00::1]/template.sct").is_err());
        }

        #[test]
        fn rejects_ipv6_link_local() {
            assert!(validate_import_url("https://[fe80::1]/template.sct").is_err());
        }

        #[test]
        fn rejects_ipv4_mapped_ipv6() {
            // IPv4-mapped IPv6 addresses (::ffff:x.x.x.x) should be validated against IPv4 rules
            assert!(validate_import_url("https://[::ffff:127.0.0.1]/template.sct").is_err());
            assert!(validate_import_url("https://[::ffff:192.168.1.1]/template.sct").is_err());
            assert!(validate_import_url("https://[::ffff:10.0.0.1]/template.sct").is_err());
            assert!(validate_import_url("https://[::ffff:169.254.169.254]/template.sct").is_err());
        }

        #[test]
        fn accepts_public_ipv4() {
            assert!(validate_import_url("https://8.8.8.8/template.sct").is_ok());
            assert!(validate_import_url("https://1.1.1.1/template.sct").is_ok());
        }

        #[test]
        fn rejects_invalid_url() {
            assert!(validate_import_url("not a url").is_err());
            assert!(validate_import_url("").is_err());
        }

        #[test]
        fn rejects_url_without_host() {
            // Note: http:///path is parsed as having an empty domain, which is allowed by the url crate
            // but will fail our validation. data: URLs have no host.
            assert!(validate_import_url("data:text/plain,hello").is_err());
        }
    }

    mod version_validation_tests {
        use super::*;

        #[test]
        fn accepts_valid_versions() {
            assert!(is_valid_version("1.0"));
            assert!(is_valid_version("1.1"));
            assert!(is_valid_version("1.9"));
            assert!(is_valid_version("1.10"));
            assert!(is_valid_version("1.0.0"));
        }

        #[test]
        fn rejects_invalid_versions() {
            assert!(!is_valid_version("2.0"));
            assert!(!is_valid_version("1."));
            assert!(!is_valid_version("1.x"));
            assert!(!is_valid_version("1"));
            assert!(!is_valid_version(""));
            assert!(!is_valid_version("v1.0"));
            // New: also rejects trailing non-digits
            assert!(!is_valid_version("1.0abc"));
            assert!(!is_valid_version("1.0."));
        }
    }

    mod duplicate_strategy_serde_tests {
        use super::*;

        #[test]
        fn serializes_to_snake_case() {
            assert_eq!(
                serde_json::to_string(&DuplicateStrategy::Skip).unwrap(),
                "\"skip\""
            );
            assert_eq!(
                serde_json::to_string(&DuplicateStrategy::Replace).unwrap(),
                "\"replace\""
            );
            assert_eq!(
                serde_json::to_string(&DuplicateStrategy::Rename).unwrap(),
                "\"rename\""
            );
        }

        #[test]
        fn deserializes_from_snake_case() {
            assert_eq!(
                serde_json::from_str::<DuplicateStrategy>("\"skip\"").unwrap(),
                DuplicateStrategy::Skip
            );
            assert_eq!(
                serde_json::from_str::<DuplicateStrategy>("\"replace\"").unwrap(),
                DuplicateStrategy::Replace
            );
            assert_eq!(
                serde_json::from_str::<DuplicateStrategy>("\"rename\"").unwrap(),
                DuplicateStrategy::Rename
            );
        }
    }

    mod template_export_file_serde_tests {
        use super::*;

        #[test]
        fn serializes_single_template_export() {
            let export = TemplateExportFile {
                version: "1.0".to_string(),
                file_type: ExportFileType::Template,
                exported_at: "2024-01-01T00:00:00Z".to_string(),
                template: Some(TemplateExport {
                    name: "Test".to_string(),
                    description: Some("A test template".to_string()),
                    schema_xml: "<folder name=\"test\"/>".to_string(),
                    variables: None,
                    variable_validation: HashMap::new(),
                    icon_color: None,
                    tags: Vec::new(),
                    wizard_config: None,
                }),
                templates: None,
            };

            let json = serde_json::to_string(&export).unwrap();
            assert!(json.contains("\"type\":\"template\""));
            assert!(json.contains("\"version\":\"1.0\""));
            assert!(!json.contains("\"templates\""));
        }

        #[test]
        fn deserializes_template_export() {
            let json = r#"{
                "version": "1.0",
                "type": "template",
                "exported_at": "2024-01-01T00:00:00Z",
                "template": {
                    "name": "Test",
                    "description": "A test",
                    "schema_xml": "<folder/>",
                    "icon_color": null
                }
            }"#;

            let export: TemplateExportFile = serde_json::from_str(json).unwrap();
            assert_eq!(export.version, "1.0");
            assert_eq!(export.file_type, ExportFileType::Template);
            assert!(export.template.is_some());
            assert_eq!(export.template.unwrap().name, "Test");
        }

        #[test]
        fn deserializes_bundle_export() {
            let json = r#"{
                "version": "1.0",
                "type": "template_bundle",
                "exported_at": "2024-01-01T00:00:00Z",
                "templates": [
                    {"name": "A", "description": null, "schema_xml": "<a/>", "icon_color": null},
                    {"name": "B", "description": null, "schema_xml": "<b/>", "icon_color": null}
                ]
            }"#;

            let export: TemplateExportFile = serde_json::from_str(json).unwrap();
            assert_eq!(export.file_type, ExportFileType::TemplateBundle);
            assert!(export.templates.is_some());
            assert_eq!(export.templates.unwrap().len(), 2);
        }
    }

    mod validate_variables_tests {
        use super::*;

        #[test]
        fn passes_with_no_rules() {
            let variables = HashMap::new();
            let rules = HashMap::new();
            let errors = validate_variables(&variables, &rules);
            assert!(errors.is_empty());
        }

        #[test]
        fn validates_required_field() {
            let variables: HashMap<String, String> = HashMap::new();
            let mut rules = HashMap::new();
            rules.insert(
                "%NAME%".to_string(),
                ValidationRule {
                    required: true,
                    ..Default::default()
                },
            );

            let errors = validate_variables(&variables, &rules);
            assert_eq!(errors.len(), 1);
            assert!(errors[0].message.contains("required"));
        }

        #[test]
        fn validates_required_with_empty_value() {
            let mut variables = HashMap::new();
            variables.insert("%NAME%".to_string(), "".to_string());
            let mut rules = HashMap::new();
            rules.insert(
                "%NAME%".to_string(),
                ValidationRule {
                    required: true,
                    ..Default::default()
                },
            );

            let errors = validate_variables(&variables, &rules);
            assert_eq!(errors.len(), 1);
            assert!(errors[0].message.contains("required"));
        }

        #[test]
        fn passes_required_with_value() {
            let mut variables = HashMap::new();
            variables.insert("%NAME%".to_string(), "test".to_string());
            let mut rules = HashMap::new();
            rules.insert(
                "%NAME%".to_string(),
                ValidationRule {
                    required: true,
                    ..Default::default()
                },
            );

            let errors = validate_variables(&variables, &rules);
            assert!(errors.is_empty());
        }

        #[test]
        fn validates_min_length() {
            let mut variables = HashMap::new();
            variables.insert("%NAME%".to_string(), "ab".to_string());
            let mut rules = HashMap::new();
            rules.insert(
                "%NAME%".to_string(),
                ValidationRule {
                    min_length: Some(5),
                    ..Default::default()
                },
            );

            let errors = validate_variables(&variables, &rules);
            assert_eq!(errors.len(), 1);
            assert!(errors[0].message.contains("at least 5"));
        }

        #[test]
        fn validates_max_length() {
            let mut variables = HashMap::new();
            variables.insert("%NAME%".to_string(), "abcdefghij".to_string());
            let mut rules = HashMap::new();
            rules.insert(
                "%NAME%".to_string(),
                ValidationRule {
                    max_length: Some(5),
                    ..Default::default()
                },
            );

            let errors = validate_variables(&variables, &rules);
            assert_eq!(errors.len(), 1);
            assert!(errors[0].message.contains("at most 5"));
        }

        #[test]
        fn validates_min_length_with_unicode() {
            let mut variables = HashMap::new();
            // "héllo" is 5 characters but 6 bytes
            variables.insert("%NAME%".to_string(), "héllo".to_string());
            let mut rules = HashMap::new();
            rules.insert(
                "%NAME%".to_string(),
                ValidationRule {
                    min_length: Some(6),
                    ..Default::default()
                },
            );

            let errors = validate_variables(&variables, &rules);
            assert_eq!(errors.len(), 1);
            assert!(errors[0].message.contains("at least 6"));
        }

        #[test]
        fn validates_pattern() {
            let mut variables = HashMap::new();
            variables.insert("%NAME%".to_string(), "invalid!".to_string());
            let mut rules = HashMap::new();
            rules.insert(
                "%NAME%".to_string(),
                ValidationRule {
                    pattern: Some("^[a-z]+$".to_string()),
                    ..Default::default()
                },
            );

            let errors = validate_variables(&variables, &rules);
            assert_eq!(errors.len(), 1);
            assert!(errors[0].message.contains("does not match"));
        }

        #[test]
        fn passes_valid_pattern() {
            let mut variables = HashMap::new();
            variables.insert("%NAME%".to_string(), "validname".to_string());
            let mut rules = HashMap::new();
            rules.insert(
                "%NAME%".to_string(),
                ValidationRule {
                    pattern: Some("^[a-z]+$".to_string()),
                    ..Default::default()
                },
            );

            let errors = validate_variables(&variables, &rules);
            assert!(errors.is_empty());
        }

        #[test]
        fn handles_invalid_regex_pattern() {
            let mut variables = HashMap::new();
            variables.insert("%NAME%".to_string(), "test".to_string());
            let mut rules = HashMap::new();
            rules.insert(
                "%NAME%".to_string(),
                ValidationRule {
                    pattern: Some("[invalid".to_string()),
                    ..Default::default()
                },
            );

            let errors = validate_variables(&variables, &rules);
            assert_eq!(errors.len(), 1);
            assert!(errors[0].message.contains("Invalid regex"));
        }

        #[test]
        fn validates_rule_sanity_min_exceeds_max() {
            let mut variables = HashMap::new();
            variables.insert("%NAME%".to_string(), "test".to_string());
            let mut rules = HashMap::new();
            rules.insert(
                "%NAME%".to_string(),
                ValidationRule {
                    min_length: Some(10),
                    max_length: Some(5),
                    ..Default::default()
                },
            );

            let errors = validate_variables(&variables, &rules);
            assert_eq!(errors.len(), 1);
            assert!(errors[0].message.contains("min length (10) exceeds max length (5)"));
        }

        #[test]
        fn validates_multiple_rules() {
            let mut variables = HashMap::new();
            variables.insert("%NAME%".to_string(), "ab".to_string());
            let mut rules = HashMap::new();
            rules.insert(
                "%NAME%".to_string(),
                ValidationRule {
                    min_length: Some(5),
                    pattern: Some("^[0-9]+$".to_string()),
                    ..Default::default()
                },
            );

            let errors = validate_variables(&variables, &rules);
            // Should have 2 errors: min_length and pattern
            assert_eq!(errors.len(), 2);
        }

        #[test]
        fn skips_length_validation_for_empty_non_required() {
            let mut variables = HashMap::new();
            variables.insert("%NAME%".to_string(), "".to_string());
            let mut rules = HashMap::new();
            rules.insert(
                "%NAME%".to_string(),
                ValidationRule {
                    min_length: Some(5),
                    required: false,
                    ..Default::default()
                },
            );

            // Empty value with non-required field should not trigger min_length error
            let errors = validate_variables(&variables, &rules);
            assert!(errors.is_empty());
        }

        #[test]
        fn strips_percent_delimiters_in_display_name() {
            let variables: HashMap<String, String> = HashMap::new();
            let mut rules = HashMap::new();
            rules.insert(
                "%MY_VAR%".to_string(),
                ValidationRule {
                    required: true,
                    ..Default::default()
                },
            );

            let errors = validate_variables(&variables, &rules);
            assert_eq!(errors.len(), 1);
            // Both variable_name and message should use clean names without % delimiters
            assert_eq!(errors[0].variable_name, "MY_VAR");
            assert!(errors[0].message.contains("MY_VAR is required"));
            assert!(!errors[0].message.contains("%"));
        }

        #[test]
        fn rejects_overly_long_regex_pattern() {
            let mut variables = HashMap::new();
            variables.insert("%NAME%".to_string(), "test".to_string());
            let mut rules = HashMap::new();
            // Create a pattern longer than MAX_REGEX_PATTERN_LENGTH (1000)
            let long_pattern = "a".repeat(1001);
            rules.insert(
                "%NAME%".to_string(),
                ValidationRule {
                    pattern: Some(long_pattern),
                    ..Default::default()
                },
            );

            let errors = validate_variables(&variables, &rules);
            assert_eq!(errors.len(), 1);
            assert!(errors[0].message.contains("exceeds maximum length"));
        }

        #[test]
        fn errors_are_sorted_by_variable_name() {
            let variables: HashMap<String, String> = HashMap::new();
            let mut rules = HashMap::new();
            // Insert in non-alphabetical order
            rules.insert(
                "%ZEBRA%".to_string(),
                ValidationRule { required: true, ..Default::default() },
            );
            rules.insert(
                "%APPLE%".to_string(),
                ValidationRule { required: true, ..Default::default() },
            );
            rules.insert(
                "%MANGO%".to_string(),
                ValidationRule { required: true, ..Default::default() },
            );

            let errors = validate_variables(&variables, &rules);
            assert_eq!(errors.len(), 3);
            // Errors should be sorted alphabetically by variable name (clean names without % delimiters)
            assert_eq!(errors[0].variable_name, "APPLE");
            assert_eq!(errors[1].variable_name, "MANGO");
            assert_eq!(errors[2].variable_name, "ZEBRA");
        }
    }
}
