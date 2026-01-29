//! Team Library Module
//!
//! Provides functionality for scanning shared folders containing .sct template files
//! and importing them into the local template database.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::Path;

use crate::database::{CreateTemplateInput, Database, ValidationRule};

/// File extension for Structure Creator Template files
const TEMPLATE_EXTENSION: &str = "sct";

/// Represents a template found in a team library folder
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeamTemplate {
    /// Template name (derived from filename or export metadata)
    pub name: String,
    /// Description from the template export file
    pub description: Option<String>,
    /// Full path to the .sct file
    pub file_path: String,
    /// File modification time (ISO 8601)
    pub modified_at: String,
    /// File size in bytes
    pub size_bytes: u64,
}

/// The structure of an exported .sct template file (matches frontend TemplateExport)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TemplateExport {
    pub name: String,
    pub description: Option<String>,
    pub schema_xml: String,
    #[serde(default)]
    pub variables: Option<HashMap<String, String>>,
    #[serde(default)]
    pub variable_validation: Option<HashMap<String, ValidationRule>>,
    pub icon_color: Option<String>,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
    pub wizard_config: Option<serde_json::Value>,
}

/// The wrapper structure for .sct files (matches frontend TemplateExportFile)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TemplateExportFile {
    pub version: String,
    #[serde(rename = "type")]
    pub file_type: String, // "template" or "template_bundle"
    pub exported_at: String,
    pub template: Option<TemplateExport>,
    pub templates: Option<Vec<TemplateExport>>,
}

/// Strategy for handling duplicate template names during import
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum DuplicateStrategy {
    /// Skip templates that already exist
    Skip,
    /// Replace existing templates with the same name
    Replace,
    /// Create a new template with a unique name (e.g., "Template (2)")
    Rename,
}

/// Result of importing a template
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportResult {
    /// Names of successfully imported templates
    pub imported: Vec<String>,
    /// Names of templates that were skipped (already exist)
    pub skipped: Vec<String>,
    /// Error messages for templates that failed to import
    pub errors: Vec<String>,
}

/// Scan a folder for .sct template files
///
/// Returns a list of TeamTemplate structs representing the templates found.
/// Does not read the full content of each file, just metadata.
pub fn scan_library(path: &str) -> Result<Vec<TeamTemplate>, String> {
    let dir_path = Path::new(path);

    if !dir_path.exists() {
        return Err(format!("Library path does not exist: {}", path));
    }

    if !dir_path.is_dir() {
        return Err(format!("Library path is not a directory: {}", path));
    }

    let mut templates = Vec::new();

    // Read directory entries
    let entries = fs::read_dir(dir_path)
        .map_err(|e| format!("Failed to read directory '{}': {}", path, e))?;

    for entry_result in entries {
        let entry = match entry_result {
            Ok(e) => e,
            Err(e) => {
                eprintln!("Warning: Failed to read directory entry: {}", e);
                continue;
            }
        };

        let file_path = entry.path();

        // Only process .sct files
        if file_path.extension().map(|ext| ext.to_string_lossy().to_lowercase()) != Some(TEMPLATE_EXTENSION.to_string()) {
            continue;
        }

        // Get file metadata
        let metadata = match fs::metadata(&file_path) {
            Ok(m) => m,
            Err(e) => {
                eprintln!("Warning: Failed to get metadata for '{}': {}", file_path.display(), e);
                continue;
            }
        };

        // Skip directories (shouldn't happen with extension check, but be safe)
        if metadata.is_dir() {
            continue;
        }

        // Get modification time
        let modified_at = metadata
            .modified()
            .ok()
            .and_then(|t| {
                let datetime: chrono::DateTime<chrono::Utc> = t.into();
                Some(datetime.to_rfc3339())
            })
            .unwrap_or_else(|| chrono::Utc::now().to_rfc3339());

        // Try to read the template to get its name and description
        // If reading fails, use filename as fallback
        let (name, description) = match read_template_metadata(&file_path) {
            Ok((n, d)) => (n, d),
            Err(_) => {
                // Fallback: use filename without extension
                let fallback_name = file_path
                    .file_stem()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_else(|| "Unknown".to_string());
                (fallback_name, None)
            }
        };

        templates.push(TeamTemplate {
            name,
            description,
            file_path: file_path.to_string_lossy().to_string(),
            modified_at,
            size_bytes: metadata.len(),
        });
    }

    // Sort by name for consistent ordering
    templates.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

    Ok(templates)
}

