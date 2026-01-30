//! Structure Creator - Tauri desktop application for generating folder/file structures.
//!
//! This library provides the Rust backend for the Structure Creator application,
//! including schema parsing, structure creation, template management, and more.

// Domain modules (unchanged)
pub mod database;
pub mod generators;
pub mod plugins;
pub mod schema;
pub mod team_library;
pub mod templating;
pub mod transforms;
pub mod validation;

// New extracted modules
pub mod commands;
pub mod diff_preview;
pub mod file_processors;
pub mod state;
pub mod structure_creator;
pub mod types;
pub mod utils;

// Re-exports from domain modules
pub use database::{
    CreateRecentProjectInput, CreateTemplateInput, Database, RecentProject, Template,
    UpdateTemplateInput, ValidationRule,
};
pub use schema::{
    parse_xml_schema, resolve_template_inheritance, scan_folder_to_schema, scan_zip_to_schema,
    schema_to_xml, ParseWithInheritanceResult, SchemaHooks, SchemaNode, SchemaStats, SchemaTree,
    TemplateData,
};
pub use validation::{
    validate_schema, SchemaValidationResult, ValidationIssue, ValidationIssueType,
    ValidationSeverity,
};

// Re-exports from new modules for backward compatibility
pub use diff_preview::generate_diff_preview;
pub use structure_creator::{create_structure_from_tree, undo_structure};
pub use types::*;
pub use utils::*;

// Re-export state for use in commands
pub use state::AppState;

/// Main entry point for the Tauri application.
#[cfg(feature = "tauri-app")]
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use std::sync::Mutex;
    use tauri::{
        menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
        Emitter, Manager,
    };

    use commands::{
        import_export::*, plugins::*, recent_projects::*, schema::*, settings::*, structure::*,
        team_library::*, templates::*, validation::*, watch::*,
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            // Get app data directory
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("Failed to get app data directory");

            // Initialize database
            let db = Database::new(app_data_dir).expect("Failed to initialize database");

            // Store app state
            app.manage(Mutex::new(AppState {
                db,
                watch_stop_tx: None,
                watch_path: None,
            }));

            // Create native menu
            let handle = app.handle();

            // Settings menu item
            let settings_item =
                MenuItem::with_id(handle, "settings", "Settings...", true, Some("CmdOrCtrl+,"))?;

            // Check for Updates menu item
            let check_updates_item = MenuItem::with_id(
                handle,
                "check_updates",
                "Check for Updates...",
                true,
                None::<&str>,
            )?;

            // App submenu (macOS style)
            let app_submenu = Submenu::with_items(
                handle,
                "Structure Creator",
                true,
                &[
                    &PredefinedMenuItem::about(handle, Some("About Structure Creator"), None)?,
                    &check_updates_item,
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
            let new_schema_item =
                MenuItem::with_id(handle, "new_schema", "New Schema", true, Some("CmdOrCtrl+N"))?;
            let file_submenu =
                Submenu::with_items(handle, "File", true, &[&new_schema_item])?;

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
            app.on_menu_event(move |app_handle, event| match event.id().as_ref() {
                "settings" => {
                    let _ = app_handle.emit("open-settings", ());
                }
                "new_schema" => {
                    let _ = app_handle.emit("new-schema", ());
                }
                "check_updates" => {
                    let _ = app_handle.emit("check-for-updates", ());
                }
                _ => {}
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Schema commands
            cmd_parse_schema,
            cmd_parse_schema_with_inheritance,
            cmd_scan_folder,
            cmd_scan_zip,
            cmd_export_schema_xml,
            cmd_extract_variables,
            // Structure commands
            cmd_create_structure,
            cmd_create_structure_from_tree,
            cmd_undo_structure,
            // Template commands
            cmd_list_templates,
            cmd_get_template,
            cmd_create_template,
            cmd_update_template,
            cmd_delete_template,
            cmd_toggle_favorite,
            cmd_use_template,
            cmd_get_all_tags,
            cmd_update_template_tags,
            // Import/Export commands
            cmd_export_template,
            cmd_export_templates_bulk,
            cmd_import_templates_from_json,
            cmd_import_templates_from_url,
            // Settings commands
            cmd_get_settings,
            cmd_set_setting,
            // Validation commands
            cmd_validate_variables,
            cmd_validate_schema,
            cmd_generate_diff_preview,
            // Recent projects commands
            cmd_list_recent_projects,
            cmd_get_recent_project,
            cmd_add_recent_project,
            cmd_delete_recent_project,
            cmd_clear_recent_projects,
            // Watch commands
            cmd_start_watch,
            cmd_stop_watch,
            cmd_get_watch_status,
            // Team Library commands
            cmd_list_team_libraries,
            cmd_add_team_library,
            cmd_update_team_library,
            cmd_remove_team_library,
            cmd_scan_team_library,
            cmd_get_team_template,
            cmd_import_team_template,
            cmd_get_sync_log,
            // Plugin commands
            cmd_list_plugins,
            cmd_get_plugin,
            cmd_install_plugin,
            cmd_uninstall_plugin,
            cmd_enable_plugin,
            cmd_disable_plugin,
            cmd_get_plugin_settings,
            cmd_save_plugin_settings,
            cmd_scan_plugins,
            cmd_sync_plugins
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
