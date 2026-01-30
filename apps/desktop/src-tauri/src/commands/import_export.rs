//! Template import and export commands.

use std::collections::HashMap;
use std::sync::Mutex;
use tauri::State;

use crate::database::CreateTemplateInput;
use crate::state::AppState;
use crate::types::{
    DuplicateStrategy, ExportFileType, ImportResult, TemplateExport, TemplateExportFile,
};
use crate::utils::{
    download_file_with_limit, is_valid_version, validate_import_url, validate_template_name,
    MAX_IMPORT_FILE_SIZE,
};

// Shared import logic used by both JSON and URL import commands
fn import_templates_from_json_internal(
    db: &crate::database::Database,
    json_content: &str,
    duplicate_strategy: DuplicateStrategy,
    include_variables: bool,
) -> Result<ImportResult, String> {
    let export_file: TemplateExportFile = serde_json::from_str(json_content)
        .map_err(|e| format!("Invalid .sct file format: {}", e))?;

    // Validate version using strict validation
    if !is_valid_version(&export_file.version) {
        return Err(format!(
            "Unsupported file version: '{}'. Expected format: 1.x (e.g., 1.0)",
            export_file.version
        ));
    }

    // Collect templates to import based on file type (now using enum)
    let templates_to_import: Vec<TemplateExport> = match export_file.file_type {
        ExportFileType::Template => export_file
            .template
            .map(|t| vec![t])
            .ok_or_else(|| "Missing template data in single-template export".to_string())?,
        ExportFileType::TemplateBundle => export_file
            .templates
            .ok_or_else(|| "Missing templates array in bundle export".to_string())?,
    };

    let mut result = ImportResult {
        imported: Vec::new(),
        skipped: Vec::new(),
        errors: Vec::new(),
    };

    for template_export in templates_to_import {
        // Validate template name
        let validated_name = match validate_template_name(&template_export.name) {
            Ok(name) => name,
            Err(e) => {
                result
                    .errors
                    .push(format!("Invalid template '{}': {}", template_export.name, e));
                continue;
            }
        };

        // Check for duplicate (use validated/trimmed name)
        let existing = db
            .get_template_by_name(&validated_name)
            .map_err(|e| e.to_string())?;

        let final_name = if existing.is_some() {
            match duplicate_strategy {
                DuplicateStrategy::Skip => {
                    result.skipped.push(validated_name.clone());
                    continue;
                }
                DuplicateStrategy::Replace => {
                    // Delete existing template
                    if let Err(e) = db.delete_template_by_name(&validated_name) {
                        result
                            .errors
                            .push(format!("Failed to replace '{}': {}", validated_name, e));
                        continue;
                    }
                    validated_name.clone()
                }
                DuplicateStrategy::Rename => {
                    match db.generate_unique_template_name(&validated_name) {
                        Ok(name) => name,
                        Err(e) => {
                            result.errors.push(format!(
                                "Failed to generate unique name for '{}': {}",
                                validated_name, e
                            ));
                            continue;
                        }
                    }
                }
            }
        } else {
            validated_name.clone()
        };

        // Validate schema XML before importing
        if let Err(e) = crate::schema::parse_xml_schema(&template_export.schema_xml) {
            result
                .errors
                .push(format!("Invalid schema in '{}': {}", validated_name, e));
            continue;
        }

        // Determine variables and validation to use
        let (variables, variable_validation) = if include_variables {
            (
                template_export.variables.unwrap_or_default(),
                template_export.variable_validation,
            )
        } else {
            (HashMap::new(), HashMap::new())
        };

        // Create the template
        let input = CreateTemplateInput {
            name: final_name.clone(),
            description: template_export.description,
            schema_xml: template_export.schema_xml,
            variables,
            variable_validation,
            icon_color: template_export.icon_color,
            is_favorite: false,
            tags: template_export.tags,
            wizard_config: template_export.wizard_config,
        };

        match db.create_template(input) {
            Ok(_) => result.imported.push(final_name),
            Err(e) => result
                .errors
                .push(format!("Failed to import '{}': {}", final_name, e)),
        }
    }

    Ok(result)
}

#[tauri::command]
pub fn cmd_export_template(
    state: State<Mutex<AppState>>,
    template_id: String,
    include_variables: bool,
) -> Result<String, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    let template = state
        .db
        .get_template(&template_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Template not found: {}", template_id))?;

    let export = TemplateExport {
        name: template.name,
        description: template.description,
        schema_xml: template.schema_xml,
        variables: if include_variables {
            Some(template.variables)
        } else {
            None
        },
        variable_validation: if include_variables {
            template.variable_validation
        } else {
            HashMap::new()
        },
        icon_color: template.icon_color,
        tags: template.tags,
        wizard_config: template.wizard_config,
    };

    let export_file = TemplateExportFile {
        version: "1.0".to_string(),
        file_type: ExportFileType::Template,
        exported_at: chrono::Utc::now().to_rfc3339(),
        template: Some(export),
        templates: None,
    };

    serde_json::to_string_pretty(&export_file)
        .map_err(|e| format!("Failed to serialize export: {}", e))
}

