//! Diff preview generation for schema trees.
//!
//! Thin consumer of the Plan module (ADR-0004): the schema is expanded by
//! the same pure `plan::expand` that structure creation executes, then the
//! Plan is compared against disk. Generates file diffs for existing files
//! that would be overwritten.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use crate::plan::{self, PlanContent, PlanKind, PlanNode, PlanNote};
use crate::schema::SchemaTree;
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

    let structure_plan = plan::expand(tree, variables);

    // Loud expansion errors/warnings surface as diff warnings; repeat
    // announcements and infos are execution-log concerns, not diff ones.
    for note in &structure_plan.notes {
        match note {
            PlanNote::Error { message, .. } | PlanNote::Warning { message, .. } => {
                summary.warnings.push(message.clone());
            }
            PlanNote::Info { .. } | PlanNote::RepeatExpanded { .. } => {}
        }
    }

    let mut roots: Vec<DiffNode> = structure_plan
        .roots
        .iter()
        .map(|node| diff_plan_node(node, &base_path, overwrite, &mut summary))
        .collect();

    // DiffResult wants a single root. A schema whose root is a folder/file
    // expands to exactly one Plan node; a root-level control node can expand
    // to zero or many, which get wrapped in a synthetic container.
    let root = if roots.len() == 1 {
        roots.remove(0)
    } else {
        DiffNode {
            id: generate_diff_id(),
            node_type: DiffNodeType::Folder,
            name: String::new(),
            path: output_path.to_string(),
            action: DiffAction::Unchanged,
            existing_content: None,
            new_content: None,
            diff_hunks: None,
            url: None,
            is_binary: false,
            children: if roots.is_empty() { None } else { Some(roots) },
        }
    };

    // Compute total_items from the individual counts
    summary.total_items =
        summary.creates + summary.overwrites + summary.skips + summary.unchanged_folders;

    Ok(DiffResult { root, summary })
}

// ============================================================================
// Plan walk
// ============================================================================

