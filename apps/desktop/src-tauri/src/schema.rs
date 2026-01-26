use quick_xml::events::{BytesStart, Event};
use quick_xml::Reader;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::io::Read;

/// Default condition variable name for if blocks without an explicit var attribute
const DEFAULT_CONDITION_VAR: &str = "CONDITION";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchemaNode {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(rename = "type")]
    pub node_type: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<SchemaNode>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub condition_var: Option<String>,
    /// For repeat nodes: the count expression (variable like "%NUM%" or literal "3")
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repeat_count: Option<String>,
    /// For repeat nodes: the iteration variable name (e.g., "i" creates %i%)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repeat_as: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchemaStats {
    pub folders: usize,
    pub files: usize,
    pub downloads: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SchemaHooks {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub post_create: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchemaTree {
    pub root: SchemaNode,
    pub stats: SchemaStats,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hooks: Option<SchemaHooks>,
}

pub fn parse_xml_schema(xml_content: &str) -> Result<SchemaTree, Box<dyn std::error::Error>> {
    let mut reader = Reader::from_str(xml_content);
    reader.config_mut().trim_text(true);

    let mut stack: Vec<SchemaNode> = Vec::new();
    let mut root: Option<SchemaNode> = None;
    let mut hooks: Option<SchemaHooks> = None;
    let mut in_hooks = false;
    let mut current_hook_text = String::new();

    loop {
        match reader.read_event() {
            Ok(Event::Start(ref e)) => {
                let name_bytes = e.name();
                let tag_name = std::str::from_utf8(name_bytes.as_ref())?;

                if tag_name == "hooks" {
                    in_hooks = true;
                    if hooks.is_none() {
                        hooks = Some(SchemaHooks::default());
                    }
                } else if in_hooks && tag_name == "post-create" {
                    current_hook_text.clear();
                } else if let Some(node) = parse_element(e)? {
                    stack.push(node);
                }
            }
            Ok(Event::Text(ref e)) => {
                if in_hooks {
                    current_hook_text.push_str(&e.unescape()?.into_owned());
                }
            }
            Ok(Event::Empty(ref e)) => {
                let name_bytes = e.name();
                let tag_name = std::str::from_utf8(name_bytes.as_ref())?;

                // Skip hooks-related empty tags
                if tag_name == "hooks" || (in_hooks && tag_name == "post-create") {
                    continue;
                }

                if let Some(node) = parse_element(e)? {
                    // Self-closing tag - add to parent
                    if let Some(parent) = stack.last_mut() {
                        parent.children.get_or_insert_with(Vec::new).push(node);
                    } else {
                        root = Some(node);
                    }
                }
            }
            Ok(Event::End(ref e)) => {
                let name_bytes = e.name();
                let tag_name = std::str::from_utf8(name_bytes.as_ref())?;

                if tag_name == "hooks" {
                    in_hooks = false;
                } else if in_hooks && tag_name == "post-create" {
                    let cmd = current_hook_text.trim().to_string();
                    if !cmd.is_empty() {
                        if let Some(ref mut h) = hooks {
                            h.post_create.push(cmd);
                        }
                    }
                    current_hook_text.clear();
                } else if let Some(node) = stack.pop() {
                    if let Some(parent) = stack.last_mut() {
                        parent.children.get_or_insert_with(Vec::new).push(node);
                    } else {
                        root = Some(node);
                    }
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(Box::new(e)),
            _ => {}
        }
    }

    let root = root.ok_or("No root element found")?;
    let stats = calculate_stats(&root);

    Ok(SchemaTree { root, stats, hooks })
}

fn parse_element(e: &BytesStart) -> Result<Option<SchemaNode>, Box<dyn std::error::Error>> {
    let name_bytes = e.name();
    let tag_name = std::str::from_utf8(name_bytes.as_ref())?;

    let node_type = match tag_name {
        "folder" => "folder",
        "file" => "file",
        "if" => "if",
        "else" => "else",
        "repeat" => "repeat",
        _ => return Ok(None),
    };

    let mut name = String::new();
    let mut url: Option<String> = None;
    let mut condition_var: Option<String> = None;
    let mut repeat_count: Option<String> = None;
    let mut repeat_as: Option<String> = None;

    for attr in e.attributes() {
        let attr = attr?;
        let key = std::str::from_utf8(attr.key.as_ref())?;
        let value = std::str::from_utf8(&attr.value)?;

        match key {
            "name" => name = value.to_string(),
            "url" => url = Some(value.to_string()),
            "var" => condition_var = Some(value.to_string()),
            "count" => repeat_count = Some(value.to_string()),
            "as" => repeat_as = Some(value.to_string()),
            _ => {}
        }
    }

    // For if/else/repeat nodes, name is not required and defaults to empty string
    if node_type == "folder" || node_type == "file" {
        if name.is_empty() {
            return Ok(None);
        }
    }

    Ok(Some(SchemaNode {
        id: None,
        node_type: node_type.to_string(),
        name,
        url,
        content: None,
        children: None,
        condition_var,
        repeat_count,
        repeat_as,
    }))
}

fn calculate_stats(node: &SchemaNode) -> SchemaStats {
    let mut stats = SchemaStats {
        folders: 0,
        files: 0,
        downloads: 0,
    };

    count_nodes(node, &mut stats);
    stats
}

fn count_nodes(node: &SchemaNode, stats: &mut SchemaStats) {
    match node.node_type.as_str() {
        "folder" => stats.folders += 1,
        "file" => {
            stats.files += 1;
            if node.url.is_some() {
                stats.downloads += 1;
            }
        }
        // if/else/repeat are control structures, not counted
        "if" | "else" | "repeat" => {}
        _ => {}
    }

    if let Some(children) = &node.children {
        for child in children {
            count_nodes(child, stats);
        }
    }
}

/// Scan a folder and generate a SchemaTree from its structure
pub fn scan_folder_to_schema(folder_path: &str) -> Result<SchemaTree, Box<dyn std::error::Error>> {
    use std::path::Path;

    let path = Path::new(folder_path);
    if !path.exists() {
        return Err("Folder does not exist".into());
    }
    if !path.is_dir() {
        return Err("Path is not a directory".into());
    }

    let folder_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("root")
        .to_string();

    let root = scan_directory(path, &folder_name)?;
    let stats = calculate_stats(&root);

    Ok(SchemaTree { root, stats, hooks: None })
}

fn scan_directory(path: &std::path::Path, name: &str) -> Result<SchemaNode, Box<dyn std::error::Error>> {
    use std::fs;

    let mut children: Vec<SchemaNode> = Vec::new();

    let mut entries: Vec<_> = fs::read_dir(path)?
        .filter_map(|e| e.ok())
        .collect();

    // Sort entries: folders first, then files, alphabetically within each group
    entries.sort_by(|a, b| {
        let a_is_dir = a.path().is_dir();
        let b_is_dir = b.path().is_dir();
        match (a_is_dir, b_is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.file_name().cmp(&b.file_name()),
        }
    });

    for entry in entries {
        let entry_path = entry.path();
        let entry_name = entry
            .file_name()
            .to_str()
            .unwrap_or("unknown")
            .to_string();

        // Skip hidden files and common ignore patterns
        if entry_name.starts_with('.')
            || entry_name == "node_modules"
            || entry_name == "target"
            || entry_name == "__pycache__"
            || entry_name == ".git"
            || entry_name == "dist"
            || entry_name == "build"
        {
            continue;
        }

        if entry_path.is_dir() {
            let child = scan_directory(&entry_path, &entry_name)?;
            children.push(child);
        } else if entry_path.is_file() {
            // Try to read file content (skip large or binary files)
            let content = read_file_content(&entry_path);

            children.push(SchemaNode {
                id: None,
                node_type: "file".to_string(),
                name: entry_name,
                url: None,
                content,
                children: None,
                condition_var: None,
                repeat_count: None,
                repeat_as: None,
            });
        }
    }

    Ok(SchemaNode {
        id: None,
        node_type: "folder".to_string(),
        name: name.to_string(),
        url: None,
        content: None,
        children: if children.is_empty() { None } else { Some(children) },
        condition_var: None,
        repeat_count: None,
        repeat_as: None,
    })
}

/// Read file content if it's a text file and not too large
fn read_file_content(path: &std::path::Path) -> Option<String> {
    use std::fs;

    // Max file size to read (1MB)
    const MAX_FILE_SIZE: u64 = 1024 * 1024;

    // Check file size first
    let metadata = fs::metadata(path).ok()?;
    if metadata.len() > MAX_FILE_SIZE {
        return None;
    }

    // Skip known binary extensions
    let extension = path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase());

    let binary_extensions = [
        "png", "jpg", "jpeg", "gif", "bmp", "ico", "webp",
        "mp3", "mp4", "wav", "avi", "mov", "mkv", "webm",
        "zip", "tar", "gz", "rar", "7z",
        "exe", "dll", "so", "dylib",
        "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
        "ttf", "otf", "woff", "woff2", "eot",
        "db", "sqlite", "sqlite3",
        "pyc", "class", "o", "obj",
    ];

    if let Some(ext) = &extension {
        if binary_extensions.contains(&ext.as_str()) {
            return None;
        }
    }

    // Try to read as UTF-8 text
    match fs::read_to_string(path) {
        Ok(content) => Some(content),
        Err(_) => None, // Likely binary file
    }
}

/// Generate XML from a SchemaTree
pub fn schema_to_xml(tree: &SchemaTree) -> String {
    let mut xml = String::from("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
    node_to_xml(&tree.root, &mut xml, 0);

    // Add hooks if present
    if let Some(ref hooks) = tree.hooks {
        if !hooks.post_create.is_empty() {
            xml.push_str("<hooks>\n");
            for cmd in &hooks.post_create {
                xml.push_str(&format!("  <post-create>{}</post-create>\n", escape_xml(cmd)));
            }
            xml.push_str("</hooks>\n");
        }
    }

    xml
}

fn node_to_xml(node: &SchemaNode, xml: &mut String, indent: usize) {
    let indent_str = "  ".repeat(indent);

    match node.node_type.as_str() {
        "folder" => {
            if let Some(children) = &node.children {
                if children.is_empty() {
                    xml.push_str(&format!("{}<folder name=\"{}\" />\n", indent_str, escape_xml(&node.name)));
                } else {
                    xml.push_str(&format!("{}<folder name=\"{}\">\n", indent_str, escape_xml(&node.name)));
                    for child in children {
                        node_to_xml(child, xml, indent + 1);
                    }
                    xml.push_str(&format!("{}</folder>\n", indent_str));
                }
            } else {
                xml.push_str(&format!("{}<folder name=\"{}\" />\n", indent_str, escape_xml(&node.name)));
            }
        }
        "file" => {
            if let Some(url) = &node.url {
                xml.push_str(&format!("{}<file name=\"{}\" url=\"{}\" />\n",
                    indent_str, escape_xml(&node.name), escape_xml(url)));
            } else {
                xml.push_str(&format!("{}<file name=\"{}\" />\n", indent_str, escape_xml(&node.name)));
            }
        }
        "if" => {
            // Use condition_var or default to prevent data loss
            let var = node.condition_var.as_deref().unwrap_or(DEFAULT_CONDITION_VAR);
            xml.push_str(&format!("{}<if var=\"{}\">\n", indent_str, escape_xml(var)));
            if let Some(children) = &node.children {
                for child in children {
                    node_to_xml(child, xml, indent + 1);
                }
            }
            xml.push_str(&format!("{}</if>\n", indent_str));
        }
        "else" => {
            // Always export else blocks, even if empty, to preserve structure
            xml.push_str(&format!("{}<else>\n", indent_str));
            if let Some(children) = &node.children {
                for child in children {
                    node_to_xml(child, xml, indent + 1);
                }
            }
            xml.push_str(&format!("{}</else>\n", indent_str));
        }
        "repeat" => {
            let count = node.repeat_count.as_deref().unwrap_or("1");
            let as_var = node.repeat_as.as_deref().unwrap_or("i");

            if node.children.is_some() && !node.children.as_ref().unwrap().is_empty() {
                xml.push_str(&format!(
                    "{}<repeat count=\"{}\" as=\"{}\">\n",
                    indent_str, escape_xml(count), escape_xml(as_var)
                ));
                if let Some(children) = &node.children {
                    for child in children {
                        node_to_xml(child, xml, indent + 1);
                    }
                }
                xml.push_str(&format!("{}</repeat>\n", indent_str));
            } else {
                xml.push_str(&format!(
                    "{}<repeat count=\"{}\" as=\"{}\" />\n",
                    indent_str, escape_xml(count), escape_xml(as_var)
                ));
            }
        }
        _ => {}
    }
}

fn escape_xml(s: &str) -> String {
    s.replace('&', "&amp;")
     .replace('<', "&lt;")
     .replace('>', "&gt;")
     .replace('"', "&quot;")
     .replace('\'', "&apos;")
}

/// Scan a ZIP file and generate a SchemaTree from its structure
pub fn scan_zip_to_schema(data: &[u8], archive_name: &str) -> Result<SchemaTree, Box<dyn std::error::Error>> {
    use std::collections::HashMap;
    use std::io::Cursor;
    use zip::ZipArchive;

    let cursor = Cursor::new(data);
    let mut archive = ZipArchive::new(cursor)?;

    // Build a tree structure from the ZIP entries
    // Key: parent path, Value: children nodes
    let mut tree_map: HashMap<String, Vec<SchemaNode>> = HashMap::new();
    tree_map.insert(String::new(), Vec::new()); // Root level

    // Collect all entries with their paths
    let mut entries: Vec<(String, bool, Option<String>)> = Vec::new();

    for i in 0..archive.len() {
        let mut file = archive.by_index(i)?;
        let name = file.name().to_string();

        // Skip hidden files/folders and common ignore patterns
        if should_skip_entry(&name) {
            continue;
        }

        let is_dir = file.is_dir();

        // Read content for non-directory files
        let content = if !is_dir {
            read_zip_file_content(&mut file, &name)
        } else {
            None
        };

        entries.push((name, is_dir, content));
    }

    // Sort entries so directories come before their contents
    entries.sort_by(|a, b| a.0.cmp(&b.0));

    // Process entries and build the tree
    for (path, is_dir, content) in entries {
        let path = path.trim_end_matches('/');
        let parts: Vec<&str> = path.split('/').collect();

        if parts.is_empty() {
            continue;
        }

        // Ensure parent directories exist in the map
        let mut current_path = String::new();
        for (i, part) in parts.iter().enumerate() {
            if i < parts.len() - 1 {
                // This is a parent directory
                let next_path = if current_path.is_empty() {
                    part.to_string()
                } else {
                    format!("{}/{}", current_path, part)
                };

                if !tree_map.contains_key(&next_path) {
                    tree_map.insert(next_path.clone(), Vec::new());

                    // Add folder node to parent
                    tree_map.entry(current_path.clone())
                        .or_default()
                        .push(SchemaNode {
                            id: None,
                            node_type: "folder".to_string(),
                            name: part.to_string(),
                            url: None,
                            content: None,
                            children: None, // Will be filled later
                            condition_var: None,
                            repeat_count: None,
                            repeat_as: None,
                        });
                }

                current_path = next_path;
            } else {
                // This is the actual entry (file or folder)
                let node = SchemaNode {
                    id: None,
                    node_type: if is_dir { "folder" } else { "file" }.to_string(),
                    name: part.to_string(),
                    url: None,
                    content: content.clone(),
                    children: None,
                    condition_var: None,
                    repeat_count: None,
                    repeat_as: None,
                };

                if is_dir {
                    let dir_path = if current_path.is_empty() {
                        part.to_string()
                    } else {
                        format!("{}/{}", current_path, part)
                    };
                    tree_map.entry(dir_path).or_default();
                }

                tree_map.entry(current_path.clone())
                    .or_default()
                    .push(node);
            }
        }
    }

    // Build the final tree structure recursively
    let root_name = archive_name
        .trim_end_matches(".zip")
        .trim_end_matches(".ZIP");

    let root = build_tree_from_map(&tree_map, "", root_name);
    let stats = calculate_stats(&root);

    Ok(SchemaTree { root, stats, hooks: None })
}

/// Check if a ZIP entry should be skipped
fn should_skip_entry(name: &str) -> bool {
    let parts: Vec<&str> = name.split('/').collect();

    for part in parts {
        if part.is_empty() {
            continue;
        }
        if part.starts_with('.')
            || part == "node_modules"
            || part == "target"
            || part == "__pycache__"
            || part == ".git"
            || part == "dist"
            || part == "build"
            || part == "__MACOSX"
            || part == ".DS_Store"
            || part == "Thumbs.db"
        {
            return true;
        }
    }
    false
}

/// Read content from a ZIP file entry if it's a text file
fn read_zip_file_content<R: Read>(file: &mut R, name: &str) -> Option<String> {
    // Max file size to read (1MB)
    const MAX_FILE_SIZE: usize = 1024 * 1024;

    // Get extension
    let extension = std::path::Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase());

    let binary_extensions = [
        "png", "jpg", "jpeg", "gif", "bmp", "ico", "webp",
        "mp3", "mp4", "wav", "avi", "mov", "mkv", "webm",
        "zip", "tar", "gz", "rar", "7z",
        "exe", "dll", "so", "dylib",
        "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
        "ttf", "otf", "woff", "woff2", "eot",
        "db", "sqlite", "sqlite3",
        "pyc", "class", "o", "obj",
    ];

    if let Some(ext) = &extension {
        if binary_extensions.contains(&ext.as_str()) {
            return None;
        }
    }

    // Read content (with size limit)
    let mut content = Vec::new();
    let mut limited_reader = file.take(MAX_FILE_SIZE as u64 + 1);

    if limited_reader.read_to_end(&mut content).is_err() {
        return None;
    }

    // Skip if file is too large
    if content.len() > MAX_FILE_SIZE {
        return None;
    }

    // Try to convert to UTF-8
    String::from_utf8(content).ok()
}

/// Build a SchemaNode tree from the flat map structure
fn build_tree_from_map(
    tree_map: &std::collections::HashMap<String, Vec<SchemaNode>>,
    current_path: &str,
    name: &str,
) -> SchemaNode {
    let children_nodes = tree_map.get(current_path).cloned().unwrap_or_default();

    // Process children, recursively building folders
    let mut processed_children: Vec<SchemaNode> = Vec::new();

    for mut child in children_nodes {
        if child.node_type == "folder" {
            let child_path = if current_path.is_empty() {
                child.name.clone()
            } else {
                format!("{}/{}", current_path, child.name)
            };

            // Recursively build this folder's children
            child = build_tree_from_map(tree_map, &child_path, &child.name);
        }
        processed_children.push(child);
    }

    // Sort: folders first, then files, alphabetically within each group
    processed_children.sort_by(|a, b| {
        let a_is_dir = a.node_type == "folder";
        let b_is_dir = b.node_type == "folder";
        match (a_is_dir, b_is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.cmp(&b.name),
        }
    });

    SchemaNode {
        id: None,
        node_type: "folder".to_string(),
        name: name.to_string(),
        url: None,
        content: None,
        children: if processed_children.is_empty() {
            None
        } else {
            Some(processed_children)
        },
        condition_var: None,
        repeat_count: None,
        repeat_as: None,
    }
}

// ============================================================================
// Template Inheritance Support
// ============================================================================

/// Maximum depth of template inheritance to prevent runaway recursion.
/// 10 levels is generous for real-world use cases while preventing stack overflow
/// from malformed circular dependencies that bypass detection.
const MAX_INHERITANCE_DEPTH: usize = 10;

/// Validation rule for a variable (frontend API version).
///
/// This type mirrors `database::ValidationRule` but uses camelCase serialization
/// for frontend compatibility. We need both types because:
/// - `database::ValidationRule`: snake_case for SQLite JSON storage (backwards compatible)
/// - `schema::ValidationRule`: camelCase for frontend API responses
///
/// Use `From<database::ValidationRule>` for easy conversion.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ValidationRule {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pattern: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_length: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_length: Option<usize>,
    #[serde(default)]
    pub required: bool,
}

impl From<crate::database::ValidationRule> for ValidationRule {
    fn from(db_rule: crate::database::ValidationRule) -> Self {
        Self {
            pattern: db_rule.pattern,
            min_length: db_rule.min_length,
            max_length: db_rule.max_length,
            required: db_rule.required,
        }
    }
}

/// Data returned by the template loader function
#[derive(Debug, Clone)]
pub struct TemplateData {
    pub schema_xml: String,
    pub variables: HashMap<String, String>,
    pub variable_validation: HashMap<String, ValidationRule>,
}

/// Result of parsing a schema with inheritance resolved
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParseWithInheritanceResult {
    pub tree: SchemaTree,
    pub merged_variables: HashMap<String, String>,
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub merged_variable_validation: HashMap<String, ValidationRule>,
    pub base_templates: Vec<String>,
}

/// Error types for template inheritance
#[derive(Debug)]
pub enum InheritanceError {
    CircularDependency(Vec<String>),
    TemplateNotFound(String),
    MaxDepthExceeded,
    ParseError(String),
}

impl std::fmt::Display for InheritanceError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            InheritanceError::CircularDependency(chain) => {
                write!(f, "Circular template dependency detected: {}", chain.join(" -> "))
            }
            InheritanceError::TemplateNotFound(name) => {
                write!(f, "Template '{}' not found", name)
            }
            InheritanceError::MaxDepthExceeded => {
                write!(f, "Maximum inheritance depth ({}) exceeded", MAX_INHERITANCE_DEPTH)
            }
            InheritanceError::ParseError(msg) => {
                write!(f, "Parse error: {}", msg)
            }
        }
    }
}

