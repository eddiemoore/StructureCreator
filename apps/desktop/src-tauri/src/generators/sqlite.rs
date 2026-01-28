//! SQLite database generator for creating databases with defined schemas.
//!
//! Supports both declarative table definitions and raw SQL execution.

use crate::schema::SchemaNode;
use crate::transforms::substitute_variables;
use rusqlite::Connection;
use std::collections::HashMap;
use std::path::Path;

/// Generate a SQLite database file.
///
/// Supports two modes:
/// 1. Raw SQL: Execute SQL statements from `<sql>` child elements or CDATA content
/// 2. Declarative: Create tables from `<table>` child elements (parsed from generate_config)
///
/// # Arguments
/// * `node` - The schema node with generate="sqlite" attribute
/// * `path` - The destination file path
/// * `variables` - Variable substitution map
/// * `dry_run` - If true, returns Ok without creating the database
///
/// # Returns
/// * `Ok(())` on success
/// * `Err(String)` on failure with error message
pub fn generate_sqlite(
    node: &SchemaNode,
    path: &Path,
    variables: &HashMap<String, String>,
    dry_run: bool,
) -> Result<(), String> {
    if dry_run {
        return Ok(());
    }

    // Remove existing file if present (SQLite won't overwrite)
    if path.exists() {
        std::fs::remove_file(path)
            .map_err(|e| format!("Failed to remove existing database: {}", e))?;
    }

    // Create new database
    let conn = Connection::open(path)
        .map_err(|e| format!("Failed to create database: {}", e))?;

    // Get SQL from content or generate_config
    let sql = get_sql_statements(node, variables)?;

    if !sql.is_empty() {
        // Execute all SQL statements
        conn.execute_batch(&sql)
            .map_err(|e| format!("SQL execution failed: {}", e))?;
    }

    Ok(())
}

/// Extract SQL statements from the node's generate_config and content.
/// Order: generate_config first (schema definitions), then content (additional SQL/data)
fn get_sql_statements(node: &SchemaNode, variables: &HashMap<String, String>) -> Result<String, String> {
    let mut sql = String::new();

    // Process generate_config first (schema definitions)
    if let Some(config) = &node.generate_config {
        let config = config.trim();

        // Check for <table> elements (declarative mode) - these define schema
        let tables = extract_table_elements(config);
        for table_sql in tables {
            sql.push_str(&table_sql);
            sql.push('\n');
        }

        // Check for <sql> element
        if let Some(sql_content) = extract_sql_element(config) {
            let processed = substitute_variables(&sql_content, variables);
            sql.push_str(&processed);
            sql.push('\n');
        }
    }

    // Then process content (additional SQL, data inserts, etc.)
    if let Some(content) = &node.content {
        let processed = substitute_variables(content.trim(), variables);
        if !processed.is_empty() {
            sql.push_str(&processed);
            sql.push('\n');
        }
    }

    Ok(sql)
}

/// Extract content from a <sql> element
fn extract_sql_element(xml: &str) -> Option<String> {
    // Simple extraction without full XML parsing
    // Look for <sql>...</sql> or <sql><![CDATA[...]]></sql>
    let start_tag = "<sql>";
    let end_tag = "</sql>";

    let start = xml.find(start_tag)?;
    let end = xml.find(end_tag)?;

    if start >= end {
        return None;
    }

    let content = &xml[start + start_tag.len()..end];

    // Handle CDATA
    let content = if content.trim().starts_with("<![CDATA[") {
        let cdata_start = content.find("<![CDATA[")? + 9;
        let cdata_end = content.find("]]>")?;
        &content[cdata_start..cdata_end]
    } else {
        content
    };

    Some(content.trim().to_string())
}

