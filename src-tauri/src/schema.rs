use quick_xml::events::{BytesStart, Event};
use quick_xml::Reader;
use serde::{Deserialize, Serialize};
use std::io::Read;

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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchemaStats {
    pub folders: usize,
    pub files: usize,
    pub downloads: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchemaTree {
    pub root: SchemaNode,
    pub stats: SchemaStats,
}

pub fn parse_xml_schema(xml_content: &str) -> Result<SchemaTree, Box<dyn std::error::Error>> {
    let mut reader = Reader::from_str(xml_content);
    reader.config_mut().trim_text(true);

    let mut stack: Vec<SchemaNode> = Vec::new();
    let mut root: Option<SchemaNode> = None;

    loop {
        match reader.read_event() {
            Ok(Event::Start(ref e)) => {
                if let Some(node) = parse_element(e)? {
                    stack.push(node);
                }
            }
            Ok(Event::Empty(ref e)) => {
                if let Some(node) = parse_element(e)? {
                    // Self-closing tag - add to parent
                    if let Some(parent) = stack.last_mut() {
                        if parent.children.is_none() {
                            parent.children = Some(Vec::new());
                        }
                        parent.children.as_mut().unwrap().push(node);
                    } else {
                        root = Some(node);
                    }
                }
            }
            Ok(Event::End(_)) => {
                if let Some(node) = stack.pop() {
                    if let Some(parent) = stack.last_mut() {
                        if parent.children.is_none() {
                            parent.children = Some(Vec::new());
                        }
                        parent.children.as_mut().unwrap().push(node);
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

    Ok(SchemaTree { root, stats })
}

fn parse_element(e: &BytesStart) -> Result<Option<SchemaNode>, Box<dyn std::error::Error>> {
    let name_bytes = e.name();
    let tag_name = std::str::from_utf8(name_bytes.as_ref())?;

    let node_type = match tag_name {
        "folder" => "folder",
        "file" => "file",
        "if" => "if",
        "else" => "else",
        _ => return Ok(None),
    };

    let mut name = String::new();
    let mut url: Option<String> = None;
    let mut condition_var: Option<String> = None;

    for attr in e.attributes() {
        let attr = attr?;
        let key = std::str::from_utf8(attr.key.as_ref())?;
        let value = std::str::from_utf8(&attr.value)?;

        match key {
            "name" => name = value.to_string(),
            "url" => url = Some(value.to_string()),
            "var" => condition_var = Some(value.to_string()),
            _ => {}
        }
    }

    // For if/else nodes, name is not required and defaults to empty string
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
        // if/else are control structures, not counted
        "if" | "else" => {}
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

    Ok(SchemaTree { root, stats })
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
            if let Some(children) = &node.children {
                if let Some(var) = &node.condition_var {
                    xml.push_str(&format!("{}<if var=\"{}\">\n", indent_str, escape_xml(var)));
                    for child in children {
                        node_to_xml(child, xml, indent + 1);
                    }
                    xml.push_str(&format!("{}</if>\n", indent_str));
                }
            }
        }
        "else" => {
            if let Some(children) = &node.children {
                xml.push_str(&format!("{}<else>\n", indent_str));
                for child in children {
                    node_to_xml(child, xml, indent + 1);
                }
                xml.push_str(&format!("{}</else>\n", indent_str));
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

    Ok(SchemaTree { root, stats })
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
    }
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
}
