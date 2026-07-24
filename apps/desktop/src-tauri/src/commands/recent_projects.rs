//! Recent projects tracking commands.

use std::collections::HashMap;
use std::sync::Mutex;
use tauri::State;

use crate::database::{CreateRecentProjectInput, RecentProject, ValidationRule};
use crate::state::AppState;

#[tauri::command]
#[specta::specta]
pub fn cmd_list_recent_projects(
    state: State<Mutex<AppState>>,
) -> Result<Vec<RecentProject>, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    state.db.recent_projects().list().map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn cmd_get_recent_project(
    state: State<Mutex<AppState>>,
    id: String,
) -> Result<Option<RecentProject>, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    state.db.recent_projects().get(&id).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn cmd_add_recent_project(
    state: State<Mutex<AppState>>,
    project_name: String,
    output_path: String,
    schema_xml: String,
    variables: HashMap<String, String>,
    variable_validation: HashMap<String, ValidationRule>,
    template_id: Option<String>,
    template_name: Option<String>,
    folders_created: i32,
    files_created: i32,
) -> Result<RecentProject, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    state
        .db
        .recent_projects().add(CreateRecentProjectInput {
            project_name,
            output_path,
            schema_xml,
            variables,
            variable_validation,
            template_id,
            template_name,
            folders_created,
            files_created,
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn cmd_delete_recent_project(
    state: State<Mutex<AppState>>,
    id: String,
) -> Result<bool, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    state
        .db
        .recent_projects().delete(&id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn cmd_clear_recent_projects(state: State<Mutex<AppState>>) -> Result<usize, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    state.db.recent_projects().clear().map_err(|e| e.to_string())
}
