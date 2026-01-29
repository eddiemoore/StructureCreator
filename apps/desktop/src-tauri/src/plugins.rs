//! Plugin system for Structure Creator
//!
//! This module handles plugin discovery, manifest parsing, and validation.
//! Plugins are stored in `~/.structure-creator/plugins/` and follow a standard format:
//!
//! ```text
//! ~/.structure-creator/plugins/
//! └── my-plugin/
//!     ├── plugin.json    # Plugin manifest
//!     └── index.js       # Plugin code
//! ```

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

use crate::database::{CreatePluginInput, PluginCapability};

/// Plugin manifest structure (plugin.json)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginManifest {
    /// Unique plugin name (used as directory name)
    pub name: String,
    /// Semantic version (e.g., "1.0.0")
    pub version: String,
    /// Human-readable description
    #[serde(default)]
    pub description: Option<String>,
    /// Plugin capabilities (what hooks it provides)
    #[serde(default)]
    pub capabilities: Vec<String>,
    /// File extensions this plugin processes (for file-processor capability)
    #[serde(default, rename = "fileTypes")]
    pub file_types: Vec<String>,
    /// Main entry point (default: "index.js")
    #[serde(default = "default_main")]
    pub main: String,
    /// Plugin author
    #[serde(default)]
    pub author: Option<String>,
    /// Plugin license
    #[serde(default)]
    pub license: Option<String>,
}

fn default_main() -> String {
    "index.js".to_string()
}

/// Error types for plugin operations
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum PluginError {
    /// Plugin directory not found
    DirectoryNotFound(String),
    /// Manifest file (plugin.json) not found
    ManifestNotFound(String),
    /// Failed to parse manifest
    ManifestParseError(String),
    /// Invalid manifest content
    ManifestValidationError(String),
    /// Main entry point file not found
    MainFileNotFound(String),
    /// Plugin already installed
    AlreadyInstalled(String),
    /// IO error
    IoError(String),
}

impl std::fmt::Display for PluginError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PluginError::DirectoryNotFound(path) => write!(f, "Plugin directory not found: {}", path),
            PluginError::ManifestNotFound(path) => write!(f, "plugin.json not found in: {}", path),
            PluginError::ManifestParseError(msg) => write!(f, "Failed to parse plugin.json: {}", msg),
            PluginError::ManifestValidationError(msg) => write!(f, "Invalid plugin manifest: {}", msg),
            PluginError::MainFileNotFound(path) => write!(f, "Main entry point not found: {}", path),
            PluginError::AlreadyInstalled(name) => write!(f, "Plugin '{}' is already installed", name),
            PluginError::IoError(msg) => write!(f, "IO error: {}", msg),
        }
    }
}

/// Get the plugins directory path (~/.structure-creator/plugins/)
pub fn get_plugins_directory() -> Result<PathBuf, PluginError> {
    let home = dirs::home_dir()
        .ok_or_else(|| PluginError::DirectoryNotFound("Could not determine home directory".to_string()))?;

    let plugins_dir = home.join(".structure-creator").join("plugins");

    // Create directory if it doesn't exist
    if !plugins_dir.exists() {
        fs::create_dir_all(&plugins_dir)
            .map_err(|e| PluginError::IoError(format!("Failed to create plugins directory: {}", e)))?;
    }

    Ok(plugins_dir)
}

/// Parse a plugin manifest from a directory
pub fn parse_manifest(plugin_dir: &PathBuf) -> Result<PluginManifest, PluginError> {
    let manifest_path = plugin_dir.join("plugin.json");

    if !manifest_path.exists() {
        return Err(PluginError::ManifestNotFound(
            plugin_dir.to_string_lossy().to_string()
        ));
    }

    let content = fs::read_to_string(&manifest_path)
        .map_err(|e| PluginError::IoError(format!("Failed to read plugin.json: {}", e)))?;

    let manifest: PluginManifest = serde_json::from_str(&content)
        .map_err(|e| PluginError::ManifestParseError(e.to_string()))?;

    Ok(manifest)
}

