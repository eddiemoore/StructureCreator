use quick_xml::events::{BytesStart, Event};
use quick_xml::Reader;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchemaNode {
    #[serde(rename = "type")]
    pub node_type: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<SchemaNode>>,
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
        _ => return Ok(None),
    };

    let mut name = String::new();
    let mut url: Option<String> = None;

    for attr in e.attributes() {
        let attr = attr?;
        let key = std::str::from_utf8(attr.key.as_ref())?;
        let value = std::str::from_utf8(&attr.value)?;

        match key {
            "name" => name = value.to_string(),
            "url" => url = Some(value.to_string()),
            _ => {}
        }
    }

    if name.is_empty() {
        return Ok(None);
    }

    Ok(Some(SchemaNode {
        node_type: node_type.to_string(),
        name,
        url,
        content: None,
        children: None,
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
                node_type: "file".to_string(),
                name: entry_name,
                url: None,
                content,
                children: None,
            });
        }
    }

    Ok(SchemaNode {
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
