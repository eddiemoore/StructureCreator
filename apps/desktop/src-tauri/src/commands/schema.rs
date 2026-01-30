//! Schema parsing and manipulation commands.

use std::sync::Mutex;
use tauri::State;

use crate::schema::{
    parse_xml_schema, resolve_template_inheritance, scan_folder_to_schema, scan_zip_to_schema,
    schema_to_xml, ParseWithInheritanceResult, SchemaTree, TemplateData,
};
use crate::state::AppState;
use crate::transforms;

#[tauri::command]
pub fn cmd_parse_schema(content: String) -> Result<SchemaTree, String> {
    parse_xml_schema(&content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn cmd_parse_schema_with_inheritance(
    state: State<Mutex<AppState>>,
    content: String,
) -> Result<ParseWithInheritanceResult, String> {
    let state_guard = state.lock().map_err(|e| e.to_string())?;

    // Create a template loader closure that looks up templates from the database
    let loader = |name: &str| -> Option<TemplateData> {
        state_guard
            .db
            .get_template_by_name(name)
            .ok()
            .flatten()
            .map(|t| TemplateData {
                schema_xml: t.schema_xml,
                variables: t.variables,
                variable_validation: t
                    .variable_validation
                    .into_iter()
                    .map(|(k, v)| (k, v.into()))
                    .collect(),
            })
    };

    resolve_template_inheritance(&content, &loader).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn cmd_scan_folder(folder_path: String) -> Result<SchemaTree, String> {
    scan_folder_to_schema(&folder_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn cmd_scan_zip(data: Vec<u8>, filename: String) -> Result<SchemaTree, String> {
    scan_zip_to_schema(&data, &filename).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn cmd_export_schema_xml(tree: SchemaTree) -> String {
    schema_to_xml(&tree)
}

#[tauri::command]
pub fn cmd_extract_variables(content: String) -> Vec<String> {
    transforms::extract_variables_from_content(&content)
}