/// Read just the name and description from a template file (for scanning)
fn read_template_metadata(path: &Path) -> Result<(String, Option<String>), String> {
    let content = fs::read_to_string(path)
        .map_err(|e| format!("Failed to read file: {}", e))?;

    let export_file: TemplateExportFile = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse template file: {}", e))?;

    // Handle single template or bundle
    if let Some(template) = export_file.template {
        Ok((template.name, template.description))
    } else if let Some(templates) = export_file.templates {
        // For bundles, use the first template's info or a summary
        if templates.len() == 1 {
            let t = &templates[0];
            Ok((t.name.clone(), t.description.clone()))
        } else {
            // For multi-template bundles, create a summary name
            let name = path
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| "Bundle".to_string());
            let description = Some(format!("Bundle containing {} templates", templates.len()));
            Ok((name, description))
        }
    } else {
        Err("Invalid template file: no template or templates field".to_string())
    }
}

/// Read and parse a template file completely
pub fn read_template(file_path: &str) -> Result<TemplateExportFile, String> {
    let path = Path::new(file_path);

    if !path.exists() {
        return Err(format!("Template file does not exist: {}", file_path));
    }

    let content = fs::read_to_string(path)
        .map_err(|e| format!("Failed to read template file '{}': {}", file_path, e))?;

    let export_file: TemplateExportFile = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse template file '{}': {}", file_path, e))?;

    // Validate the file structure
    if export_file.template.is_none() && export_file.templates.is_none() {
        return Err("Invalid template file: no template or templates field".to_string());
    }

    Ok(export_file)
}

/// Import a template from a team library into the local database
pub fn import_template(
    db: &Database,
    file_path: &str,
    strategy: DuplicateStrategy,
) -> Result<ImportResult, String> {
    let export_file = read_template(file_path)?;

    let mut result = ImportResult {
        imported: Vec::new(),
        skipped: Vec::new(),
        errors: Vec::new(),
    };

    // Get templates to import (single or bundle)
    let templates: Vec<&TemplateExport> = if let Some(ref t) = export_file.template {
        vec![t]
    } else if let Some(ref templates) = export_file.templates {
        templates.iter().collect()
    } else {
        return Err("Invalid template file: no templates found".to_string());
    };

    for template in templates {
        match import_single_template(db, template, &strategy) {
            Ok(Some(name)) => result.imported.push(name),
            Ok(None) => result.skipped.push(template.name.clone()),
            Err(e) => result.errors.push(format!("{}: {}", template.name, e)),
        }
    }

    Ok(result)
}

/// Import a single template, handling duplicate detection
fn import_single_template(
    db: &Database,
    template: &TemplateExport,
    strategy: &DuplicateStrategy,
) -> Result<Option<String>, String> {
    // Check if template with this name exists
    let existing = db.get_template_by_name(&template.name)
        .map_err(|e| format!("Database error: {}", e))?;

    if let Some(existing_template) = existing {
        match strategy {
            DuplicateStrategy::Skip => {
                return Ok(None); // Skipped
            }
            DuplicateStrategy::Replace => {
                // Delete existing and create new
                db.delete_template(&existing_template.id)
                    .map_err(|e| format!("Failed to delete existing template: {}", e))?;
            }
            DuplicateStrategy::Rename => {
                // Generate a unique name
                let unique_name = db.generate_unique_template_name(&template.name)
                    .map_err(|e| format!("Failed to generate unique name: {}", e))?;

                let input = create_template_input(template, Some(&unique_name));
                db.create_template(input)
                    .map_err(|e| format!("Failed to create template: {}", e))?;

                return Ok(Some(unique_name));
            }
        }
    }

    // Create the template
    let input = create_template_input(template, None);
    db.create_template(input)
        .map_err(|e| format!("Failed to create template: {}", e))?;

    Ok(Some(template.name.clone()))
}

