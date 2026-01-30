//! Structure creation logic - creates folder/file structures from schema trees.

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

use crate::file_processors::{
    download_file, download_file_binary, is_audio_with_metadata, is_epub_file, is_image_with_xmp,
    is_jupyter_notebook, is_office_file, is_pdf_file, is_processable_archive, is_sqlite_database,
    is_svg_file, parse_download_error, process_archive, process_audio_metadata, process_epub_file,
    process_image_xmp, process_jupyter_notebook, process_office_file, process_pdf_file,
    process_sqlite_database,
};
use crate::generators;
use crate::schema::{self, SchemaTree};
use crate::templating;
use crate::transforms::substitute_variables;
use crate::types::{
    CreateResult, CreatedItem, HookResult, ItemType, LogEntry, ResultSummary, UndoResult,
    UndoSummary,
};

/// Maximum allowed repeat count to prevent accidental resource exhaustion
pub const MAX_REPEAT_COUNT: usize = 10000;

/// Helper to log a repeat-related error and increment error count
fn log_repeat_error(
    logs: &mut Vec<LogEntry>,
    summary: &mut ResultSummary,
    message: String,
    details: String,
) {
    logs.push(LogEntry {
        log_type: "error".to_string(),
        message,
        details: Some(details),
    });
    summary.errors += 1;
}

