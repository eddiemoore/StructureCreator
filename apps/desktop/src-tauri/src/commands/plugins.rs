//! Plugin management commands.

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;

use crate::database;
use crate::plugins;
use crate::state::AppState;

#[tauri::command]
pub fn cmd_list_plugins(state: State<Mutex<AppState>>) -> Result<Vec<database::Plugin>, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    state.db.list_plugins().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn cmd_get_plugin(
    state: State<Mutex<AppState>>,
    id: String,
) -> Result<Option<database::Plugin>, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    state.db.get_plugin(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn cmd_install_plugin(
    state: State<Mutex<AppState>>,
    source_path: String,
) -> Result<database::Plugin, String> {
    let source = PathBuf::from(&source_path);

    // Install plugin from source path
    let (dest_path, manifest) =
        plugins::install_plugin_from_path(&source).map_err(|e| e.to_string())?;

    // Create database entry
    let input = plugins::manifest_to_create_input(&manifest, &dest_path);
    let state = state.lock().map_err(|e| e.to_string())?;
    state.db.create_plugin(input).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn cmd_uninstall_plugin(state: State<Mutex<AppState>>, id: String) -> Result<bool, String> {
    let state = state.lock().map_err(|e| e.to_string())?;

    // Get plugin to find its path
    let plugin = state
        .db
        .get_plugin(&id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Plugin not found".to_string())?;

    // Remove from filesystem
    let plugin_path = PathBuf::from(&plugin.path);
    plugins::uninstall_plugin(&plugin_path).map_err(|e| e.to_string())?;

    // Remove from database
    state.db.delete_plugin(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn cmd_enable_plugin(
    state: State<Mutex<AppState>>,
    id: String,
) -> Result<Option<database::Plugin>, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    state.db.enable_plugin(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn cmd_disable_plugin(
    state: State<Mutex<AppState>>,
    id: String,
) -> Result<Option<database::Plugin>, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    state.db.disable_plugin(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn cmd_get_plugin_settings(
    state: State<Mutex<AppState>>,
    id: String,
) -> Result<Option<serde_json::Value>, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    state
        .db
        .get_plugin_settings(&id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn cmd_save_plugin_settings(
    state: State<Mutex<AppState>>,
    id: String,
    settings: serde_json::Value,
) -> Result<Option<database::Plugin>, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    state
        .db
        .save_plugin_settings(&id, settings)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn cmd_scan_plugins() -> Result<Vec<plugins::PluginManifest>, String> {
    let plugins_list = plugins::scan_plugins_directory().map_err(|e| e.to_string())?;
    Ok(plugins_list
        .into_iter()
        .map(|(_, manifest)| manifest)
        .collect())
}

#[tauri::command]
pub fn cmd_sync_plugins(state: State<Mutex<AppState>>) -> Result<Vec<database::Plugin>, String> {
    // Scan the filesystem for plugins
    let scanned = plugins::scan_plugins_directory().map_err(|e| e.to_string())?;

    let state = state.lock().map_err(|e| e.to_string())?;

    // Get current database plugins
    let db_plugins = state.db.list_plugins().map_err(|e| e.to_string())?;

    let db_plugin_names: HashSet<String> = db_plugins.iter().map(|p| p.name.clone()).collect();
    let scanned_names: HashSet<String> = scanned.iter().map(|(_, m)| m.name.clone()).collect();

    // Add new plugins that aren't in DB
    for (path, manifest) in &scanned {
        if !db_plugin_names.contains(&manifest.name) {
            let input = plugins::manifest_to_create_input(manifest, path);
            let _ = state.db.create_plugin(input);
        }
    }

    // Remove DB entries for plugins that no longer exist
    for plugin in &db_plugins {
        if !scanned_names.contains(&plugin.name) {
            let _ = state.db.delete_plugin(&plugin.id);
        }
    }

    // Return updated list
    state.db.list_plugins().map_err(|e| e.to_string())
}
