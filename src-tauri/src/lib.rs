pub mod database;
pub mod schema;

use database::{CreateTemplateInput, Database, Template, UpdateTemplateInput};
use schema::{parse_xml_schema, scan_folder_to_schema, scan_zip_to_schema, schema_to_xml, SchemaTree};
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogEntry {
    pub log_type: String, // "success", "error", "warning", "info"
    pub message: String,
    pub details: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateResult {
    pub logs: Vec<LogEntry>,
    pub summary: ResultSummary,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ResultSummary {
    pub folders_created: usize,
    pub files_created: usize,
    pub files_downloaded: usize,
    pub errors: usize,
    pub skipped: usize,
}

// Tauri command handlers (only compiled with tauri-app feature)
#[cfg(feature = "tauri-app")]
#[tauri::command]
fn cmd_parse_schema(content: String) -> Result<SchemaTree, String> {
    parse_xml_schema(&content).map_err(|e| e.to_string())
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
    create_structure_from_tree_internal(&tree, &output_path, &variables, dry_run, overwrite)
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
    create_structure_from_tree_internal(&tree, &output_path, &variables, dry_run, overwrite)
}

pub fn create_structure_from_tree(
    tree: SchemaTree,
    output_path: String,
    variables: HashMap<String, String>,
    dry_run: bool,
    overwrite: bool,
) -> CreateResult {
    create_structure_from_tree_internal(&tree, &output_path, &variables, dry_run, overwrite).unwrap_or_else(|e| {
        CreateResult {
            logs: vec![LogEntry {
                log_type: "error".to_string(),
                message: e,
                details: None,
            }],
            summary: ResultSummary {
                folders_created: 0,
                files_created: 0,
                files_downloaded: 0,
                errors: 1,
                skipped: 0,
            },
        }
    })
}

fn create_structure_from_tree_internal(
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
    };

    // Create structure recursively
    create_node(&tree.root, &base_path, variables, dry_run, overwrite, &mut logs, &mut summary)?;

    Ok(CreateResult { logs, summary })
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
            .map(|v| !v.is_empty())
            .unwrap_or(false)
    } else {
        false
    }
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
    // Handle conditional nodes (if/else)
    match node.node_type.as_str() {
        "if" => {
            // Evaluate condition using shared helper
            let condition_met = evaluate_if_condition(node, variables);

            // Process children if condition is met
            if condition_met {
                if let Some(children) = &node.children {
                    let mut child_last_if = None;
                    for child in children {
                        create_node_internal(child, parent_path, variables, dry_run, overwrite, logs, summary, child_last_if)?;
                        // Track if results for else blocks
                        if child.node_type == "if" {
                            child_last_if = Some(evaluate_if_condition(child, variables));
                        }
                    }
                }
            }

            return Ok(());
        }
        "else" => {
            // Execute else block if previous if was false
            let should_execute = !last_if_result.unwrap_or(false);

            if should_execute {
                if let Some(children) = &node.children {
                    let mut child_last_if = None;
                    for child in children {
                        create_node_internal(child, parent_path, variables, dry_run, overwrite, logs, summary, child_last_if)?;
                        // Track if results for else blocks
                        if child.node_type == "if" {
                            child_last_if = Some(evaluate_if_condition(child, variables));
                        }
                    }
                }
            }

            return Ok(());
        }
        _ => {}
    }

    // Replace variables in name
    let mut name = node.name.clone();
    for (var_name, var_value) in variables {
        name = name.replace(var_name, var_value);
    }

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
                let mut child_last_if = None;
                for child in children {
                    create_node_internal(child, &current_path, variables, dry_run, overwrite, logs, summary, child_last_if)?;
                    // Track if results for else blocks
                    if child.node_type == "if" {
                        child_last_if = Some(evaluate_if_condition(child, variables));
                    }
                }
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
                                        let mut fallback = content;
                                        for (var_name, var_value) in variables {
                                            fallback = fallback.replace(var_name, var_value);
                                        }
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
                                let mut file_content = content;
                                for (var_name, var_value) in variables {
                                    file_content = file_content.replace(var_name, var_value);
                                }
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
                    let mut file_content = node.content.clone().unwrap_or_default();
                    for (var_name, var_value) in variables {
                        file_content = file_content.replace(var_name, var_value);
                    }
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
                        let mut replaced = text.to_string();
                        for (var_name, var_value) in variables {
                            replaced = replaced.replace(var_name, var_value);
                        }
                        *line = serde_json::Value::String(replaced);
                    }
                }
            }
            // Also handle source as a single string (some notebooks use this format)
            if let Some(source) = cell.get_mut("source").and_then(|s| s.as_str().map(|t| t.to_string())) {
                let mut replaced = source;
                for (var_name, var_value) in variables {
                    replaced = replaced.replace(var_name, var_value);
                }
                cell["source"] = serde_json::Value::String(replaced);
            }
        }
    }

    // Also replace variables in metadata if present
    if let Some(metadata) = notebook.get_mut("metadata") {
        let metadata_str = serde_json::to_string(metadata)
            .map_err(|e| format!("Failed to serialize metadata: {}", e))?;
        let mut replaced = metadata_str;
        for (var_name, var_value) in variables {
            replaced = replaced.replace(var_name, var_value);
        }
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
                let mut modified = content;
                for (var_name, var_value) in variables {
                    modified = modified.replace(var_name, var_value);
                }
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
                    let mut new_text = text.clone();
                    for (var_name, var_value) in variables {
                        new_text = new_text.replace(var_name, var_value);
                    }
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
            let mut new_text = text.clone();
            for (var_name, var_value) in variables {
                new_text = new_text.replace(var_name, var_value);
            }
            if new_text != text {
                *value = new_text.into_bytes();
            }
        }

        // Process default value (DV)
        if let Ok(Object::String(ref mut value, _format)) = field.get_mut(b"DV") {
            let text = String::from_utf8_lossy(value).to_string();
            let mut new_text = text.clone();
            for (var_name, var_value) in variables {
                new_text = new_text.replace(var_name, var_value);
            }
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
            let mut modified_xmp = xmp_str.to_string();

            let mut changed = false;
            for (var_name, var_value) in variables {
                let new_xmp = modified_xmp.replace(var_name, var_value);
                if new_xmp != modified_xmp {
                    changed = true;
                    modified_xmp = new_xmp;
                }
            }

            if changed {
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
                let mut modified_xmp = xmp_str.to_string();

                let mut changed = false;
                for (var_name, var_value) in variables {
                    let new_xmp = modified_xmp.replace(var_name, var_value);
                    if new_xmp != modified_xmp {
                        changed = true;
                        modified_xmp = new_xmp;
                    }
                }

                if changed {
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
            let mut new_text = original.clone();
            for (var_name, var_value) in variables {
                new_text = new_text.replace(var_name, var_value);
            }
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
                for (var_name, var_value) in variables {
                    *value = value.replace(var_name, var_value);
                }
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
            let mut processed = text;
            for (var_name, var_value) in variables {
                processed = processed.replace(var_name, var_value);
            }
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
            let mut modified = content;
            for (var_name, var_value) in variables {
                modified = modified.replace(var_name, var_value);
            }

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

// Template commands - Tauri-specific code
#[cfg(feature = "tauri-app")]
pub struct AppState {
    pub db: Database,
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
    icon_color: Option<String>,
) -> Result<Template, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    state
        .db
        .create_template(CreateTemplateInput {
            name,
            description,
            schema_xml,
            variables,
            icon_color,
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

#[cfg(feature = "tauri-app")]
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            // Get app data directory
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("Failed to get app data directory");

            // Initialize database
            let db = Database::new(app_data_dir).expect("Failed to initialize database");

            // Store app state
            app.manage(Mutex::new(AppState { db }));

            // Create native menu
            let handle = app.handle();

            // Settings menu item
            let settings_item = MenuItem::with_id(handle, "settings", "Settings...", true, Some("CmdOrCtrl+,"))?;

            // App submenu (macOS style)
            let app_submenu = Submenu::with_items(
                handle,
                "Structure Creator",
                true,
                &[
                    &PredefinedMenuItem::about(handle, Some("About Structure Creator"), None)?,
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
                    _ => {}
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            cmd_parse_schema,
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
            cmd_get_settings,
            cmd_set_setting
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
