//! Template CRUD and management commands.

use std::collections::HashMap;
use std::sync::Mutex;
use tauri::State;

use crate::database::{CreateTemplateInput, Template, UpdateTemplateInput, ValidationRule};
use crate::state::AppState;

#[tauri::command]
pub fn cmd_list_templates(state: State<Mutex<AppState>>) -> Result<Vec<Template>, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    state.db.list_templates().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn cmd_get_template(
    state: State<Mutex<AppState>>,
    id: String,
) -> Result<Option<Template>, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    state.db.get_template(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn cmd_create_template(
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

#[tauri::command]
pub fn cmd_update_template(
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

#[tauri::command]
pub fn cmd_delete_template(state: State<Mutex<AppState>>, id: String) -> Result<bool, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    state.db.delete_template(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn cmd_toggle_favorite(
    state: State<Mutex<AppState>>,
    id: String,
) -> Result<Option<Template>, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    state.db.toggle_favorite(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn cmd_use_template(
    state: State<Mutex<AppState>>,
    id: String,
) -> Result<Option<Template>, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    state
        .db
        .increment_use_count(&id)
        .map_err(|e| e.to_string())?;
    state.db.get_template(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn cmd_get_all_tags(state: State<Mutex<AppState>>) -> Result<Vec<String>, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    state.db.get_all_tags().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn cmd_update_template_tags(
    state: State<Mutex<AppState>>,
    id: String,
    tags: Vec<String>,
) -> Result<Option<Template>, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    state
        .db
        .update_template_tags(&id, tags)
        .map_err(|e| e.to_string())
}