/// Validate a plugin manifest
pub fn validate_manifest(manifest: &PluginManifest, plugin_dir: &PathBuf) -> Result<(), PluginError> {
    // Validate name
    if manifest.name.is_empty() {
        return Err(PluginError::ManifestValidationError(
            "Plugin name cannot be empty".to_string()
        ));
    }

    // Name should be valid for filesystem use
    if manifest.name.contains('/') || manifest.name.contains('\\') || manifest.name.contains('\0') {
        return Err(PluginError::ManifestValidationError(
            "Plugin name contains invalid characters".to_string()
        ));
    }

    // Validate version (basic semver format)
    if manifest.version.is_empty() {
        return Err(PluginError::ManifestValidationError(
            "Plugin version cannot be empty".to_string()
        ));
    }

    // Validate capabilities
    for cap in &manifest.capabilities {
        if !is_valid_capability(cap) {
            return Err(PluginError::ManifestValidationError(
                format!("Unknown capability: {}. Valid capabilities are: file-processor, variable-transformer, schema-validator, post-create-hook", cap)
            ));
        }
    }

    // Check main file exists
    let main_path = plugin_dir.join(&manifest.main);
    if !main_path.exists() {
        return Err(PluginError::MainFileNotFound(
            main_path.to_string_lossy().to_string()
        ));
    }

    Ok(())
}

/// Check if a capability string is valid
fn is_valid_capability(cap: &str) -> bool {
    matches!(cap, "file-processor" | "variable-transformer" | "schema-validator" | "post-create-hook")
}

/// Convert capability string to PluginCapability enum
pub fn parse_capability(cap: &str) -> Option<PluginCapability> {
    match cap {
        "file-processor" => Some(PluginCapability::FileProcessor),
        "variable-transformer" => Some(PluginCapability::VariableTransformer),
        "schema-validator" => Some(PluginCapability::SchemaValidator),
        "post-create-hook" => Some(PluginCapability::PostCreateHook),
        _ => None,
    }
}

/// Scan the plugins directory for installed plugins
pub fn scan_plugins_directory() -> Result<Vec<(PathBuf, PluginManifest)>, PluginError> {
    let plugins_dir = get_plugins_directory()?;
    let mut plugins = Vec::new();

    let entries = fs::read_dir(&plugins_dir)
        .map_err(|e| PluginError::IoError(format!("Failed to read plugins directory: {}", e)))?;

    for entry in entries {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };

        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        // Try to parse manifest
        match parse_manifest(&path) {
            Ok(manifest) => {
                // Validate the manifest
                if let Err(e) = validate_manifest(&manifest, &path) {
                    eprintln!("Warning: Invalid plugin at {:?}: {}", path, e);
                    continue;
                }
                plugins.push((path, manifest));
            }
            Err(PluginError::ManifestNotFound(_)) => {
                // Not a plugin directory, skip silently
                continue;
            }
            Err(e) => {
                eprintln!("Warning: Failed to load plugin at {:?}: {}", path, e);
                continue;
            }
        }
    }

    Ok(plugins)
}

/// Convert a PluginManifest to CreatePluginInput
pub fn manifest_to_create_input(manifest: &PluginManifest, path: &PathBuf) -> CreatePluginInput {
    let capabilities: Vec<PluginCapability> = manifest.capabilities
        .iter()
        .filter_map(|c| parse_capability(c))
        .collect();

    CreatePluginInput {
        name: manifest.name.clone(),
        version: manifest.version.clone(),
        description: manifest.description.clone(),
        path: path.to_string_lossy().to_string(),
        capabilities,
        file_types: manifest.file_types.clone(),
    }
}

/// Install a plugin from a source directory
///
/// This copies the plugin to the plugins directory and returns the manifest.
pub fn install_plugin_from_path(source_path: &PathBuf) -> Result<(PathBuf, PluginManifest), PluginError> {
    // Parse and validate the source
    let manifest = parse_manifest(source_path)?;
    validate_manifest(&manifest, source_path)?;

    let plugins_dir = get_plugins_directory()?;
    let dest_path = plugins_dir.join(&manifest.name);

    // Check if already exists
    if dest_path.exists() {
        return Err(PluginError::AlreadyInstalled(manifest.name.clone()));
    }

    // Copy the plugin directory
    copy_dir_recursive(source_path, &dest_path)
        .map_err(|e| PluginError::IoError(format!("Failed to copy plugin: {}", e)))?;

    Ok((dest_path, manifest))
}