/// Create a CreateTemplateInput from a TemplateExport
fn create_template_input(template: &TemplateExport, override_name: Option<&str>) -> CreateTemplateInput {
    CreateTemplateInput {
        name: override_name.map(|s| s.to_string()).unwrap_or_else(|| template.name.clone()),
        description: template.description.clone(),
        schema_xml: template.schema_xml.clone(),
        variables: template.variables.clone().unwrap_or_default(),
        variable_validation: template.variable_validation.clone().unwrap_or_default(),
        icon_color: template.icon_color.clone(),
        is_favorite: false,
        tags: template.tags.clone().unwrap_or_default(),
        wizard_config: template.wizard_config.clone(),
    }
}

/// Check if a path is accessible (exists and is readable)
pub fn validate_library_path(path: &str) -> Result<(), String> {
    let dir_path = Path::new(path);

    if !dir_path.exists() {
        return Err(format!("Path does not exist: {}", path));
    }

    if !dir_path.is_dir() {
        return Err(format!("Path is not a directory: {}", path));
    }

    // Try to read the directory to verify permissions
    fs::read_dir(dir_path)
        .map_err(|e| format!("Cannot access directory '{}': {}", path, e))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;
    use std::io::Write;

    fn create_test_sct_file(dir: &Path, name: &str, template_name: &str) -> PathBuf {
        let file_path = dir.join(format!("{}.sct", name));
        let content = serde_json::json!({
            "version": "1.0",
            "type": "template",
            "exported_at": "2024-01-01T00:00:00Z",
            "template": {
                "name": template_name,
                "description": "Test description",
                "schema_xml": "<folder name=\"test\"/>",
                "variables": {},
                "icon_color": "#0a84ff",
                "tags": []
            }
        });

        let mut file = fs::File::create(&file_path).unwrap();
        file.write_all(content.to_string().as_bytes()).unwrap();

        file_path
    }

    #[test]
    fn scan_library_finds_sct_files() {
        let temp_dir = TempDir::new().unwrap();
        let dir_path = temp_dir.path();

        // Create test .sct files
        create_test_sct_file(dir_path, "template1", "Template One");
        create_test_sct_file(dir_path, "template2", "Template Two");

        // Create a non-.sct file (should be ignored)
        let txt_path = dir_path.join("readme.txt");
        fs::write(&txt_path, "This is not a template").unwrap();

        let result = scan_library(dir_path.to_str().unwrap()).unwrap();

        assert_eq!(result.len(), 2);
        assert!(result.iter().any(|t| t.name == "Template One"));
        assert!(result.iter().any(|t| t.name == "Template Two"));
    }

    #[test]
    fn scan_library_returns_error_for_nonexistent_path() {
        let result = scan_library("/nonexistent/path/to/library");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("does not exist"));
    }

    #[test]
    fn read_template_parses_single_template() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = create_test_sct_file(temp_dir.path(), "test", "My Template");

        let result = read_template(file_path.to_str().unwrap()).unwrap();

        assert_eq!(result.file_type, "template");
        assert!(result.template.is_some());
        assert_eq!(result.template.unwrap().name, "My Template");
    }

    #[test]
    fn validate_library_path_accepts_valid_directory() {
        let temp_dir = TempDir::new().unwrap();
        let result = validate_library_path(temp_dir.path().to_str().unwrap());
        assert!(result.is_ok());
    }

    #[test]
    fn validate_library_path_rejects_nonexistent() {
        let result = validate_library_path("/nonexistent/path");
        assert!(result.is_err());
    }
}