#[tauri::command]
pub fn cmd_export_templates_bulk(
    state: State<Mutex<AppState>>,
    template_ids: Vec<String>,
    include_variables: bool,
) -> Result<String, String> {
    let state = state.lock().map_err(|e| e.to_string())?;

    // If no IDs provided, export all templates
    let templates = if template_ids.is_empty() {
        state.db.list_templates().map_err(|e| e.to_string())?
    } else {
        let mut result = Vec::new();
        for id in &template_ids {
            if let Some(t) = state.db.get_template(id).map_err(|e| e.to_string())? {
                result.push(t);
            }
        }
        result
    };

    let exports: Vec<TemplateExport> = templates
        .into_iter()
        .map(|t| TemplateExport {
            name: t.name,
            description: t.description,
            schema_xml: t.schema_xml,
            variables: if include_variables {
                Some(t.variables)
            } else {
                None
            },
            variable_validation: if include_variables {
                t.variable_validation
            } else {
                HashMap::new()
            },
            icon_color: t.icon_color,
            tags: t.tags,
            wizard_config: t.wizard_config,
        })
        .collect();

    let export_file = TemplateExportFile {
        version: "1.0".to_string(),
        file_type: ExportFileType::TemplateBundle,
        exported_at: chrono::Utc::now().to_rfc3339(),
        template: None,
        templates: Some(exports),
    };

    serde_json::to_string_pretty(&export_file)
        .map_err(|e| format!("Failed to serialize export: {}", e))
}

#[tauri::command]
pub fn cmd_import_templates_from_json(
    state: State<Mutex<AppState>>,
    json_content: String,
    duplicate_strategy: DuplicateStrategy,
    include_variables: bool,
) -> Result<ImportResult, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    import_templates_from_json_internal(&state.db, &json_content, duplicate_strategy, include_variables)
}

#[tauri::command]
pub fn cmd_import_templates_from_url(
    url: String,
    state: State<Mutex<AppState>>,
    duplicate_strategy: DuplicateStrategy,
    include_variables: bool,
) -> Result<ImportResult, String> {
    // Validate URL to prevent SSRF attacks
    validate_import_url(&url)?;

    // Download the .sct file with size limit
    let json_content = download_file_with_limit(&url, MAX_IMPORT_FILE_SIZE)?;

    // Reuse the shared import logic
    let state = state.lock().map_err(|e| e.to_string())?;
    import_templates_from_json_internal(&state.db, &json_content, duplicate_strategy, include_variables)
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    mod duplicate_strategy_serde_tests {
        use super::*;

        #[test]
        fn serializes_to_snake_case() {
            assert_eq!(
                serde_json::to_string(&DuplicateStrategy::Skip).unwrap(),
                "\"skip\""
            );
            assert_eq!(
                serde_json::to_string(&DuplicateStrategy::Replace).unwrap(),
                "\"replace\""
            );
            assert_eq!(
                serde_json::to_string(&DuplicateStrategy::Rename).unwrap(),
                "\"rename\""
            );
        }

        #[test]
        fn deserializes_from_snake_case() {
            assert_eq!(
                serde_json::from_str::<DuplicateStrategy>("\"skip\"").unwrap(),
                DuplicateStrategy::Skip
            );
            assert_eq!(
                serde_json::from_str::<DuplicateStrategy>("\"replace\"").unwrap(),
                DuplicateStrategy::Replace
            );
            assert_eq!(
                serde_json::from_str::<DuplicateStrategy>("\"rename\"").unwrap(),
                DuplicateStrategy::Rename
            );
        }
    }

    mod template_export_file_serde_tests {
        use super::*;

        #[test]
        fn serializes_single_template_export() {
            let export = TemplateExportFile {
                version: "1.0".to_string(),
                file_type: ExportFileType::Template,
                exported_at: "2024-01-01T00:00:00Z".to_string(),
                template: Some(TemplateExport {
                    name: "Test".to_string(),
                    description: Some("A test template".to_string()),
                    schema_xml: "<folder name=\"test\"/>".to_string(),
                    variables: None,
                    variable_validation: HashMap::new(),
                    icon_color: None,
                    tags: Vec::new(),
                    wizard_config: None,
                }),
                templates: None,
            };

            let json = serde_json::to_string(&export).unwrap();
            assert!(json.contains("\"type\":\"template\""));
            assert!(json.contains("\"version\":\"1.0\""));
            assert!(!json.contains("\"templates\""));
        }

        #[test]
        fn deserializes_template_export() {
            let json = r#"{
                "version": "1.0",
                "type": "template",
                "exported_at": "2024-01-01T00:00:00Z",
                "template": {
                    "name": "Test",
                    "description": "A test",
                    "schema_xml": "<folder/>",
                    "icon_color": null
                }
            }"#;

            let export: TemplateExportFile = serde_json::from_str(json).unwrap();
            assert_eq!(export.version, "1.0");
            assert_eq!(export.file_type, ExportFileType::Template);
            assert!(export.template.is_some());
            assert_eq!(export.template.unwrap().name, "Test");
        }

        #[test]
        fn deserializes_bundle_export() {
            let json = r#"{
                "version": "1.0",
                "type": "template_bundle",
                "exported_at": "2024-01-01T00:00:00Z",
                "templates": [
                    {"name": "A", "description": null, "schema_xml": "<a/>", "icon_color": null},
                    {"name": "B", "description": null, "schema_xml": "<b/>", "icon_color": null}
                ]
            }"#;

            let export: TemplateExportFile = serde_json::from_str(json).unwrap();
            assert_eq!(export.file_type, ExportFileType::TemplateBundle);
            assert!(export.templates.is_some());
            assert_eq!(export.templates.unwrap().len(), 2);
        }
    }
}