/// Create a folder/file structure from a schema tree
pub fn create_structure_from_tree(
    tree: &SchemaTree,
    output_path: &str,
    variables: &HashMap<String, String>,
    dry_run: bool,
    overwrite: bool,
    project_name: Option<&str>,
) -> Result<CreateResult, String> {
    let base_path = PathBuf::from(output_path);
    let mut logs: Vec<LogEntry> = Vec::new();
    let mut summary = ResultSummary {
        folders_created: 0,
        files_created: 0,
        files_downloaded: 0,
        files_generated: 0,
        errors: 0,
        skipped: 0,
        hooks_executed: 0,
        hooks_failed: 0,
    };
    let mut hook_results: Vec<HookResult> = Vec::new();
    let mut created_items: Vec<CreatedItem> = Vec::new();

    // Inject built-in variables, allowing user overrides
    let mut all_variables = HashMap::new();
    let now = chrono::Local::now();
    all_variables.insert("%DATE%".to_string(), now.format("%Y-%m-%d").to_string());
    all_variables.insert("%YEAR%".to_string(), now.format("%Y").to_string());
    all_variables.insert("%MONTH%".to_string(), now.format("%m").to_string());
    all_variables.insert("%DAY%".to_string(), now.format("%d").to_string());
    // Inject %PROJECT_NAME% if provided
    if let Some(name) = project_name {
        all_variables.insert("%PROJECT_NAME%".to_string(), name.to_string());
    }
    // User-provided variables override built-ins
    for (k, v) in variables.iter() {
        all_variables.insert(k.clone(), v.clone());
    }

    // Create structure recursively
    create_node(
        &tree.root,
        &base_path,
        &all_variables,
        dry_run,
        overwrite,
        &mut logs,
        &mut summary,
        &mut created_items,
    )?;

    // Execute post-create hooks if present and not in dry-run mode
    if let Some(ref hooks) = tree.hooks {
        if !hooks.post_create.is_empty() {
            // Determine the working directory for hooks
            // Use the root folder path if it was created, otherwise use output_path
            // Apply variable substitution to root name (same as in create_node)
            let substituted_root_name = substitute_variables(&tree.root.name, &all_variables);
            let hook_working_dir = base_path.join(&substituted_root_name);
            let working_dir = if hook_working_dir.exists() {
                hook_working_dir
            } else {
                base_path.clone()
            };

            for cmd in &hooks.post_create {
                // Replace variables in command
                let resolved_cmd = substitute_variables(cmd, &all_variables);

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

    Ok(CreateResult {
        logs,
        summary,
        hook_results,
        created_items,
    })
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
                stdout: if stdout.is_empty() {
                    None
                } else {
                    Some(stdout)
                },
                stderr: if stderr.is_empty() {
                    None
                } else {
                    Some(stderr)
                },
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
    !matches!(
        value.to_lowercase().as_str(),
        "false" | "0" | "no" | "off" | "disabled"
    )
}

/// Evaluate if condition without side effects
fn evaluate_if_condition(node: &schema::SchemaNode, variables: &HashMap<String, String>) -> bool {
    if let Some(var_name) = &node.condition_var {
        // Variables are stored with % wrapping (e.g., %NAME%), so wrap the var name
        let lookup_key = format!("%{}%", var_name);
        variables.get(&lookup_key).map(|v| is_truthy(v)).unwrap_or(false)
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
    created_items: &mut Vec<CreatedItem>,
) -> Result<(), String> {
    let mut child_last_if = None;
    for child in children {
        create_node_internal(
            child,
            parent_path,
            variables,
            dry_run,
            overwrite,
            logs,
            summary,
            created_items,
            child_last_if,
        )?;
        // Track if results for else blocks
        // Only if nodes followed immediately by else nodes form a valid if/else chain
        // Any other node type (folder, file) breaks the chain
        match child.node_type.as_str() {
            "if" => child_last_if = Some(evaluate_if_condition(child, variables)),
            "else" => child_last_if = None, // Break chain - only one else per if
            _ => child_last_if = None,      // Non-conditional nodes break the if/else chain
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
    created_items: &mut Vec<CreatedItem>,
) -> Result<(), String> {
    create_node_internal(
        node,
        parent_path,
        variables,
        dry_run,
        overwrite,
        logs,
        summary,
        created_items,
        None,
    )
}

fn create_node_internal(
    node: &schema::SchemaNode,
    parent_path: &PathBuf,
    variables: &HashMap<String, String>,
    dry_run: bool,
    overwrite: bool,
    logs: &mut Vec<LogEntry>,
    summary: &mut ResultSummary,
    created_items: &mut Vec<CreatedItem>,
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
                    process_children(
                        children,
                        parent_path,
                        variables,
                        dry_run,
                        overwrite,
                        logs,
                        summary,
                        created_items,
                    )?;
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
                    process_children(
                        children,
                        parent_path,
                        variables,
                        dry_run,
                        overwrite,
                        logs,
                        summary,
                        created_items,
                    )?;
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
                    message: format!(
                        "Variable name '{}' ends with '_1' which may be confusing",
                        as_var
                    ),
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
                        format!(
                            "Count must be a non-negative integer (resolved from '{}')",
                            count_str
                        ),
                    );
                    return Ok(());
                }
                // Safe conversion: check against MAX_REPEAT_COUNT before casting
                // This prevents overflow on 32-bit systems where usize is smaller than i64
                Ok(n) if n as u64 > MAX_REPEAT_COUNT as u64 => {
                    log_repeat_error(
                        logs,
                        summary,
                        format!(
                            "Repeat count '{}' exceeds maximum of {}",
                            n, MAX_REPEAT_COUNT
                        ),
                        "Consider reducing the count or splitting into multiple repeat blocks"
                            .to_string(),
                    );
                    return Ok(());
                }
                Ok(n) => n as usize,
                Err(_) => {
                    log_repeat_error(
                        logs,
                        summary,
                        format!("Invalid repeat count: '{}'", resolved),
                        format!(
                            "Count must be a non-negative integer (resolved from '{}')",
                            count_str
                        ),
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

                    process_children(
                        children,
                        parent_path,
                        &scoped_vars,
                        dry_run,
                        overwrite,
                        logs,
                        summary,
                        created_items,
                    )?;
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
            let pre_existed = current_path.exists();
            if dry_run {
                logs.push(LogEntry {
                    log_type: "info".to_string(),
                    message: format!("Would create folder: {}", name),
                    details: Some(display_path.clone()),
                });
            } else if !pre_existed {
                match fs::create_dir_all(&current_path) {
                    Ok(_) => {
                        summary.folders_created += 1;
                        created_items.push(CreatedItem {
                            path: display_path.clone(),
                            item_type: ItemType::Folder,
                            pre_existed: false,
                        });
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
                process_children(
                    children,
                    &current_path,
                    variables,
                    dry_run,
                    overwrite,
                    logs,
                    summary,
                    created_items,
                )?;
            }
        }
        "file" => {
            let file_exists = current_path.exists();
            let pre_existed = file_exists;

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
                } else if let Some(generator_type) = &node.generate {
                    let generator_desc = match generator_type.as_str() {
                        "image" => "image",
                        "sqlite" => "database",
                        _ => "file",
                    };
                    logs.push(LogEntry {
                        log_type: "info".to_string(),
                        message: format!("Would generate {}: {}", generator_desc, name),
                        details: Some(display_path.clone()),
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
                    if is_office_file(&name)
                        || is_epub_file(&name)
                        || is_pdf_file(&name)
                        || is_image_with_xmp(&name)
                        || is_audio_with_metadata(&name)
                        || is_sqlite_database(&name)
                        || is_processable_archive(&name)
                    {
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
                                                created_items.push(CreatedItem {
                                                    path: display_path.clone(),
                                                    item_type: ItemType::File,
                                                    pre_existed,
                                                });
                                                logs.push(LogEntry {
                                                    log_type: "success".to_string(),
                                                    message: format!(
                                                        "Downloaded & processed: {}",
                                                        name
                                                    ),
                                                    details: Some(format!(
                                                        "From: {} ({} file, variables replaced)",
                                                        url, file_type
                                                    )),
                                                });
                                            }
                                            Err(e) => {
                                                summary.errors += 1;
                                                logs.push(LogEntry {
                                                    log_type: "error".to_string(),
                                                    message: format!(
                                                        "Failed to save file: {}",
                                                        name
                                                    ),
                                                    details: Some(format!(
                                                        "Error writing to disk: {}",
                                                        e
                                                    )),
                                                });
                                            }
                                        }
                                    }
                                    Err(e) => {
                                        summary.errors += 1;
                                        logs.push(LogEntry {
                                            log_type: "error".to_string(),
                                            message: format!(
                                                "Failed to process {} file: {}",
                                                file_type, name
                                            ),
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
                                let processed = match process_jupyter_notebook(&content, variables)
                                {
                                    Ok(p) => p,
                                    Err(e) => {
                                        // If processing fails, fall back to simple string replacement
                                        logs.push(LogEntry {
                                            log_type: "warning".to_string(),
                                            message: format!(
                                                "Notebook processing failed, using text replacement: {}",
                                                name
                                            ),
                                            details: Some(e),
                                        });
                                        let fallback = substitute_variables(&content, variables);
                                        fallback
                                    }
                                };
                                match fs::write(&current_path, &processed) {
                                    Ok(_) => {
                                        summary.files_downloaded += 1;
                                        created_items.push(CreatedItem {
                                            path: display_path.clone(),
                                            item_type: ItemType::File,
                                            pre_existed,
                                        });
                                        logs.push(LogEntry {
                                            log_type: "success".to_string(),
                                            message: format!("Downloaded & processed: {}", name),
                                            details: Some(format!(
                                                "From: {} (Jupyter notebook, variables replaced)",
                                                url
                                            )),
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
                                        created_items.push(CreatedItem {
                                            path: display_path.clone(),
                                            item_type: ItemType::File,
                                            pre_existed,
                                        });
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
                } else if let Some(generator_type) = &node.generate {
                    // Generate binary file (image or sqlite)
                    match generator_type.as_str() {
                        "image" => {
                            match generators::generate_image(node, &current_path, variables, dry_run)
                            {
                                Ok(_) => {
                                    summary.files_generated += 1;
                                    if !dry_run {
                                        created_items.push(CreatedItem {
                                            path: display_path.clone(),
                                            item_type: ItemType::File,
                                            pre_existed,
                                        });
                                    }
                                    logs.push(LogEntry {
                                        log_type: if dry_run {
                                            "info".to_string()
                                        } else {
                                            "success".to_string()
                                        },
                                        message: format!(
                                            "{} image: {}",
                                            if dry_run { "Would generate" } else { "Generated" },
                                            name
                                        ),
                                        details: Some(display_path.clone()),
                                    });
                                }
                                Err(e) => {
                                    summary.errors += 1;
                                    logs.push(LogEntry {
                                        log_type: "error".to_string(),
                                        message: format!("Failed to generate image: {}", name),
                                        details: Some(e),
                                    });
                                }
                            }
                        }
                        "sqlite" => {
                            match generators::generate_sqlite(
                                node,
                                &current_path,
                                variables,
                                dry_run,
                            ) {
                                Ok(_) => {
                                    summary.files_generated += 1;
                                    if !dry_run {
                                        created_items.push(CreatedItem {
                                            path: display_path.clone(),
                                            item_type: ItemType::File,
                                            pre_existed,
                                        });
                                    }
                                    logs.push(LogEntry {
                                        log_type: if dry_run {
                                            "info".to_string()
                                        } else {
                                            "success".to_string()
                                        },
                                        message: format!(
                                            "{} database: {}",
                                            if dry_run { "Would generate" } else { "Generated" },
                                            name
                                        ),
                                        details: Some(display_path.clone()),
                                    });
                                }
                                Err(e) => {
                                    summary.errors += 1;
                                    logs.push(LogEntry {
                                        log_type: "error".to_string(),
                                        message: format!("Failed to generate database: {}", name),
                                        details: Some(e),
                                    });
                                }
                            }
                        }
                        _ => {
                            logs.push(LogEntry {
                                log_type: "warning".to_string(),
                                message: format!("Unknown generator type: {}", generator_type),
                                details: Some(format!(
                                    "File '{}' was skipped. Supported generators: image, sqlite",
                                    name
                                )),
                            });
                        }
                    }
                } else {
                    // Create file with content (or empty if no content)
                    // Process template directives if template="true", then replace variables
                    let raw_content = node.content.clone().unwrap_or_default();
                    let file_content = if node.template == Some(true) {
                        match templating::process_template(&raw_content, variables) {
                            Ok(processed) => substitute_variables(&processed, variables),
                            Err(e) => {
                                logs.push(LogEntry {
                                    log_type: "warning".to_string(),
                                    message: format!("Template error in {}", name),
                                    details: Some(e.to_string()),
                                });
                                substitute_variables(&raw_content, variables)
                            }
                        }
                    } else {
                        substitute_variables(&raw_content, variables)
                    };
                    match fs::write(&current_path, &file_content) {
                        Ok(_) => {
                            summary.files_created += 1;
                            created_items.push(CreatedItem {
                                path: display_path.clone(),
                                item_type: ItemType::File,
                                pre_existed,
                            });
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

/// Undo a structure creation by deleting items that were newly created
/// Safety rules:
/// - Only deletes items where pre_existed == false
/// - Deletes files first, then folders (reverse creation order)
/// - Only deletes folders if they are empty
pub fn undo_structure(items: &[CreatedItem], dry_run: bool) -> Result<UndoResult, String> {
    let mut logs: Vec<LogEntry> = Vec::new();
    let mut summary = UndoSummary {
        files_deleted: 0,
        folders_deleted: 0,
        items_skipped: 0,
        errors: 0,
    };

    // Separate files and folders, filtering out pre-existing items
    let mut files_to_delete: Vec<&CreatedItem> = Vec::new();
    let mut folders_to_delete: Vec<&CreatedItem> = Vec::new();

    for item in items {
        if item.pre_existed {
            // Skip pre-existing items - they should never be deleted
            summary.items_skipped += 1;
            logs.push(LogEntry {
                log_type: "info".to_string(),
                message: format!("Skipped (pre-existed): {}", item.path),
                details: Some("This item existed before creation and was overwritten".to_string()),
            });
            continue;
        }

        match item.item_type {
            ItemType::File => files_to_delete.push(item),
            ItemType::Folder => folders_to_delete.push(item),
        }
    }

    // Delete files first (reverse order to handle nested structures)
    files_to_delete.reverse();
    for item in &files_to_delete {
        let path = PathBuf::from(&item.path);

        if dry_run {
            // Check if file exists for accurate dry-run preview
            if path.exists() {
                logs.push(LogEntry {
                    log_type: "info".to_string(),
                    message: format!("Would delete file: {}", item.path),
                    details: None,
                });
                summary.files_deleted += 1;
            } else {
                summary.items_skipped += 1;
                logs.push(LogEntry {
                    log_type: "info".to_string(),
                    message: format!("File already deleted: {}", item.path),
                    details: None,
                });
            }
        } else if path.exists() {
            match fs::remove_file(&path) {
                Ok(_) => {
                    summary.files_deleted += 1;
                    logs.push(LogEntry {
                        log_type: "success".to_string(),
                        message: format!("Deleted file: {}", item.path),
                        details: None,
                    });
                }
                Err(e) => {
                    summary.errors += 1;
                    logs.push(LogEntry {
                        log_type: "error".to_string(),
                        message: format!("Failed to delete file: {}", item.path),
                        details: Some(format!("Error: {}", e)),
                    });
                }
            }
        } else {
            summary.items_skipped += 1;
            logs.push(LogEntry {
                log_type: "info".to_string(),
                message: format!("File already deleted: {}", item.path),
                details: None,
            });
        }
    }

    // Delete folders (reverse order to delete children before parents)
    // Sort by path length descending to ensure child folders are deleted first
    folders_to_delete.sort_by(|a, b| b.path.len().cmp(&a.path.len()));
    for item in &folders_to_delete {
        let path = PathBuf::from(&item.path);

        if dry_run {
            // Check folder state for accurate dry-run preview
            if path.exists() {
                match fs::read_dir(&path) {
                    Ok(entries) => {
                        let is_empty = entries.count() == 0;
                        if is_empty {
                            logs.push(LogEntry {
                                log_type: "info".to_string(),
                                message: format!("Would delete folder: {}", item.path),
                                details: None,
                            });
                            summary.folders_deleted += 1;
                        } else {
                            summary.items_skipped += 1;
                            logs.push(LogEntry {
                                log_type: "info".to_string(),
                                message: format!("Would skip folder (not empty): {}", item.path),
                                details: None,
                            });
                        }
                    }
                    Err(_) => {
                        summary.items_skipped += 1;
                        logs.push(LogEntry {
                            log_type: "info".to_string(),
                            message: format!("Would skip folder (unreadable): {}", item.path),
                            details: None,
                        });
                    }
                }
            } else {
                summary.items_skipped += 1;
                logs.push(LogEntry {
                    log_type: "info".to_string(),
                    message: format!("Folder already deleted: {}", item.path),
                    details: None,
                });
            }
        } else if path.exists() {
            // Only delete if folder is empty
            match fs::read_dir(&path) {
                Ok(entries) => {
                    let is_empty = entries.count() == 0;
                    if is_empty {
                        match fs::remove_dir(&path) {
                            Ok(_) => {
                                summary.folders_deleted += 1;
                                logs.push(LogEntry {
                                    log_type: "success".to_string(),
                                    message: format!("Deleted folder: {}", item.path),
                                    details: None,
                                });
                            }
                            Err(e) => {
                                summary.errors += 1;
                                logs.push(LogEntry {
                                    log_type: "error".to_string(),
                                    message: format!("Failed to delete folder: {}", item.path),
                                    details: Some(format!("Error: {}", e)),
                                });
                            }
                        }
                    } else {
                        summary.items_skipped += 1;
                        logs.push(LogEntry {
                            log_type: "info".to_string(),
                            message: format!("Folder not empty, skipped: {}", item.path),
                            details: Some(
                                "Only empty folders are deleted to prevent data loss".to_string(),
                            ),
                        });
                    }
                }
                Err(e) => {
                    summary.errors += 1;
                    logs.push(LogEntry {
                        log_type: "error".to_string(),
                        message: format!("Failed to read folder: {}", item.path),
                        details: Some(format!("Error: {}", e)),
                    });
                }
            }
        } else {
            summary.items_skipped += 1;
            logs.push(LogEntry {
                log_type: "info".to_string(),
                message: format!("Folder already deleted: {}", item.path),
                details: None,
            });
        }
    }

    Ok(UndoResult { logs, summary })
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::schema::{SchemaNode, SchemaStats, SchemaTree};

    mod builtin_date_variables_tests {
        use super::*;

        #[test]
        fn injects_date_variables_without_user_input() {
            let temp_dir = tempfile::tempdir().unwrap();
            let output_path = temp_dir.path().to_str().unwrap();

            // Create a simple schema with date variables
            let tree = SchemaTree {
                root: SchemaNode {
                    id: Some("root".to_string()),
                    name: "project".to_string(),
                    node_type: "folder".to_string(),
                    children: Some(vec![SchemaNode {
                        id: Some("file1".to_string()),
                        name: "report-%YEAR%-%MONTH%-%DAY%.txt".to_string(),
                        node_type: "file".to_string(),
                        content: Some("Created on %DATE%".to_string()),
                        children: None,
                        url: None,
                        condition_var: None,
                        repeat_count: None,
                        repeat_as: None,
                        ..Default::default()
                    }]),
                    url: None,
                    content: None,
                    condition_var: None,
                    repeat_count: None,
                    repeat_as: None,
                    ..Default::default()
                },
                stats: SchemaStats {
                    folders: 1,
                    files: 1,
                    downloads: 0,
                    ..Default::default()
                },
                hooks: None,
                variable_definitions: None,
            };

            // Call without any user-provided variables
            let variables = HashMap::new();
            let result =
                create_structure_from_tree(&tree, output_path, &variables, false, false, None);
            assert!(result.is_ok());

            // Verify the file was created with correct date substitutions
            let now = chrono::Local::now();
            let expected_filename = format!(
                "report-{}-{}-{}.txt",
                now.format("%Y"),
                now.format("%m"),
                now.format("%d")
            );
            let file_path = temp_dir.path().join("project").join(&expected_filename);
            assert!(
                file_path.exists(),
                "File with date variables should exist: {:?}",
                file_path
            );

            // Verify content also has date substituted
            let content = fs::read_to_string(&file_path).unwrap();
            let expected_date = now.format("%Y-%m-%d").to_string();
            assert!(
                content.contains(&expected_date),
                "Content should contain DATE: {}",
                content
            );
        }

        #[test]
        fn user_can_override_builtin_date_variables() {
            let temp_dir = tempfile::tempdir().unwrap();
            let output_path = temp_dir.path().to_str().unwrap();

            let tree = SchemaTree {
                root: SchemaNode {
                    id: Some("root".to_string()),
                    name: "project".to_string(),
                    node_type: "folder".to_string(),
                    children: Some(vec![SchemaNode {
                        id: Some("file1".to_string()),
                        name: "report-%YEAR%.txt".to_string(),
                        node_type: "file".to_string(),
                        content: None,
                        children: None,
                        url: None,
                        condition_var: None,
                        repeat_count: None,
                        repeat_as: None,
                        ..Default::default()
                    }]),
                    url: None,
                    content: None,
                    condition_var: None,
                    repeat_count: None,
                    repeat_as: None,
                    ..Default::default()
                },
                stats: SchemaStats {
                    folders: 1,
                    files: 1,
                    downloads: 0,
                    ..Default::default()
                },
                hooks: None,
                variable_definitions: None,
            };

            // Override %YEAR% with a custom value
            let mut variables = HashMap::new();
            variables.insert("%YEAR%".to_string(), "2000".to_string());

            let result =
                create_structure_from_tree(&tree, output_path, &variables, false, false, None);
            assert!(result.is_ok());

            // Verify the file was created with the user-provided year, not the current year
            let file_path = temp_dir.path().join("project").join("report-2000.txt");
            assert!(
                file_path.exists(),
                "File should use user-provided YEAR override"
            );
        }

        #[test]
        fn injects_project_name_variable() {
            let temp_dir = tempfile::tempdir().unwrap();
            let output_path = temp_dir.path().to_str().unwrap();

            // Create a schema using %PROJECT_NAME%
            let tree = SchemaTree {
                root: SchemaNode {
                    id: Some("root".to_string()),
                    name: "%PROJECT_NAME%".to_string(),
                    node_type: "folder".to_string(),
                    children: Some(vec![SchemaNode {
                        id: Some("file1".to_string()),
                        name: "README.md".to_string(),
                        node_type: "file".to_string(),
                        content: Some("# %PROJECT_NAME%\n\nWelcome to %PROJECT_NAME%!".to_string()),
                        children: None,
                        url: None,
                        condition_var: None,
                        repeat_count: None,
                        repeat_as: None,
                        ..Default::default()
                    }]),
                    url: None,
                    content: None,
                    condition_var: None,
                    repeat_count: None,
                    repeat_as: None,
                    ..Default::default()
                },
                stats: SchemaStats {
                    folders: 1,
                    files: 1,
                    downloads: 0,
                    ..Default::default()
                },
                hooks: None,
                variable_definitions: None,
            };

            let variables = HashMap::new();
            let result = create_structure_from_tree(
                &tree,
                output_path,
                &variables,
                false,
                false,
                Some("my-awesome-app"),
            );
            assert!(result.is_ok());

            // Verify the folder was created with the project name
            let folder_path = temp_dir.path().join("my-awesome-app");
            assert!(
                folder_path.exists(),
                "Folder should be created with project name"
            );

            // Verify the file content has the project name substituted
            let file_path = folder_path.join("README.md");
            assert!(file_path.exists(), "README.md should exist");
            let content = fs::read_to_string(&file_path).unwrap();
            assert!(
                content.contains("# my-awesome-app"),
                "Content should contain project name: {}",
                content
            );
            assert!(
                content.contains("Welcome to my-awesome-app!"),
                "Content should contain project name: {}",
                content
            );
        }

        #[test]
        fn user_can_override_project_name_variable() {
            let temp_dir = tempfile::tempdir().unwrap();
            let output_path = temp_dir.path().to_str().unwrap();

            let tree = SchemaTree {
                root: SchemaNode {
                    id: Some("root".to_string()),
                    name: "%PROJECT_NAME%".to_string(),
                    node_type: "folder".to_string(),
                    children: None,
                    url: None,
                    content: None,
                    condition_var: None,
                    repeat_count: None,
                    repeat_as: None,
                    ..Default::default()
                },
                stats: SchemaStats {
                    folders: 1,
                    files: 0,
                    downloads: 0,
                    ..Default::default()
                },
                hooks: None,
                variable_definitions: None,
            };

            // Provide both project_name and a user override
            let mut variables = HashMap::new();
            variables.insert(
                "%PROJECT_NAME%".to_string(),
                "user-override-name".to_string(),
            );

            let result = create_structure_from_tree(
                &tree,
                output_path,
                &variables,
                false,
                false,
                Some("injected-name"),
            );
            assert!(result.is_ok());

            // User-provided variable should override the injected project_name
            let folder_path = temp_dir.path().join("user-override-name");
            assert!(
                folder_path.exists(),
                "Folder should use user-provided override"
            );

            // Verify the injected name was NOT used
            let injected_folder = temp_dir.path().join("injected-name");
            assert!(
                !injected_folder.exists(),
                "Injected name should not be used when user overrides"
            );
        }
    }

    mod undo_structure_tests {
        use super::*;

        #[test]
        fn undo_deletes_newly_created_files() {
            let temp_dir = tempfile::tempdir().unwrap();
            let file_path = temp_dir.path().join("test.txt");

            // Create a file
            fs::write(&file_path, "test content").unwrap();
            assert!(file_path.exists());

            let items = vec![CreatedItem {
                path: file_path.to_string_lossy().to_string(),
                item_type: ItemType::File,
                pre_existed: false,
            }];

            let result = undo_structure(&items, false).unwrap();

            assert_eq!(result.summary.files_deleted, 1);
            assert_eq!(result.summary.errors, 0);
            assert!(!file_path.exists(), "File should be deleted");
        }

        #[test]
        fn undo_preserves_pre_existing_files() {
            let temp_dir = tempfile::tempdir().unwrap();
            let file_path = temp_dir.path().join("pre_existing.txt");

            // Create a file
            fs::write(&file_path, "original content").unwrap();
            assert!(file_path.exists());

            let items = vec![CreatedItem {
                path: file_path.to_string_lossy().to_string(),
                item_type: ItemType::File,
                pre_existed: true, // This was overwritten, not newly created
            }];

            let result = undo_structure(&items, false).unwrap();

            assert_eq!(result.summary.files_deleted, 0);
            assert_eq!(result.summary.items_skipped, 1);
            assert!(
                file_path.exists(),
                "Pre-existing file should be preserved"
            );
        }

        #[test]
        fn undo_deletes_empty_folders() {
            let temp_dir = tempfile::tempdir().unwrap();
            let folder_path = temp_dir.path().join("empty_folder");

            // Create an empty folder
            fs::create_dir(&folder_path).unwrap();
            assert!(folder_path.exists());

            let items = vec![CreatedItem {
                path: folder_path.to_string_lossy().to_string(),
                item_type: ItemType::Folder,
                pre_existed: false,
            }];

            let result = undo_structure(&items, false).unwrap();

            assert_eq!(result.summary.folders_deleted, 1);
            assert_eq!(result.summary.errors, 0);
            assert!(!folder_path.exists(), "Empty folder should be deleted");
        }

        #[test]
        fn undo_skips_non_empty_folders() {
            let temp_dir = tempfile::tempdir().unwrap();
            let folder_path = temp_dir.path().join("non_empty_folder");

            // Create a folder with a file inside
            fs::create_dir(&folder_path).unwrap();
            fs::write(folder_path.join("file.txt"), "content").unwrap();
            assert!(folder_path.exists());

            let items = vec![CreatedItem {
                path: folder_path.to_string_lossy().to_string(),
                item_type: ItemType::Folder,
                pre_existed: false,
            }];

            let result = undo_structure(&items, false).unwrap();

            assert_eq!(result.summary.folders_deleted, 0);
            assert_eq!(result.summary.items_skipped, 1);
            assert!(
                folder_path.exists(),
                "Non-empty folder should be preserved"
            );
        }

        #[test]
        fn undo_dry_run_does_not_delete() {
            let temp_dir = tempfile::tempdir().unwrap();
            let file_path = temp_dir.path().join("dry_run_test.txt");

            // Create a file
            fs::write(&file_path, "test content").unwrap();
            assert!(file_path.exists());

            let items = vec![CreatedItem {
                path: file_path.to_string_lossy().to_string(),
                item_type: ItemType::File,
                pre_existed: false,
            }];

            let result = undo_structure(&items, true).unwrap();

            assert_eq!(result.summary.files_deleted, 1); // Would be deleted
            assert!(
                file_path.exists(),
                "File should still exist after dry run"
            );
        }

        #[test]
        fn undo_handles_already_deleted_files() {
            let temp_dir = tempfile::tempdir().unwrap();
            let file_path = temp_dir.path().join("nonexistent.txt");

            // Don't create the file - it doesn't exist
            assert!(!file_path.exists());

            let items = vec![CreatedItem {
                path: file_path.to_string_lossy().to_string(),
                item_type: ItemType::File,
                pre_existed: false,
            }];

            let result = undo_structure(&items, false).unwrap();

            assert_eq!(result.summary.files_deleted, 0);
            assert_eq!(result.summary.items_skipped, 1);
            assert_eq!(result.summary.errors, 0);
        }

        #[test]
        fn undo_deletes_files_before_folders() {
            let temp_dir = tempfile::tempdir().unwrap();
            let folder_path = temp_dir.path().join("folder");
            let file_path = folder_path.join("file.txt");

            // Create folder and file
            fs::create_dir(&folder_path).unwrap();
            fs::write(&file_path, "content").unwrap();

            // Items in creation order (folder first, then file)
            let items = vec![
                CreatedItem {
                    path: folder_path.to_string_lossy().to_string(),
                    item_type: ItemType::Folder,
                    pre_existed: false,
                },
                CreatedItem {
                    path: file_path.to_string_lossy().to_string(),
                    item_type: ItemType::File,
                    pre_existed: false,
                },
            ];

            let result = undo_structure(&items, false).unwrap();

            // Both should be deleted - file first, then empty folder
            assert_eq!(result.summary.files_deleted, 1);
            assert_eq!(result.summary.folders_deleted, 1);
            assert!(!file_path.exists());
            assert!(!folder_path.exists());
        }
    }
}
