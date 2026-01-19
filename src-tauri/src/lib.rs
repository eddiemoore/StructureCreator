mod database;
mod schema;

use database::{CreateTemplateInput, Database, Template, UpdateTemplateInput};
use schema::{parse_xml_schema, scan_folder_to_schema, schema_to_xml, SchemaTree};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
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

#[tauri::command]
fn cmd_parse_schema(content: String) -> Result<SchemaTree, String> {
    parse_xml_schema(&content).map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_scan_folder(folder_path: String) -> Result<SchemaTree, String> {
    scan_folder_to_schema(&folder_path).map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_export_schema_xml(tree: SchemaTree) -> String {
    schema_to_xml(&tree)
}

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

fn create_structure_from_tree(
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

fn create_node(
    node: &schema::SchemaNode,
    parent_path: &PathBuf,
    variables: &HashMap<String, String>,
    dry_run: bool,
    overwrite: bool,
    logs: &mut Vec<LogEntry>,
    summary: &mut ResultSummary,
) -> Result<(), String> {
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
                for child in children {
                    create_node(child, &current_path, variables, dry_run, overwrite, logs, summary)?;
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
                    // Download file from URL
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
                                    logs.push(LogEntry {
                                        log_type: "success".to_string(),
                                        message: format!("Downloaded: {}", name),
                                        details: Some(format!("From: {}", url)),
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

// Template commands
pub struct AppState {
    pub db: Database,
}

#[tauri::command]
fn cmd_list_templates(state: State<Mutex<AppState>>) -> Result<Vec<Template>, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    state.db.list_templates().map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_get_template(state: State<Mutex<AppState>>, id: String) -> Result<Option<Template>, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    state.db.get_template(&id).map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_create_template(
    state: State<Mutex<AppState>>,
    name: String,
    description: Option<String>,
    schema_xml: String,
    icon_color: Option<String>,
) -> Result<Template, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    state
        .db
        .create_template(CreateTemplateInput {
            name,
            description,
            schema_xml,
            icon_color,
        })
        .map_err(|e| e.to_string())
}

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

#[tauri::command]
fn cmd_delete_template(state: State<Mutex<AppState>>, id: String) -> Result<bool, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    state.db.delete_template(&id).map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_toggle_favorite(state: State<Mutex<AppState>>, id: String) -> Result<Option<Template>, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    state.db.toggle_favorite(&id).map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_use_template(state: State<Mutex<AppState>>, id: String) -> Result<Option<Template>, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    state.db.increment_use_count(&id).map_err(|e| e.to_string())?;
    state.db.get_template(&id).map_err(|e| e.to_string())
}

// Settings commands
#[tauri::command]
fn cmd_get_settings(state: State<Mutex<AppState>>) -> Result<std::collections::HashMap<String, String>, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    state.db.get_all_settings().map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_set_setting(state: State<Mutex<AppState>>, key: String, value: String) -> Result<(), String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    state.db.set_setting(&key, &value).map_err(|e| e.to_string())
}

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
                &[&app_submenu, &edit_submenu, &window_submenu],
            )?;

            app.set_menu(menu)?;

            // Handle menu events
            app.on_menu_event(move |app_handle, event| {
                if event.id().as_ref() == "settings" {
                    // Emit event to frontend to open settings
                    let _ = app_handle.emit("open-settings", ());
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            cmd_parse_schema,
            cmd_scan_folder,
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
