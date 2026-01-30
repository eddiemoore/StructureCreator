//! Settings commands.

use std::collections::HashMap;
use std::sync::Mutex;
use tauri::State;

use crate::state::AppState;

#[tauri::command]
pub fn cmd_get_settings(state: State<Mutex<AppState>>) -> Result<HashMap<String, String>, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    state.db.get_all_settings().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn cmd_set_setting(
    state: State<Mutex<AppState>>,
    key: String,
    value: String,
) -> Result<(), String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    state
        .db
        .set_setting(&key, &value)
        .map_err(|e| e.to_string())
}
