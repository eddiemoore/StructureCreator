//! Plugin management commands.

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;

use crate::database;
use crate::plugins;
use crate::state::AppState;

#[tauri::command]
#[specta::specta]
pub fn cmd_list_plugins(state: State<Mutex<AppState>>) -> Result<Vec<database::Plugin>, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    state.db.plugins().list().map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn cmd_get_plugin(
    state: State<Mutex<AppState>>,
    id: String,
) -> Result<Option<database::Plugin>, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    state.db.plugins().get(&id).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
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
    state.db.plugins().create(input).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn cmd_uninstall_plugin(state: State<Mutex<AppState>>, id: String) -> Result<bool, String> {
    let state = state.lock().map_err(|e| e.to_string())?;

    // Get plugin to find its path
    let plugin = state
        .db
        .plugins().get(&id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Plugin not found".to_string())?;

    // Remove from filesystem
    let plugin_path = PathBuf::from(&plugin.path);
    plugins::uninstall_plugin(&plugin_path).map_err(|e| e.to_string())?;

    // Remove from database
    state.db.plugins().delete(&id).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn cmd_enable_plugin(
    state: State<Mutex<AppState>>,
    id: String,
) -> Result<Option<database::Plugin>, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    state.db.plugins().enable(&id).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn cmd_disable_plugin(
    state: State<Mutex<AppState>>,
    id: String,
) -> Result<Option<database::Plugin>, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    state.db.plugins().disable(&id).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn cmd_get_plugin_settings(
    state: State<Mutex<AppState>>,
    id: String,
) -> Result<Option<serde_json::Value>, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    state
        .db
        .plugins().settings(&id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn cmd_save_plugin_settings(
    state: State<Mutex<AppState>>,
    id: String,
    settings: serde_json::Value,
) -> Result<Option<database::Plugin>, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    state
        .db
        .plugins().save_settings(&id, settings)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn cmd_scan_plugins() -> Result<Vec<plugins::PluginManifest>, String> {
    let plugins_list = plugins::scan_plugins_directory().map_err(|e| e.to_string())?;
    Ok(plugins_list
        .into_iter()
        .map(|(_, manifest)| manifest)
        .collect())
}

#[tauri::command]
#[specta::specta]
pub fn cmd_sync_plugins(state: State<Mutex<AppState>>) -> Result<Vec<database::Plugin>, String> {
    // Scan the filesystem for plugins
    let scanned = plugins::scan_plugins_directory().map_err(|e| e.to_string())?;

    let state = state.lock().map_err(|e| e.to_string())?;

    // Get current database plugins
    let db_plugins = state.db.plugins().list().map_err(|e| e.to_string())?;

    let db_plugin_names: HashSet<String> = db_plugins.iter().map(|p| p.name.clone()).collect();
    let scanned_names: HashSet<String> = scanned.iter().map(|(_, m)| m.name.clone()).collect();

    // Add new plugins that aren't in DB
    for (path, manifest) in &scanned {
        if !db_plugin_names.contains(&manifest.name) {
            let input = plugins::manifest_to_create_input(manifest, path);
            let _ = state.db.plugins().create(input);
        }
    }

    // Remove DB entries for plugins that no longer exist
    for plugin in &db_plugins {
        if !scanned_names.contains(&plugin.name) {
            let _ = state.db.plugins().delete(&plugin.id);
        }
    }

    // Return updated list
    state.db.plugins().list().map_err(|e| e.to_string())
}