/// Uninstall a plugin by removing its directory
pub fn uninstall_plugin(plugin_path: &PathBuf) -> Result<(), PluginError> {
    if !plugin_path.exists() {
        return Err(PluginError::DirectoryNotFound(
            plugin_path.to_string_lossy().to_string()
        ));
    }

    fs::remove_dir_all(plugin_path)
        .map_err(|e| PluginError::IoError(format!("Failed to remove plugin directory: {}", e)))?;

    Ok(())
}

/// Recursively copy a directory
fn copy_dir_recursive(src: &PathBuf, dst: &PathBuf) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;

    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());

        if src_path.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            fs::copy(&src_path, &dst_path)?;
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;
    use std::io::Write;

    fn create_test_plugin(dir: &PathBuf, name: &str, version: &str) -> PathBuf {
        let plugin_dir = dir.join(name);
        fs::create_dir_all(&plugin_dir).unwrap();

        // Create plugin.json
        let manifest = serde_json::json!({
            "name": name,
            "version": version,
            "description": "Test plugin",
            "capabilities": ["file-processor"],
            "fileTypes": [".ts", ".js"]
        });

        let manifest_path = plugin_dir.join("plugin.json");
        let mut file = fs::File::create(&manifest_path).unwrap();
        file.write_all(serde_json::to_string_pretty(&manifest).unwrap().as_bytes()).unwrap();

        // Create index.js
        let main_path = plugin_dir.join("index.js");
        let mut file = fs::File::create(&main_path).unwrap();
        file.write_all(b"export default { name: 'test' };").unwrap();

        plugin_dir
    }

    #[test]
    fn test_parse_manifest() {
        let temp_dir = TempDir::new().unwrap();
        let plugin_dir = create_test_plugin(&temp_dir.path().to_path_buf(), "test-plugin", "1.0.0");

        let manifest = parse_manifest(&plugin_dir).unwrap();
        assert_eq!(manifest.name, "test-plugin");
        assert_eq!(manifest.version, "1.0.0");
        assert_eq!(manifest.capabilities, vec!["file-processor"]);
    }

    #[test]
    fn test_validate_manifest_valid() {
        let temp_dir = TempDir::new().unwrap();
        let plugin_dir = create_test_plugin(&temp_dir.path().to_path_buf(), "valid-plugin", "1.0.0");

        let manifest = parse_manifest(&plugin_dir).unwrap();
        assert!(validate_manifest(&manifest, &plugin_dir).is_ok());
    }

    #[test]
    fn test_validate_manifest_empty_name() {
        let temp_dir = TempDir::new().unwrap();
        let plugin_dir = temp_dir.path().join("bad-plugin");
        fs::create_dir_all(&plugin_dir).unwrap();

        let manifest_content = r#"{"name": "", "version": "1.0.0"}"#;
        fs::write(plugin_dir.join("plugin.json"), manifest_content).unwrap();
        fs::write(plugin_dir.join("index.js"), "").unwrap();

        let manifest = parse_manifest(&plugin_dir).unwrap();
        let result = validate_manifest(&manifest, &plugin_dir);
        assert!(matches!(result, Err(PluginError::ManifestValidationError(_))));
    }

    #[test]
    fn test_validate_manifest_invalid_capability() {
        let temp_dir = TempDir::new().unwrap();
        let plugin_dir = temp_dir.path().join("bad-cap-plugin");
        fs::create_dir_all(&plugin_dir).unwrap();

        let manifest_content = r#"{"name": "test", "version": "1.0.0", "capabilities": ["invalid-cap"]}"#;
        fs::write(plugin_dir.join("plugin.json"), manifest_content).unwrap();
        fs::write(plugin_dir.join("index.js"), "").unwrap();

        let manifest = parse_manifest(&plugin_dir).unwrap();
        let result = validate_manifest(&manifest, &plugin_dir);
        assert!(matches!(result, Err(PluginError::ManifestValidationError(_))));
    }

    #[test]
    fn test_parse_capability() {
        assert_eq!(parse_capability("file-processor"), Some(PluginCapability::FileProcessor));
        assert_eq!(parse_capability("variable-transformer"), Some(PluginCapability::VariableTransformer));
        assert_eq!(parse_capability("schema-validator"), Some(PluginCapability::SchemaValidator));
        assert_eq!(parse_capability("post-create-hook"), Some(PluginCapability::PostCreateHook));
        assert_eq!(parse_capability("unknown"), None);
    }
}