/// Extract and convert <table> elements to CREATE TABLE statements
fn extract_table_elements(xml: &str) -> Vec<String> {
    let mut statements = Vec::new();

    // Find all <table> elements
    let mut pos = 0;
    while let Some(table_start) = xml[pos..].find("<table") {
        let abs_start = pos + table_start;

        // Find closing tag (either /> or </table>)
        let self_closing = xml[abs_start..].find("/>");
        let end_tag = xml[abs_start..].find("</table>");

        let table_end = match (self_closing, end_tag) {
            (Some(sc), Some(et)) if sc < et => abs_start + sc + 2,
            (_, Some(et)) => abs_start + et + 8, // </table> = 8 chars
            (Some(sc), None) => abs_start + sc + 2,
            (None, None) => break,
        };

        let table_xml = &xml[abs_start..table_end];

        if let Some(sql) = parse_table_to_sql(table_xml) {
            statements.push(sql);
        }

        pos = table_end;
    }

    statements
}

/// Parse a <table> element into a CREATE TABLE SQL statement
fn parse_table_to_sql(table_xml: &str) -> Option<String> {
    // Extract table name
    let name_re = regex::Regex::new(r#"name\s*=\s*["']([^"']+)["']"#).ok()?;
    let table_name = name_re.captures(table_xml)?.get(1)?.as_str();

    // Extract columns
    let mut columns = Vec::new();
    let column_re = regex::Regex::new(r#"<column\s+([^>]+)/?\s*>"#).ok()?;

    for cap in column_re.captures_iter(table_xml) {
        if let Some(col_def) = parse_column_to_sql(&cap[1]) {
            columns.push(col_def);
        }
    }

    if columns.is_empty() {
        return None;
    }

    Some(format!(
        "CREATE TABLE {} (\n  {}\n);",
        table_name,
        columns.join(",\n  ")
    ))
}

/// Parse column attributes into a SQL column definition
fn parse_column_to_sql(attrs: &str) -> Option<String> {
    let name_re = regex::Regex::new(r#"name\s*=\s*["']([^"']+)["']"#).ok()?;
    let type_re = regex::Regex::new(r#"type\s*=\s*["']([^"']+)["']"#).ok()?;
    let pk_re = regex::Regex::new(r#"primary-key\s*=\s*["']true["']"#).ok()?;
    let unique_re = regex::Regex::new(r#"unique\s*=\s*["']true["']"#).ok()?;
    let notnull_re = regex::Regex::new(r#"not-null\s*=\s*["']true["']"#).ok()?;
    let default_re = regex::Regex::new(r#"default\s*=\s*["']([^"']+)["']"#).ok()?;

    let name = name_re.captures(attrs)?.get(1)?.as_str();
    let col_type = type_re.captures(attrs).map(|c| c.get(1).unwrap().as_str()).unwrap_or("TEXT");

    let mut def = format!("{} {}", name, col_type);

    if pk_re.is_match(attrs) {
        def.push_str(" PRIMARY KEY");
    }
    if unique_re.is_match(attrs) {
        def.push_str(" UNIQUE");
    }
    if notnull_re.is_match(attrs) {
        def.push_str(" NOT NULL");
    }
    if let Some(caps) = default_re.captures(attrs) {
        let default_val = caps.get(1).unwrap().as_str();
        def.push_str(&format!(" DEFAULT '{}'", default_val));
    }

    Some(def)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_generate_sqlite_raw_sql() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("test.db");

        let node = SchemaNode {
            id: None,
            node_type: "file".to_string(),
            name: "test.db".to_string(),
            url: None,
            content: Some("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);".to_string()),
            children: None,
            condition_var: None,
            repeat_count: None,
            repeat_as: None,
            generate: Some("sqlite".to_string()),
            generate_config: None,
        };

        let vars = HashMap::new();
        generate_sqlite(&node, &path, &vars, false).unwrap();

        assert!(path.exists());

        // Verify table was created
        let conn = Connection::open(&path).unwrap();
        let count: i32 = conn
            .query_row("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='users'", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn test_generate_sqlite_with_sql_element() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("test2.db");

        let node = SchemaNode {
            id: None,
            node_type: "file".to_string(),
            name: "test2.db".to_string(),
            url: None,
            content: None,
            children: None,
            condition_var: None,
            repeat_count: None,
            repeat_as: None,
            generate: Some("sqlite".to_string()),
            generate_config: Some(r#"<sql>CREATE TABLE config (key TEXT PRIMARY KEY, value TEXT);</sql>"#.to_string()),
        };

        let vars = HashMap::new();
        generate_sqlite(&node, &path, &vars, false).unwrap();

        assert!(path.exists());

        let conn = Connection::open(&path).unwrap();
        let count: i32 = conn
            .query_row("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='config'", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn test_generate_sqlite_declarative() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("declarative.db");

        let config = r#"
            <table name="users">
                <column name="id" type="INTEGER" primary-key="true" />
                <column name="email" type="TEXT" unique="true" not-null="true" />
                <column name="name" type="TEXT" />
            </table>
        "#;

        let node = SchemaNode {
            id: None,
            node_type: "file".to_string(),
            name: "declarative.db".to_string(),
            url: None,
            content: None,
            children: None,
            condition_var: None,
            repeat_count: None,
            repeat_as: None,
            generate: Some("sqlite".to_string()),
            generate_config: Some(config.to_string()),
        };

        let vars = HashMap::new();
        generate_sqlite(&node, &path, &vars, false).unwrap();

        assert!(path.exists());

        let conn = Connection::open(&path).unwrap();
        let count: i32 = conn
            .query_row("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='users'", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn test_generate_sqlite_with_variables() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("vars.db");

        let node = SchemaNode {
            id: None,
            node_type: "file".to_string(),
            name: "vars.db".to_string(),
            url: None,
            content: Some("INSERT INTO config VALUES ('version', '%VERSION%');".to_string()),
            children: None,
            condition_var: None,
            repeat_count: None,
            repeat_as: None,
            generate: Some("sqlite".to_string()),
            generate_config: Some("<sql>CREATE TABLE config (key TEXT PRIMARY KEY, value TEXT);</sql>".to_string()),
        };

        let mut vars = HashMap::new();
        vars.insert("%VERSION%".to_string(), "1.0.0".to_string());

        generate_sqlite(&node, &path, &vars, false).unwrap();

        let conn = Connection::open(&path).unwrap();
        let version: String = conn
            .query_row("SELECT value FROM config WHERE key='version'", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, "1.0.0");
    }

    #[test]
    fn test_generate_sqlite_dry_run() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("dry_run.db");

        let node = SchemaNode {
            id: None,
            node_type: "file".to_string(),
            name: "dry_run.db".to_string(),
            url: None,
            content: Some("CREATE TABLE test (id INTEGER);".to_string()),
            children: None,
            condition_var: None,
            repeat_count: None,
            repeat_as: None,
            generate: Some("sqlite".to_string()),
            generate_config: None,
        };

        let vars = HashMap::new();
        generate_sqlite(&node, &path, &vars, true).unwrap();

        // File should NOT be created in dry run mode
        assert!(!path.exists());
    }

    #[test]
    fn test_parse_table_to_sql() {
        let table_xml = r#"<table name="users">
            <column name="id" type="INTEGER" primary-key="true" />
            <column name="email" type="TEXT" unique="true" />
        </table>"#;

        let sql = parse_table_to_sql(table_xml).unwrap();
        assert!(sql.contains("CREATE TABLE users"));
        assert!(sql.contains("id INTEGER PRIMARY KEY"));
        assert!(sql.contains("email TEXT UNIQUE"));
    }

    #[test]
    fn test_extract_sql_element() {
        let xml1 = "<sql>SELECT * FROM users;</sql>";
        assert_eq!(extract_sql_element(xml1), Some("SELECT * FROM users;".to_string()));

        let xml2 = "<sql><![CDATA[SELECT * FROM users WHERE name = 'test';]]></sql>";
        assert_eq!(extract_sql_element(xml2), Some("SELECT * FROM users WHERE name = 'test';".to_string()));

        let xml3 = "<other>no sql here</other>";
        assert_eq!(extract_sql_element(xml3), None);
    }
}
