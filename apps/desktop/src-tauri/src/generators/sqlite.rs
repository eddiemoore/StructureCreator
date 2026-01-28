//! SQLite database generator for creating databases from raw SQL.
//!
//! Uses raw SQL statements in CDATA blocks for full control over schema definition.

use crate::schema::SchemaNode;
use crate::transforms::substitute_variables;
use regex::Regex;
use rusqlite::Connection;
use std::collections::HashMap;
use std::path::Path;
use std::sync::OnceLock;

// Pre-compiled regexes for declarative table parsing
static RE_TABLE_NAME: OnceLock<Regex> = OnceLock::new();
static RE_COLUMN: OnceLock<Regex> = OnceLock::new();
static RE_COL_NAME: OnceLock<Regex> = OnceLock::new();
static RE_COL_TYPE: OnceLock<Regex> = OnceLock::new();
static RE_COL_PK: OnceLock<Regex> = OnceLock::new();
static RE_COL_UNIQUE: OnceLock<Regex> = OnceLock::new();
static RE_COL_NOTNULL: OnceLock<Regex> = OnceLock::new();
static RE_COL_DEFAULT: OnceLock<Regex> = OnceLock::new();

fn get_table_regexes() -> (&'static Regex, &'static Regex) {
    let name_re = RE_TABLE_NAME.get_or_init(|| {
        Regex::new(r#"name\s*=\s*["']([^"']+)["']"#).unwrap()
    });
    let column_re = RE_COLUMN.get_or_init(|| {
        Regex::new(r#"<column\s+([^>]+)/?\s*>"#).unwrap()
    });
    (name_re, column_re)
}

fn get_column_regexes() -> (&'static Regex, &'static Regex, &'static Regex, &'static Regex, &'static Regex, &'static Regex) {
    let name_re = RE_COL_NAME.get_or_init(|| {
        Regex::new(r#"name\s*=\s*["']([^"']+)["']"#).unwrap()
    });
    let type_re = RE_COL_TYPE.get_or_init(|| {
        Regex::new(r#"type\s*=\s*["']([^"']+)["']"#).unwrap()
    });
    let pk_re = RE_COL_PK.get_or_init(|| {
        Regex::new(r#"primary-key\s*=\s*["']true["']"#).unwrap()
    });
    let unique_re = RE_COL_UNIQUE.get_or_init(|| {
        Regex::new(r#"unique\s*=\s*["']true["']"#).unwrap()
    });
    let notnull_re = RE_COL_NOTNULL.get_or_init(|| {
        Regex::new(r#"not-null\s*=\s*["']true["']"#).unwrap()
    });
    let default_re = RE_COL_DEFAULT.get_or_init(|| {
        Regex::new(r#"default\s*=\s*["']([^"']+)["']"#).unwrap()
    });
    (name_re, type_re, pk_re, unique_re, notnull_re, default_re)
}

/// Generate a SQLite database file from raw SQL statements.
///
/// SQL can be provided in the file content as CDATA, giving full control over
/// table definitions, indexes, foreign keys, triggers, and initial data.
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
    let (name_re, column_re) = get_table_regexes();

    // Extract table name
    let table_name = name_re.captures(table_xml)?.get(1)?.as_str();

    // Extract columns
    let mut columns = Vec::new();
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
    let (name_re, type_re, pk_re, unique_re, notnull_re, default_re) = get_column_regexes();

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
            node_type: "file".to_string(),
            name: "test.db".to_string(),
            content: Some("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);".to_string()),
            generate: Some("sqlite".to_string()),
            ..Default::default()
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
            node_type: "file".to_string(),
            name: "test2.db".to_string(),
            generate: Some("sqlite".to_string()),
            generate_config: Some(r#"<sql>CREATE TABLE config (key TEXT PRIMARY KEY, value TEXT);</sql>"#.to_string()),
            ..Default::default()
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
            node_type: "file".to_string(),
            name: "declarative.db".to_string(),
            generate: Some("sqlite".to_string()),
            generate_config: Some(config.to_string()),
            ..Default::default()
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
            node_type: "file".to_string(),
            name: "vars.db".to_string(),
            content: Some("INSERT INTO config VALUES ('version', '%VERSION%');".to_string()),
            generate: Some("sqlite".to_string()),
            generate_config: Some("<sql>CREATE TABLE config (key TEXT PRIMARY KEY, value TEXT);</sql>".to_string()),
            ..Default::default()
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
            node_type: "file".to_string(),
            name: "dry_run.db".to_string(),
            content: Some("CREATE TABLE test (id INTEGER);".to_string()),
            generate: Some("sqlite".to_string()),
            ..Default::default()
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