impl std::error::Error for InheritanceError {}

/// Extract the `extends` attribute from a `<template>` element if present.
/// Returns a list of template names to extend (comma-separated).
pub fn extract_extends_attribute(xml_content: &str) -> Result<Vec<String>, Box<dyn std::error::Error>> {
    let mut reader = Reader::from_str(xml_content);
    reader.config_mut().trim_text(true);

    loop {
        match reader.read_event() {
            Ok(Event::Start(ref e)) | Ok(Event::Empty(ref e)) => {
                let name_bytes = e.name();
                let tag_name = std::str::from_utf8(name_bytes.as_ref())?;

                if tag_name == "template" {
                    // Look for extends attribute
                    for attr in e.attributes() {
                        let attr = attr?;
                        let key = std::str::from_utf8(attr.key.as_ref())?;
                        if key == "extends" {
                            let value = std::str::from_utf8(&attr.value)?;
                            // Split by comma and trim whitespace
                            let extends: Vec<String> = value
                                .split(',')
                                .map(|s| s.trim().to_string())
                                .filter(|s| !s.is_empty())
                                .collect();
                            return Ok(extends);
                        }
                    }
                    // Template element found but no extends attribute
                    return Ok(Vec::new());
                }
                // If we hit a non-template element first, no inheritance
                return Ok(Vec::new());
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(Box::new(e)),
            _ => {}
        }
    }

    Ok(Vec::new())
}

/// Parse the children of a `<template>` element (the extension content).
/// Returns a list of SchemaNodes that should be appended to the base template.
fn parse_template_children(xml_content: &str) -> Result<(Vec<SchemaNode>, Option<SchemaHooks>), Box<dyn std::error::Error>> {
    let mut reader = Reader::from_str(xml_content);
    reader.config_mut().trim_text(true);

    let mut stack: Vec<SchemaNode> = Vec::new();
    let mut root_children: Vec<SchemaNode> = Vec::new();
    let mut in_template = false;
    let mut template_depth = 0;
    let mut hooks: Option<SchemaHooks> = None;
    let mut in_hooks = false;
    let mut current_hook_text = String::new();

    loop {
        match reader.read_event() {
            Ok(Event::Start(ref e)) => {
                let name_bytes = e.name();
                let tag_name = std::str::from_utf8(name_bytes.as_ref())?;

                if tag_name == "template" && !in_template {
                    in_template = true;
                    template_depth = 1;
                    continue;
                }

                if in_template {
                    template_depth += 1;

                    if tag_name == "hooks" {
                        in_hooks = true;
                        if hooks.is_none() {
                            hooks = Some(SchemaHooks::default());
                        }
                    } else if in_hooks && tag_name == "post-create" {
                        current_hook_text.clear();
                    } else if let Some(node) = parse_element(e)? {
                        stack.push(node);
                    }
                }
            }
            Ok(Event::Text(ref e)) => {
                if in_hooks {
                    current_hook_text.push_str(&e.unescape()?.into_owned());
                }
            }
            Ok(Event::Empty(ref e)) => {
                if !in_template {
                    continue;
                }

                let name_bytes = e.name();
                let tag_name = std::str::from_utf8(name_bytes.as_ref())?;

                if tag_name == "hooks" || (in_hooks && tag_name == "post-create") {
                    continue;
                }

                if let Some(node) = parse_element(e)? {
                    if let Some(parent) = stack.last_mut() {
                        parent.children.get_or_insert_with(Vec::new).push(node);
                    } else {
                        root_children.push(node);
                    }
                }
            }
            Ok(Event::End(ref e)) => {
                let name_bytes = e.name();
                let tag_name = std::str::from_utf8(name_bytes.as_ref())?;

                if tag_name == "template" && in_template {
                    template_depth -= 1;
                    if template_depth == 0 {
                        in_template = false;
                    }
                    continue;
                }

                if in_template {
                    template_depth -= 1;

                    if tag_name == "hooks" {
                        in_hooks = false;
                    } else if in_hooks && tag_name == "post-create" {
                        let cmd = current_hook_text.trim().to_string();
                        if !cmd.is_empty() {
                            if let Some(ref mut h) = hooks {
                                h.post_create.push(cmd);
                            }
                        }
                        current_hook_text.clear();
                    } else if let Some(node) = stack.pop() {
                        if let Some(parent) = stack.last_mut() {
                            parent.children.get_or_insert_with(Vec::new).push(node);
                        } else {
                            root_children.push(node);
                        }
                    }
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(Box::new(e)),
            _ => {}
        }
    }

    Ok((root_children, hooks))
}

/// Merge extension children into the base tree's root node.
fn merge_extension_into_base(base: &mut SchemaNode, extension_children: Vec<SchemaNode>) {
    if extension_children.is_empty() {
        return;
    }

    if let Some(ref mut children) = base.children {
        children.extend(extension_children);
    } else {
        base.children = Some(extension_children);
    }
}

/// Merge hooks from extension into base hooks.
fn merge_hooks(base: Option<SchemaHooks>, extension: Option<SchemaHooks>) -> Option<SchemaHooks> {
    match (base, extension) {
        (None, None) => None,
        (Some(b), None) => Some(b),
        (None, Some(e)) => Some(e),
        (Some(mut b), Some(e)) => {
            b.post_create.extend(e.post_create);
            Some(b)
        }
    }
}

/// Resolve template inheritance by loading base templates and merging them.
///
/// # Arguments
/// * `xml_content` - The XML content of the template to resolve
/// * `template_loader` - A function that loads a template by name, returning TemplateData
///
/// # Returns
/// A ParseWithInheritanceResult containing the resolved tree, merged variables/validation, and list of base templates used
///
/// # Multiple Inheritance Behavior
/// When extending multiple templates (`extends="base1, base2"`), only the first base's root node
/// attributes (name, etc.) are used. Subsequent bases' root attributes are ignored, but their
/// children are merged. This is intentional to avoid ambiguity about which root "wins".
pub fn resolve_template_inheritance<F>(
    xml_content: &str,
    template_loader: &F,
) -> Result<ParseWithInheritanceResult, InheritanceError>
where
    F: Fn(&str) -> Option<TemplateData>,
{
    let mut visited = HashSet::new();
    let mut base_templates = Vec::new();
    resolve_inheritance_internal(xml_content, template_loader, &mut visited, &mut base_templates, MAX_INHERITANCE_DEPTH)
}

fn resolve_inheritance_internal<F>(
    xml_content: &str,
    template_loader: &F,
    visited: &mut HashSet<String>,
    base_templates: &mut Vec<String>,
    remaining_depth: usize,
) -> Result<ParseWithInheritanceResult, InheritanceError>
where
    F: Fn(&str) -> Option<TemplateData>,
{
    if remaining_depth == 0 {
        return Err(InheritanceError::MaxDepthExceeded);
    }

    // Extract extends attribute
    let extends = extract_extends_attribute(xml_content)
        .map_err(|e| InheritanceError::ParseError(e.to_string()))?;

    if extends.is_empty() {
        // No inheritance - just parse normally
        let tree = parse_xml_schema(xml_content)
            .map_err(|e| InheritanceError::ParseError(e.to_string()))?;
        return Ok(ParseWithInheritanceResult {
            tree,
            merged_variables: HashMap::new(),
            merged_variable_validation: HashMap::new(),
            base_templates: base_templates.clone(),
        });
    }

    // We have inheritance to resolve
    let mut accumulated_root: Option<SchemaNode> = None;
    let mut accumulated_hooks: Option<SchemaHooks> = None;
    let mut accumulated_variables: HashMap<String, String> = HashMap::new();
    let mut accumulated_validation: HashMap<String, ValidationRule> = HashMap::new();

    // Process each base template in order (left to right)
    for base_name in &extends {
        // Validate template name
        let base_name = base_name.trim();
        if base_name.is_empty() {
            continue; // Skip empty names (e.g., from "base1,,base2")
        }

        // Check for circular dependency using the ordered chain for clear error messages
        if visited.contains(base_name) {
            // Build chain from base_templates (which preserves order) plus the cycle point
            let mut chain = base_templates.clone();
            chain.push(base_name.to_string());
            return Err(InheritanceError::CircularDependency(chain));
        }

        // Load the base template
        let base_data = template_loader(base_name)
            .ok_or_else(|| InheritanceError::TemplateNotFound(base_name.to_string()))?;

        // Mark as visited before recursing
        visited.insert(base_name.to_string());
        base_templates.push(base_name.to_string());

        // Recursively resolve the base template's inheritance
        let base_result = resolve_inheritance_internal(
            &base_data.schema_xml,
            template_loader,
            visited,
            base_templates,
            remaining_depth - 1,
        )?;

        // Remove from visited after processing (for sibling branches in diamond inheritance)
        visited.remove(base_name);

        // Merge base variables (earlier bases are overridden by later ones)
        accumulated_variables.extend(base_data.variables);
        accumulated_variables.extend(base_result.merged_variables);

        // Merge validation rules (earlier bases are overridden by later ones)
        accumulated_validation.extend(base_data.variable_validation);
        accumulated_validation.extend(base_result.merged_variable_validation);

        // Merge base tree
        if let Some(ref mut acc_root) = accumulated_root {
            // Append base's children to accumulated root
            if let Some(base_children) = base_result.tree.root.children {
                merge_extension_into_base(acc_root, base_children);
            }
        } else {
            accumulated_root = Some(base_result.tree.root);
        }

        // Merge hooks
        accumulated_hooks = merge_hooks(accumulated_hooks, base_result.tree.hooks);
    }

    // Now parse the extension's own children (content inside <template>)
    let (extension_children, extension_hooks) = parse_template_children(xml_content)
        .map_err(|e| InheritanceError::ParseError(e.to_string()))?;

    // Merge extension children into accumulated root
    if let Some(ref mut root) = accumulated_root {
        merge_extension_into_base(root, extension_children);
    }

    // Merge extension hooks
    accumulated_hooks = merge_hooks(accumulated_hooks, extension_hooks);

    // Build final tree
    let root = accumulated_root.ok_or_else(|| {
        InheritanceError::ParseError("No root element after inheritance resolution".to_string())
    })?;

    let stats = calculate_stats(&root);

    Ok(ParseWithInheritanceResult {
        tree: SchemaTree {
            root,
            stats,
            hooks: accumulated_hooks,
        },
        merged_variables: accumulated_variables,
        merged_variable_validation: accumulated_validation,
        base_templates: base_templates.clone(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_simple_schema() {
        let xml = r#"
            <folder name="test">
                <folder name="src" />
                <file name="readme.txt" />
            </folder>
        "#;

        let tree = parse_xml_schema(xml).unwrap();
        assert_eq!(tree.root.name, "test");
        assert_eq!(tree.stats.folders, 2);
        assert_eq!(tree.stats.files, 1);
    }

    #[test]
    fn test_parse_schema_with_hooks() {
        let xml = r#"
            <folder name="my-project">
                <file name="package.json" />
            </folder>
            <hooks>
                <post-create>npm install</post-create>
                <post-create>git init</post-create>
            </hooks>
        "#;

        let tree = parse_xml_schema(xml).unwrap();
        assert_eq!(tree.root.name, "my-project");
        assert!(tree.hooks.is_some());
        let hooks = tree.hooks.unwrap();
        assert_eq!(hooks.post_create.len(), 2);
        assert_eq!(hooks.post_create[0], "npm install");
        assert_eq!(hooks.post_create[1], "git init");
    }

    #[test]
    fn test_parse_schema_without_hooks() {
        let xml = r#"
            <folder name="test">
                <file name="readme.txt" />
            </folder>
        "#;

        let tree = parse_xml_schema(xml).unwrap();
        assert!(tree.hooks.is_none());
    }

    #[test]
    fn test_parse_schema_with_empty_hooks() {
        let xml = r#"
            <folder name="test">
                <file name="readme.txt" />
            </folder>
            <hooks>
            </hooks>
        "#;

        let tree = parse_xml_schema(xml).unwrap();
        // hooks should exist but be empty
        assert!(tree.hooks.is_some());
        assert!(tree.hooks.unwrap().post_create.is_empty());
    }

    #[test]
    fn test_schema_to_xml_with_hooks() {
        let tree = SchemaTree {
            root: SchemaNode {
                id: None,
                node_type: "folder".to_string(),
                name: "test".to_string(),
                url: None,
                content: None,
                children: None,
                condition_var: None,
                repeat_count: None,
                repeat_as: None,
            },
            stats: SchemaStats {
                folders: 1,
                files: 0,
                downloads: 0,
            },
            hooks: Some(SchemaHooks {
                post_create: vec!["npm install".to_string(), "git init".to_string()],
            }),
        };

        let xml = schema_to_xml(&tree);
        assert!(xml.contains("<hooks>"));
        assert!(xml.contains("<post-create>npm install</post-create>"));
        assert!(xml.contains("<post-create>git init</post-create>"));
        assert!(xml.contains("</hooks>"));
    }

    #[test]
    fn test_schema_to_xml_without_hooks() {
        let tree = SchemaTree {
            root: SchemaNode {
                id: None,
                node_type: "folder".to_string(),
                name: "test".to_string(),
                url: None,
                content: None,
                children: None,
                condition_var: None,
                repeat_count: None,
                repeat_as: None,
            },
            stats: SchemaStats {
                folders: 1,
                files: 0,
                downloads: 0,
            },
            hooks: None,
        };

        let xml = schema_to_xml(&tree);
        assert!(!xml.contains("<hooks>"));
    }

    #[test]
    fn test_parse_hooks_with_special_characters() {
        let xml = r#"
            <folder name="test" />
            <hooks>
                <post-create>echo "Hello &amp; World"</post-create>
            </hooks>
        "#;

        let tree = parse_xml_schema(xml).unwrap();
        assert!(tree.hooks.is_some());
        let hooks = tree.hooks.unwrap();
        assert_eq!(hooks.post_create.len(), 1);
        assert_eq!(hooks.post_create[0], "echo \"Hello & World\"");
    }

    #[test]
    fn test_parse_repeat_schema() {
        let xml = r#"
            <folder name="project">
                <repeat count="3" as="i">
                    <folder name="module_%i%">
                        <file name="index.ts" />
                    </folder>
                </repeat>
            </folder>
        "#;

        let tree = parse_xml_schema(xml).unwrap();
        assert_eq!(tree.root.name, "project");

        // The repeat node should be a child of root
        let children = tree.root.children.as_ref().unwrap();
        assert_eq!(children.len(), 1);

        let repeat_node = &children[0];
        assert_eq!(repeat_node.node_type, "repeat");
        assert_eq!(repeat_node.repeat_count, Some("3".to_string()));
        assert_eq!(repeat_node.repeat_as, Some("i".to_string()));

        // Repeat node should have children
        let repeat_children = repeat_node.children.as_ref().unwrap();
        assert_eq!(repeat_children.len(), 1);
        assert_eq!(repeat_children[0].node_type, "folder");
        assert_eq!(repeat_children[0].name, "module_%i%");
    }

    #[test]
    fn test_repeat_schema_to_xml() {
        let tree = SchemaTree {
            root: SchemaNode {
                id: None,
                node_type: "folder".to_string(),
                name: "project".to_string(),
                url: None,
                content: None,
                children: Some(vec![
                    SchemaNode {
                        id: None,
                        node_type: "repeat".to_string(),
                        name: "".to_string(),
                        url: None,
                        content: None,
                        children: Some(vec![
                            SchemaNode {
                                id: None,
                                node_type: "folder".to_string(),
                                name: "module_%i%".to_string(),
                                url: None,
                                content: None,
                                children: None,
                                condition_var: None,
                                repeat_count: None,
                                repeat_as: None,
                            }
                        ]),
                        condition_var: None,
                        repeat_count: Some("5".to_string()),
                        repeat_as: Some("idx".to_string()),
                    }
                ]),
                condition_var: None,
                repeat_count: None,
                repeat_as: None,
            },
            stats: SchemaStats {
                folders: 2,
                files: 0,
                downloads: 0,
            },
            hooks: None,
        };

        let xml = schema_to_xml(&tree);
        assert!(xml.contains("<repeat count=\"5\" as=\"idx\">"));
        assert!(xml.contains("</repeat>"));
        assert!(xml.contains("<folder name=\"module_%i%\""));
    }

    #[test]
    fn test_repeat_with_variable_count() {
        let xml = r#"
            <folder name="root">
                <repeat count="%NUM_MODULES%" as="j">
                    <file name="file_%j%.txt" />
                </repeat>
            </folder>
        "#;

        let tree = parse_xml_schema(xml).unwrap();
        let repeat_node = &tree.root.children.as_ref().unwrap()[0];
        assert_eq!(repeat_node.repeat_count, Some("%NUM_MODULES%".to_string()));
        assert_eq!(repeat_node.repeat_as, Some("j".to_string()));
    }

    // ========================================================================
    // Template Inheritance Tests
    // ========================================================================

    #[test]
    fn test_extract_extends_attribute_single() {
        let xml = r#"<template extends="base-react-app">
            <folder name="extra" />
        </template>"#;

        let extends = extract_extends_attribute(xml).unwrap();
        assert_eq!(extends, vec!["base-react-app"]);
    }

    #[test]
    fn test_extract_extends_attribute_multiple() {
        let xml = r#"<template extends="base1, base2, base3">
            <folder name="extra" />
        </template>"#;

        let extends = extract_extends_attribute(xml).unwrap();
        assert_eq!(extends, vec!["base1", "base2", "base3"]);
    }

    #[test]
    fn test_extract_extends_attribute_none() {
        let xml = r#"<folder name="project">
            <file name="readme.txt" />
        </folder>"#;

        let extends = extract_extends_attribute(xml).unwrap();
        assert!(extends.is_empty());
    }

    #[test]
    fn test_extract_extends_template_without_extends() {
        let xml = r#"<template>
            <folder name="project" />
        </template>"#;

        let extends = extract_extends_attribute(xml).unwrap();
        assert!(extends.is_empty());
    }

    #[test]
    fn test_resolve_inheritance_no_extends() {
        let xml = r#"<folder name="project">
            <file name="readme.txt" />
        </folder>"#;

        let loader = |_name: &str| -> Option<TemplateData> {
            None
        };

        let result = resolve_template_inheritance(xml, &loader).unwrap();
        assert_eq!(result.tree.root.name, "project");
        assert!(result.base_templates.is_empty());
    }

    #[test]
    fn test_resolve_inheritance_single_base() {
        let base_xml = r#"<folder name="%PROJECT%">
            <file name="package.json" />
            <folder name="src">
                <file name="index.ts" />
            </folder>
        </folder>"#;

        let extending_xml = r#"<template extends="base-project">
            <folder name="features">
                <file name="feature.ts" />
            </folder>
        </template>"#;

        let mut base_vars = HashMap::new();
        base_vars.insert("PROJECT".to_string(), "my-app".to_string());

        let mut base_validation = HashMap::new();
        base_validation.insert("PROJECT".to_string(), ValidationRule {
            required: true,
            ..Default::default()
        });

        let loader = |name: &str| -> Option<TemplateData> {
            if name == "base-project" {
                Some(TemplateData {
                    schema_xml: base_xml.to_string(),
                    variables: base_vars.clone(),
                    variable_validation: base_validation.clone(),
                })
            } else {
                None
            }
        };

        let result = resolve_template_inheritance(extending_xml, &loader).unwrap();

        // Root should be from base
        assert_eq!(result.tree.root.name, "%PROJECT%");

        // Should have base children + extension children
        let children = result.tree.root.children.as_ref().unwrap();
        assert_eq!(children.len(), 3); // package.json, src, features

        // Check extension was appended
        let features = children.iter().find(|c| c.name == "features").unwrap();
        assert_eq!(features.node_type, "folder");

        // Check variables were inherited
        assert_eq!(result.merged_variables.get("PROJECT"), Some(&"my-app".to_string()));

        // Check validation rules were inherited
        assert!(result.merged_variable_validation.get("PROJECT").unwrap().required);

        // Check base templates list
        assert_eq!(result.base_templates, vec!["base-project"]);
    }

    #[test]
    fn test_resolve_inheritance_multiple_bases() {
        let base1_xml = r#"<folder name="%PROJECT%">
            <file name="readme.md" />
        </folder>"#;

        let base2_xml = r#"<folder name="%PROJECT%">
            <folder name="src" />
        </folder>"#;

        let extending_xml = r#"<template extends="base1, base2">
            <file name="extra.txt" />
        </template>"#;

        let mut base1_vars = HashMap::new();
        base1_vars.insert("PROJECT".to_string(), "from-base1".to_string());

        let mut base2_vars = HashMap::new();
        base2_vars.insert("PROJECT".to_string(), "from-base2".to_string());
        base2_vars.insert("OTHER".to_string(), "value".to_string());

        let loader = |name: &str| -> Option<TemplateData> {
            match name {
                "base1" => Some(TemplateData {
                    schema_xml: base1_xml.to_string(),
                    variables: base1_vars.clone(),
                    variable_validation: HashMap::new(),
                }),
                "base2" => Some(TemplateData {
                    schema_xml: base2_xml.to_string(),
                    variables: base2_vars.clone(),
                    variable_validation: HashMap::new(),
                }),
                _ => None,
            }
        };

        let result = resolve_template_inheritance(extending_xml, &loader).unwrap();

        // Should have children from both bases plus extension
        let children = result.tree.root.children.as_ref().unwrap();
        assert_eq!(children.len(), 3); // readme.md, src, extra.txt

        // Later base variables override earlier ones
        assert_eq!(result.merged_variables.get("PROJECT"), Some(&"from-base2".to_string()));
        assert_eq!(result.merged_variables.get("OTHER"), Some(&"value".to_string()));

        // Both base templates in list
        assert_eq!(result.base_templates, vec!["base1", "base2"]);
    }

    #[test]
    fn test_resolve_inheritance_template_not_found() {
        let xml = r#"<template extends="nonexistent">
            <folder name="extra" />
        </template>"#;

        let loader = |_name: &str| -> Option<TemplateData> {
            None
        };

        let result = resolve_template_inheritance(xml, &loader);
        assert!(matches!(result, Err(InheritanceError::TemplateNotFound(name)) if name == "nonexistent"));
    }

    #[test]
    fn test_resolve_inheritance_circular_dependency() {
        // A extends B, B extends A
        let template_a = r#"<template extends="template-b">
            <file name="a.txt" />
        </template>"#;

        let template_b = r#"<template extends="template-a">
            <file name="b.txt" />
        </template>"#;

        let loader = |name: &str| -> Option<TemplateData> {
            match name {
                "template-a" => Some(TemplateData {
                    schema_xml: template_a.to_string(),
                    variables: HashMap::new(),
                    variable_validation: HashMap::new(),
                }),
                "template-b" => Some(TemplateData {
                    schema_xml: template_b.to_string(),
                    variables: HashMap::new(),
                    variable_validation: HashMap::new(),
                }),
                _ => None,
            }
        };

        let result = resolve_template_inheritance(template_a, &loader);
        assert!(matches!(result, Err(InheritanceError::CircularDependency(_))));
    }

    #[test]
    fn test_resolve_inheritance_with_hooks() {
        let base_xml = r#"<folder name="project">
            <file name="package.json" />
        </folder>
        <hooks>
            <post-create>npm install</post-create>
        </hooks>"#;

        let extending_xml = r#"<template extends="base">
            <file name="extra.txt" />
            <hooks>
                <post-create>git init</post-create>
            </hooks>
        </template>"#;

        let loader = |name: &str| -> Option<TemplateData> {
            if name == "base" {
                Some(TemplateData {
                    schema_xml: base_xml.to_string(),
                    variables: HashMap::new(),
                    variable_validation: HashMap::new(),
                })
            } else {
                None
            }
        };

        let result = resolve_template_inheritance(extending_xml, &loader).unwrap();

        // Hooks should be merged (base first, then extension)
        let hooks = result.tree.hooks.unwrap();
        assert_eq!(hooks.post_create.len(), 2);
        assert_eq!(hooks.post_create[0], "npm install");
        assert_eq!(hooks.post_create[1], "git init");
    }

    #[test]
    fn test_resolve_inheritance_nested() {
        // C extends B, B extends A
        let template_a = r#"<folder name="root">
            <file name="from-a.txt" />
        </folder>"#;

        let template_b = r#"<template extends="template-a">
            <file name="from-b.txt" />
        </template>"#;

        let template_c = r#"<template extends="template-b">
            <file name="from-c.txt" />
        </template>"#;

        let loader = |name: &str| -> Option<TemplateData> {
            match name {
                "template-a" => Some(TemplateData {
                    schema_xml: template_a.to_string(),
                    variables: HashMap::new(),
                    variable_validation: HashMap::new(),
                }),
                "template-b" => Some(TemplateData {
                    schema_xml: template_b.to_string(),
                    variables: HashMap::new(),
                    variable_validation: HashMap::new(),
                }),
                _ => None,
            }
        };

        let result = resolve_template_inheritance(template_c, &loader).unwrap();

        // Should have all three files
        let children = result.tree.root.children.as_ref().unwrap();
        assert_eq!(children.len(), 3);

        let names: Vec<&str> = children.iter().map(|c| c.name.as_str()).collect();
        assert!(names.contains(&"from-a.txt"));
        assert!(names.contains(&"from-b.txt"));
        assert!(names.contains(&"from-c.txt"));

        // Base templates should include both A and B
        assert!(result.base_templates.contains(&"template-a".to_string()));
        assert!(result.base_templates.contains(&"template-b".to_string()));
    }

    #[test]
    fn test_resolve_inheritance_empty_template() {
        // Template with extends but no children
        let base_xml = r#"<folder name="project">
            <file name="base.txt" />
        </folder>"#;

        let extending_xml = r#"<template extends="base"></template>"#;

        let loader = |name: &str| -> Option<TemplateData> {
            if name == "base" {
                Some(TemplateData {
                    schema_xml: base_xml.to_string(),
                    variables: HashMap::new(),
                    variable_validation: HashMap::new(),
                })
            } else {
                None
            }
        };

        let result = resolve_template_inheritance(extending_xml, &loader).unwrap();

        // Should still have base content
        assert_eq!(result.tree.root.name, "project");
        let children = result.tree.root.children.as_ref().unwrap();
        assert_eq!(children.len(), 1);
        assert_eq!(children[0].name, "base.txt");
    }

    #[test]
    fn test_resolve_inheritance_self_reference() {
        // Template that tries to extend itself
        let self_ref = r#"<template extends="myself">
            <file name="test.txt" />
        </template>"#;

        let loader = |name: &str| -> Option<TemplateData> {
            if name == "myself" {
                Some(TemplateData {
                    schema_xml: self_ref.to_string(),
                    variables: HashMap::new(),
                    variable_validation: HashMap::new(),
                })
            } else {
                None
            }
        };

        let result = resolve_template_inheritance(self_ref, &loader);
        assert!(matches!(result, Err(InheritanceError::CircularDependency(chain)) if chain.contains(&"myself".to_string())));
    }

    #[test]
    fn test_resolve_inheritance_empty_extends_values() {
        // Handles "base1,,base2" gracefully (empty string between commas)
        let base_xml = r#"<folder name="project">
            <file name="base.txt" />
        </folder>"#;

        let extending_xml = r#"<template extends="base, , ">
            <file name="extra.txt" />
        </template>"#;

        let loader = |name: &str| -> Option<TemplateData> {
            if name == "base" {
                Some(TemplateData {
                    schema_xml: base_xml.to_string(),
                    variables: HashMap::new(),
                    variable_validation: HashMap::new(),
                })
            } else {
                None
            }
        };

        let result = resolve_template_inheritance(extending_xml, &loader).unwrap();

        // Should work, ignoring empty names
        assert_eq!(result.tree.root.name, "project");
        let children = result.tree.root.children.as_ref().unwrap();
        assert_eq!(children.len(), 2); // base.txt and extra.txt
    }

    #[test]
    fn test_resolve_inheritance_validation_rules_override() {
        // Child validation rules should override base
        let base_xml = r#"<folder name="%NAME%">
            <file name="test.txt" />
        </folder>"#;

        let extending_xml = r#"<template extends="base">
            <file name="extra.txt" />
        </template>"#;

        let mut base_validation = HashMap::new();
        base_validation.insert("NAME".to_string(), ValidationRule {
            min_length: Some(3),
            max_length: Some(10),
            required: true,
            ..Default::default()
        });

        let loader = |name: &str| -> Option<TemplateData> {
            if name == "base" {
                Some(TemplateData {
                    schema_xml: base_xml.to_string(),
                    variables: HashMap::new(),
                    variable_validation: base_validation.clone(),
                })
            } else {
                None
            }
        };

        let result = resolve_template_inheritance(extending_xml, &loader).unwrap();

        // Base validation should be present (child template doesn't provide its own)
        let name_validation = result.merged_variable_validation.get("NAME").unwrap();
        assert_eq!(name_validation.min_length, Some(3));
        assert_eq!(name_validation.max_length, Some(10));
        assert!(name_validation.required);
    }

    #[test]
    fn test_inheritance_max_depth_exceeded() {
        // Create a chain of templates that exceeds MAX_INHERITANCE_DEPTH (10)
        let loader = |name: &str| -> Option<TemplateData> {
            // Each template extends the next one: level0 -> level1 -> level2 -> ... -> level11
            let level: usize = name.strip_prefix("level").unwrap_or("0").parse().unwrap_or(0);
            if level >= 12 {
                // Base case - no more extends
                Some(TemplateData {
                    schema_xml: r#"<folder name="base"><file name="test.txt" /></folder>"#.to_string(),
                    variables: HashMap::new(),
                    variable_validation: HashMap::new(),
                })
            } else {
                // Extend the next level
                Some(TemplateData {
                    schema_xml: format!(r#"<template extends="level{}"><file name="level{}.txt" /></template>"#, level + 1, level),
                    variables: HashMap::new(),
                    variable_validation: HashMap::new(),
                })
            }
        };

        // Start at level 0, which will try to resolve 12 levels deep (exceeding max of 10)
        let xml = r#"<template extends="level0"><file name="start.txt" /></template>"#;
        let result = resolve_template_inheritance(xml, &loader);

        assert!(result.is_err());
        let error = result.unwrap_err();
        assert!(error.to_string().contains("Maximum inheritance depth"));
    }

    #[test]
    fn test_resolve_inheritance_diamond() {
        // Diamond inheritance: C extends both A and B, and both A and B extend D
        // This tests that diamond inheritance works but D's content appears twice
        let template_d = r#"<folder name="root">
            <file name="from-d.txt" />
        </folder>"#;

        let template_a = r#"<template extends="template-d">
            <file name="from-a.txt" />
        </template>"#;

        let template_b = r#"<template extends="template-d">
            <file name="from-b.txt" />
        </template>"#;

        let template_c = r#"<template extends="template-a, template-b">
            <file name="from-c.txt" />
        </template>"#;

        let loader = |name: &str| -> Option<TemplateData> {
            match name {
                "template-d" => Some(TemplateData {
                    schema_xml: template_d.to_string(),
                    variables: HashMap::new(),
                    variable_validation: HashMap::new(),
                }),
                "template-a" => Some(TemplateData {
                    schema_xml: template_a.to_string(),
                    variables: HashMap::new(),
                    variable_validation: HashMap::new(),
                }),
                "template-b" => Some(TemplateData {
                    schema_xml: template_b.to_string(),
                    variables: HashMap::new(),
                    variable_validation: HashMap::new(),
                }),
                _ => None,
            }
        };

        let result = resolve_template_inheritance(template_c, &loader).unwrap();

        // Root should be from template-d (via template-a, which is first in the extends list)
        assert_eq!(result.tree.root.name, "root");

        // Children: from-d.txt (via A), from-a.txt, from-d.txt (via B), from-b.txt, from-c.txt
        // Note: D's content appears TWICE because both A and B extend D
        let children = result.tree.root.children.as_ref().unwrap();
        let names: Vec<&str> = children.iter().map(|c| c.name.as_str()).collect();

        // D's content appears twice - this is expected behavior for diamond inheritance
        assert_eq!(names.iter().filter(|&&n| n == "from-d.txt").count(), 2);
        assert!(names.contains(&"from-a.txt"));
        assert!(names.contains(&"from-b.txt"));
        assert!(names.contains(&"from-c.txt"));

        // Base templates should list all in resolution order
        assert!(result.base_templates.contains(&"template-a".to_string()));
        assert!(result.base_templates.contains(&"template-b".to_string()));
        assert!(result.base_templates.contains(&"template-d".to_string()));
    }

    #[test]
    fn test_resolve_inheritance_child_overrides_base_validation() {
        // Test that child template's validation rules override base template's rules
        let base_xml = r#"<folder name="%NAME%">
            <file name="test.txt" />
        </folder>"#;

        let extending_xml = r#"<template extends="base">
            <file name="extra.txt" />
        </template>"#;

        let mut base_validation = HashMap::new();
        base_validation.insert("NAME".to_string(), ValidationRule {
            min_length: Some(3),
            max_length: Some(10),
            required: true,
            ..Default::default()
        });

        let loader = |name: &str| -> Option<TemplateData> {
            if name == "base" {
                Some(TemplateData {
                    schema_xml: base_xml.to_string(),
                    variables: HashMap::new(),
                    variable_validation: base_validation.clone(),
                })
            } else {
                None
            }
        };

        // For this test, we need to simulate a child template with its own validation
        // Since the extending template XML doesn't carry validation (it comes from the template record),
        // we test the merging behavior by checking that later validation overrides earlier

        // First verify base-only case works
        let result = resolve_template_inheritance(extending_xml, &loader).unwrap();
        let name_validation = result.merged_variable_validation.get("NAME").unwrap();
        assert_eq!(name_validation.min_length, Some(3));
        assert_eq!(name_validation.max_length, Some(10));
        assert!(name_validation.required);

        // Now test with two bases where second overrides first
        let base1_xml = r#"<folder name="%NAME%">
            <file name="test.txt" />
        </folder>"#;

        let base2_xml = r#"<folder name="%NAME%">
            <file name="other.txt" />
        </folder>"#;

        let extending_both_xml = r#"<template extends="base1, base2">
            <file name="extra.txt" />
        </template>"#;

        let mut base1_validation = HashMap::new();
        base1_validation.insert("NAME".to_string(), ValidationRule {
            min_length: Some(3),
            max_length: Some(10),
            required: true,
            ..Default::default()
        });

        let mut base2_validation = HashMap::new();
        base2_validation.insert("NAME".to_string(), ValidationRule {
            min_length: Some(5),  // Override min_length
            required: false,      // Override required
            ..Default::default()  // max_length not set
        });

        let loader2 = |name: &str| -> Option<TemplateData> {
            match name {
                "base1" => Some(TemplateData {
                    schema_xml: base1_xml.to_string(),
                    variables: HashMap::new(),
                    variable_validation: base1_validation.clone(),
                }),
                "base2" => Some(TemplateData {
                    schema_xml: base2_xml.to_string(),
                    variables: HashMap::new(),
                    variable_validation: base2_validation.clone(),
                }),
                _ => None,
            }
        };

        let result2 = resolve_template_inheritance(extending_both_xml, &loader2).unwrap();
        let name_validation2 = result2.merged_variable_validation.get("NAME").unwrap();

        // base2's validation should override base1's (later overrides earlier)
        assert_eq!(name_validation2.min_length, Some(5));  // From base2
        assert!(!name_validation2.required);               // From base2
        // Note: max_length from base1 is lost because base2's entire ValidationRule replaces it
        assert_eq!(name_validation2.max_length, None);
    }
}
