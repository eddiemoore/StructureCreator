//! Team library management commands.

use std::sync::Mutex;
use tauri::State;

use crate::database::{self, CreateTeamLibraryInput, UpdateTeamLibraryInput};
use crate::state::AppState;
use crate::team_library;

#[tauri::command]
#[specta::specta]
pub fn cmd_list_team_libraries(
    state: State<Mutex<AppState>>,
) -> Result<Vec<database::TeamLibrary>, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    state.db.team_libraries().list().map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn cmd_add_team_library(
    state: State<Mutex<AppState>>,
    name: String,
    path: String,
) -> Result<database::TeamLibrary, String> {
    // Validate the path is accessible
    team_library::validate_library_path(&path)?;

    let state = state.lock().map_err(|e| e.to_string())?;
    let input = CreateTeamLibraryInput {
        name,
        path,
        sync_interval: 300, // 5 minutes default
    };
    state
        .db
        .team_libraries().create(input)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn cmd_update_team_library(
    state: State<Mutex<AppState>>,
    id: String,
    name: Option<String>,
    path: Option<String>,
    sync_interval: Option<i32>,
    is_enabled: Option<bool>,
) -> Result<Option<database::TeamLibrary>, String> {
    // If path is being updated, validate it
    if let Some(ref p) = path {
        team_library::validate_library_path(p)?;
    }

    let state = state.lock().map_err(|e| e.to_string())?;
    let input = UpdateTeamLibraryInput {
        name,
        path,
        sync_interval,
        is_enabled,
    };
    state
        .db
        .team_libraries().update(&id, input)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn cmd_remove_team_library(state: State<Mutex<AppState>>, id: String) -> Result<bool, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    state.db.team_libraries().delete(&id).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn cmd_scan_team_library(
    state: State<Mutex<AppState>>,
    library_id: String,
) -> Result<Vec<team_library::TeamTemplate>, String> {
    let state = state.lock().map_err(|e| e.to_string())?;

    // Get the library to find its path
    let library = state
        .db
        .team_libraries().get(&library_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Library not found: {}", library_id))?;

    if !library.is_enabled {
        return Err("Library is disabled".to_string());
    }

    // Scan the folder
    let templates = team_library::scan_library(&library.path)?;

    // Update last_sync_at timestamp
    state
        .db
        .team_libraries().update_last_sync(&library_id)
        .map_err(|e| eprintln!("Warning: Failed to update last_sync_at: {}", e))
        .ok();

    // Log the scan
    state
        .db
        .team_libraries().add_sync_log(
            &library_id,
            "scan",
            None,
            Some(&format!("Found {} templates", templates.len())),
        )
        .map_err(|e| eprintln!("Warning: Failed to log scan: {}", e))
        .ok();

    Ok(templates)
}

#[tauri::command]
#[specta::specta]
pub fn cmd_get_team_template(
    file_path: String,
) -> Result<team_library::TemplateExportFile, String> {
    team_library::read_template(&file_path)
}

#[tauri::command]
#[specta::specta]
pub fn cmd_import_team_template(
    state: State<Mutex<AppState>>,
    library_id: String,
    file_path: String,
    strategy: String,
) -> Result<team_library::ImportResult, String> {
    let duplicate_strategy = match strategy.as_str() {
        "skip" => team_library::DuplicateStrategy::Skip,
        "replace" => team_library::DuplicateStrategy::Replace,
        "rename" => team_library::DuplicateStrategy::Rename,
        _ => return Err(format!("Invalid duplicate strategy: {}", strategy)),
    };

    let state = state.lock().map_err(|e| e.to_string())?;

    let result = team_library::import_template(&state.db, &file_path, duplicate_strategy)?;

    // Log the import
    for imported_name in &result.imported {
        state
            .db
            .team_libraries().add_sync_log(&library_id, "import", Some(imported_name), None)
            .map_err(|e| eprintln!("Warning: Failed to log import: {}", e))
            .ok();
    }

    for error in &result.errors {
        state
            .db
            .team_libraries().add_sync_log(&library_id, "error", None, Some(error))
            .map_err(|e| eprintln!("Warning: Failed to log error: {}", e))
            .ok();
    }

    Ok(result)
}

#[tauri::command]
#[specta::specta]
pub fn cmd_get_sync_log(
    state: State<Mutex<AppState>>,
    library_id: Option<String>,
    limit: i32,
) -> Result<Vec<database::SyncLogEntry>, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    state
        .db
        .team_libraries().sync_log(library_id.as_deref(), limit)
        .map_err(|e| e.to_string())
}
