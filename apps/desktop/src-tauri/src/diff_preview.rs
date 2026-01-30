//! Diff preview generation for schema trees.
//!
//! Generates a preview of what changes would be made when creating a structure,
//! including file diffs for existing files that would be overwritten.

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

use crate::schema::SchemaNode;
use crate::schema::SchemaTree;
use crate::transforms::substitute_variables;
use crate::types::{
    DiffAction, DiffHunk, DiffLine, DiffLineType, DiffNode, DiffNodeType, DiffResult, DiffSummary,
};

// ============================================================================
// Constants
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

// ============================================================================
// Public API
// ============================================================================

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
    summary.total_items =
        summary.creates + summary.overwrites + summary.skips + summary.unchanged_folders;

    Ok(DiffResult { root, summary })
}

// ============================================================================
// Internal Helpers
// ============================================================================

/// Check if content appears to be binary (contains null bytes or high ratio of non-text bytes)
fn is_binary_content(content: &[u8]) -> bool {
    let sample_size = content.len().min(BINARY_SAMPLE_SIZE);
    let sample = &content[..sample_size];

    // Check for null bytes (common in binary files)
    if sample.contains(&0) {
        return true;
    }

    // Check ratio of non-printable characters (excluding common whitespace)
    let non_printable = sample
        .iter()
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
    let value = variables
        .get(&var_key)
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
                let children =
                    process_diff_children(node, current_path, variables, overwrite, summary)?;
                if children.is_empty() {
                    return Ok(None);
                }
                let display_value = if resolved_value.chars().count() > MAX_CONDITION_DISPLAY_LEN {
                    format!(
                        "{}...",
                        resolved_value
                            .chars()
                            .take(TRUNCATED_CONDITION_LEN)
                            .collect::<String>()
                    )
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
                let iteration_children =
                    process_diff_children(node, current_path, &iter_vars, overwrite, summary)?;
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
            let children =
                process_diff_children(node, &node_path, variables, overwrite, summary)?;

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
                children: if children.is_empty() {
                    None
                } else {
                    Some(children)
                },
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
                    Err(_) => (None, None, false),
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
        _ => Ok(None),
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
                    let nested_children =
                        process_diff_children(child, current_path, variables, overwrite, summary)?;
                    children.extend(nested_children);
                }
                last_was_if = true;
                continue;
            }

            if child.node_type == "else" {
                if !skip_next_else {
                    // Use process_diff_children recursively to properly handle nested if/else pairs
                    let nested_children =
                        process_diff_children(child, current_path, variables, overwrite, summary)?;
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

            if let Some(diff_node) =
                generate_diff_node(child, current_path, variables, overwrite, summary)?
            {
                children.push(diff_node);
            }
        }
    }

    Ok(children)
}