/// Compare one Plan node against disk.
fn diff_plan_node(
    node: &PlanNode,
    parent_path: &Path,
    overwrite: bool,
    summary: &mut DiffSummary,
) -> DiffNode {
    let node_path = parent_path.join(&node.name);
    // Check if path exists, handling potential errors gracefully
    let exists = node_path.try_exists().unwrap_or(false);

    match &node.kind {
        PlanKind::Folder { children } => {
            let child_nodes: Vec<DiffNode> = children
                .iter()
                .map(|child| diff_plan_node(child, &node_path, overwrite, summary))
                .collect();

            let action = if exists {
                summary.unchanged_folders += 1;
                DiffAction::Unchanged
            } else {
                summary.creates += 1;
                DiffAction::Create
            };

            DiffNode {
                id: generate_diff_id(),
                node_type: DiffNodeType::Folder,
                name: node.name.clone(),
                path: node_path.to_string_lossy().to_string(),
                action,
                existing_content: None,
                new_content: None,
                diff_hunks: None,
                url: None,
                is_binary: false,
                children: if child_nodes.is_empty() {
                    None
                } else {
                    Some(child_nodes)
                },
            }
        }
        PlanKind::File { content } => {
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

            // New content: inline text is already fully rendered by the Plan
            // (using safe UTF-8 truncation for display)
            let (new_content, url) = match content {
                PlanContent::Download { url } => {
                    (Some(format!("[Content from URL: {}]", url)), Some(url.clone()))
                }
                PlanContent::Generate { .. } => (None, None),
                PlanContent::Inline { text, had_content } => (
                    if *had_content {
                        Some(truncate_utf8(text, MAX_DIFF_CONTENT_SIZE))
                    } else {
                        None
                    },
                    None,
                ),
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

            DiffNode {
                id: generate_diff_id(),
                node_type: DiffNodeType::File,
                name: node.name.clone(),
                path: node_path.to_string_lossy().to_string(),
                action,
                existing_content,
                new_content,
                diff_hunks,
                url,
                is_binary,
                children: None,
            }
        }
    }
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::schema::{SchemaNode, SchemaStats};

    fn tree(root: SchemaNode) -> SchemaTree {
        SchemaTree {
            root,
            stats: SchemaStats::default(),
            hooks: None,
            variable_definitions: None,
        }
    }

    #[test]
    fn diff_matches_creation_semantics_for_repeat_edges() {
        // count above maximum: block skipped, loud warning — same as create
        let repeat = SchemaNode {
            node_type: "repeat".to_string(),
            repeat_count: Some("10001".to_string()),
            repeat_as: Some("i".to_string()),
            children: Some(vec![SchemaNode {
                name: "item-%i%.txt".to_string(),
                node_type: "file".to_string(),
                ..Default::default()
            }]),
            ..Default::default()
        };
        let t = tree(SchemaNode {
            name: "root".to_string(),
            node_type: "folder".to_string(),
            children: Some(vec![repeat]),
            ..Default::default()
        });

        let temp = tempfile::tempdir().unwrap();
        let result = generate_diff_preview(
            &t,
            temp.path().to_str().unwrap(),
            &HashMap::new(),
            false,
        )
        .unwrap();

        assert_eq!(result.root.name, "root");
        assert!(result.root.children.is_none(), "block must be skipped");
        assert_eq!(result.summary.warnings.len(), 1);
        assert!(result.summary.warnings[0].contains("exceeds maximum"));
    }

    #[test]
    fn overwrite_diff_includes_hunks_for_existing_text_file() {
        let temp = tempfile::tempdir().unwrap();
        let root_dir = temp.path().join("root");
        fs::create_dir_all(&root_dir).unwrap();
        fs::write(root_dir.join("a.txt"), "old line\n").unwrap();

        let t = tree(SchemaNode {
            name: "root".to_string(),
            node_type: "folder".to_string(),
            children: Some(vec![SchemaNode {
                name: "a.txt".to_string(),
                node_type: "file".to_string(),
                content: Some("new line\n".to_string()),
                ..Default::default()
            }]),
            ..Default::default()
        });

        let result = generate_diff_preview(
            &t,
            temp.path().to_str().unwrap(),
            &HashMap::new(),
            true, // overwrite
        )
        .unwrap();

        let file = &result.root.children.as_ref().unwrap()[0];
        assert_eq!(file.action, DiffAction::Overwrite);
        assert_eq!(file.existing_content.as_deref(), Some("old line\n"));
        assert!(file.diff_hunks.as_ref().is_some_and(|h| !h.is_empty()));
        assert_eq!(result.summary.overwrites, 1);
    }

    #[test]
    fn preview_and_creation_agree_on_planned_paths() {
        // The same expansion feeds both; sanity-check the diff tree mirrors
        // plan::to_paths for a schema with if/else and repeat.
        let t = tree(SchemaNode {
            name: "app".to_string(),
            node_type: "folder".to_string(),
            children: Some(vec![
                SchemaNode {
                    node_type: "if".to_string(),
                    condition_var: Some("FLAG".to_string()),
                    children: Some(vec![SchemaNode {
                        name: "on.txt".to_string(),
                        node_type: "file".to_string(),
                        ..Default::default()
                    }]),
                    ..Default::default()
                },
                SchemaNode {
                    node_type: "repeat".to_string(),
                    repeat_count: Some("2".to_string()),
                    repeat_as: Some("n".to_string()),
                    children: Some(vec![SchemaNode {
                        name: "f-%n%.txt".to_string(),
                        node_type: "file".to_string(),
                        ..Default::default()
                    }]),
                    ..Default::default()
                },
            ]),
            ..Default::default()
        });

        let mut variables = HashMap::new();
        variables.insert("%FLAG%".to_string(), "yes".to_string());

        let temp = tempfile::tempdir().unwrap();
        let result =
            generate_diff_preview(&t, temp.path().to_str().unwrap(), &variables, false).unwrap();

        fn collect(node: &DiffNode, prefix: &str, out: &mut Vec<String>) {
            let path = if prefix.is_empty() {
                node.name.clone()
            } else {
                format!("{}/{}", prefix, node.name)
            };
            out.push(path.clone());
            if let Some(children) = &node.children {
                for child in children {
                    collect(child, &path, out);
                }
            }
        }
        let mut diff_paths = Vec::new();
        collect(&result.root, "", &mut diff_paths);
        diff_paths.sort();

        let mut plan_paths = plan::to_paths(&plan::expand(&t, &variables));
        plan_paths.sort();

        assert_eq!(diff_paths, plan_paths);
    }
}
