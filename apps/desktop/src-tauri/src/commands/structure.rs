//! Structure creation and undo commands.

use std::collections::HashMap;

use crate::schema::parse_xml_schema;
use crate::structure_creator::{create_structure_from_tree, undo_structure};
use crate::types::{CreateResult, CreatedItem, UndoResult};
use crate::schema::SchemaTree;

#[tauri::command]
pub fn cmd_create_structure(
    content: String,
    output_path: String,
    variables: HashMap<String, String>,
    dry_run: bool,
    overwrite: bool,
    project_name: Option<String>,
) -> Result<CreateResult, String> {
    let tree = parse_xml_schema(&content).map_err(|e| e.to_string())?;
    create_structure_from_tree(
        &tree,
        &output_path,
        &variables,
        dry_run,
        overwrite,
        project_name.as_deref(),
    )
}

#[tauri::command]
pub fn cmd_create_structure_from_tree(
    tree: SchemaTree,
    output_path: String,
    variables: HashMap<String, String>,
    dry_run: bool,
    overwrite: bool,
    project_name: Option<String>,
) -> Result<CreateResult, String> {
    create_structure_from_tree(
        &tree,
        &output_path,
        &variables,
        dry_run,
        overwrite,
        project_name.as_deref(),
    )
}

/// Undo a previously created structure by deleting created files and folders
#[tauri::command]
pub fn cmd_undo_structure(items: Vec<CreatedItem>, dry_run: bool) -> Result<UndoResult, String> {
    undo_structure(&items, dry_run)
}
