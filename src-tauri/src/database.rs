use regex::Regex;
use rusqlite::{Connection, Result as SqliteResult, Row};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::LazyLock;

/// Maximum length for a single tag
const MAX_TAG_LENGTH: usize = 50;

/// Maximum number of tags per template
const MAX_TAGS_PER_TEMPLATE: usize = 20;

/// Regex pattern for valid tags: starts with alphanumeric, contains only lowercase alphanumeric, hyphens, underscores
static TAG_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^[a-z0-9][a-z0-9\-_]*$").unwrap()
});

/// Validate and sanitize a list of tags.
/// Returns sanitized tags (lowercase, trimmed, deduplicated).
/// Invalid tags are skipped with a warning rather than causing an error.
fn validate_tags(tags: &[String]) -> Vec<String> {
    let mut validated: Vec<String> = Vec::with_capacity(tags.len().min(MAX_TAGS_PER_TEMPLATE));
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();

    for tag in tags {
        // Stop if we've reached the maximum
        if validated.len() >= MAX_TAGS_PER_TEMPLATE {
            eprintln!("Warning: Too many tags (max {}), ignoring remaining", MAX_TAGS_PER_TEMPLATE);
            break;
        }

        let normalized = tag.trim().to_lowercase();

        if normalized.is_empty() {
            continue; // Skip empty tags silently
        }

        if normalized.chars().count() > MAX_TAG_LENGTH {
            // Use chars().take() for safe UTF-8 truncation in preview
            let preview: String = normalized.chars().take(20).collect();
            eprintln!("Warning: Tag '{}...' exceeds maximum length, skipping", preview);
            continue;
        }

        if !TAG_REGEX.is_match(&normalized) {
            eprintln!("Warning: Tag '{}' is invalid, skipping", normalized);
            continue;
        }

        // Deduplicate
        if seen.insert(normalized.clone()) {
            validated.push(normalized);
        }
    }

    validated
}

/// Validation rule for a variable
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ValidationRule {
    pub pattern: Option<String>,
    pub min_length: Option<usize>,
    pub max_length: Option<usize>,
    #[serde(default)]
    pub required: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Template {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub schema_xml: String,
    pub variables: HashMap<String, String>,
    #[serde(default)]
    pub variable_validation: HashMap<String, ValidationRule>,
    pub icon_color: Option<String>,
    pub is_favorite: bool,
    pub use_count: i32,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default)]
    pub tags: Vec<String>,
}

/// Helper function to construct a Template from a database row.
/// Expects columns in order: id, name, description, schema_xml, variables, variable_validation, icon_color, is_favorite, use_count, created_at, updated_at, tags
fn row_to_template(row: &Row) -> rusqlite::Result<Template> {
    let variables_json: String = row.get(4)?;
    let variables: HashMap<String, String> = serde_json::from_str(&variables_json)
        .map_err(|e| rusqlite::Error::FromSqlConversionFailure(
            4,
            rusqlite::types::Type::Text,
            Box::new(e),
        ))?;

    // variable_validation may be NULL for older templates
    let validation_json: Option<String> = row.get(5)?;
    let variable_validation: HashMap<String, ValidationRule> = validation_json
        .map(|json| {
            serde_json::from_str(&json).unwrap_or_else(|e| {
                // Log parse error but fall back to empty validation for resilience
                eprintln!("Warning: Failed to parse variable_validation JSON, using empty: {}", e);
                HashMap::new()
            })
        })
        .unwrap_or_default();

    // tags may be NULL for older templates
    let tags_json: Option<String> = row.get(11)?;
    let tags: Vec<String> = tags_json
        .map(|json| {
            serde_json::from_str(&json).unwrap_or_else(|e| {
                eprintln!("Warning: Failed to parse tags JSON, using empty: {}", e);
                Vec::new()
            })
        })
        .unwrap_or_default();

    Ok(Template {
        id: row.get(0)?,
        name: row.get(1)?,
        description: row.get(2)?,
        schema_xml: row.get(3)?,
        variables,
        variable_validation,
        icon_color: row.get(6)?,
        is_favorite: row.get::<_, i32>(7)? != 0,
        use_count: row.get(8)?,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
        tags,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateTemplateInput {
    pub name: String,
    pub description: Option<String>,
    pub schema_xml: String,
    pub variables: HashMap<String, String>,
    #[serde(default)]
    pub variable_validation: HashMap<String, ValidationRule>,
    pub icon_color: Option<String>,
    #[serde(default)]
    pub is_favorite: bool,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateTemplateInput {
    pub name: Option<String>,
    pub description: Option<String>,
    pub icon_color: Option<String>,
}

pub struct Database {
    conn: Mutex<Connection>,
}

impl Database {
    pub fn new(app_data_dir: PathBuf) -> SqliteResult<Self> {
        // Ensure the directory exists
        std::fs::create_dir_all(&app_data_dir).ok();

        let db_path = app_data_dir.join("structure-creator.db");
        let conn = Connection::open(db_path)?;

        let db = Database {
            conn: Mutex::new(conn),
        };

        db.init_tables()?;
        Ok(db)
    }

    fn init_tables(&self) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();

        conn.execute(
            "CREATE TABLE IF NOT EXISTS templates (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT,
                schema_xml TEXT NOT NULL,
                variables TEXT DEFAULT '{}',
                icon_color TEXT,
                is_favorite INTEGER DEFAULT 0,
                use_count INTEGER DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )",
            [],
        )?;

        // Migration: Add variables column if it doesn't exist (for existing databases)
        // Ignore "duplicate column" errors but log other unexpected errors
        if let Err(e) = conn.execute(
            "ALTER TABLE templates ADD COLUMN variables TEXT DEFAULT '{}'",
            [],
        ) {
            let err_msg = e.to_string();
            if !err_msg.contains("duplicate column") {
                eprintln!("Warning: Migration failed (variables column): {}", err_msg);
            }
        }

        // Migration: Add unique index on name (case-insensitive) for existing databases
        // This prevents race conditions when generating unique names
        if let Err(e) = conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_templates_name_lower ON templates (LOWER(name))",
            [],
        ) {
            eprintln!("Warning: Migration failed (name index): {}", e);
        }

        // Migration: Add variable_validation column if it doesn't exist (for existing databases)
        if let Err(e) = conn.execute(
            "ALTER TABLE templates ADD COLUMN variable_validation TEXT DEFAULT '{}'",
            [],
        ) {
            let err_msg = e.to_string();
            if !err_msg.contains("duplicate column") {
                eprintln!("Warning: Migration failed (variable_validation column): {}", err_msg);
            }
        }

        // Migration: Add tags column (JSON array)
        if let Err(e) = conn.execute(
            "ALTER TABLE templates ADD COLUMN tags TEXT DEFAULT '[]'",
            [],
        ) {
            let err_msg = e.to_string();
            if !err_msg.contains("duplicate column") {
                eprintln!("Warning: Migration failed (tags column): {}", err_msg);
            }
        }

        conn.execute(
            "CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )",
            [],
        )?;

        Ok(())
    }

    pub fn list_templates(&self) -> SqliteResult<Vec<Template>> {
        let conn = self.conn.lock().unwrap();

        let mut stmt = conn.prepare(
            "SELECT id, name, description, schema_xml, variables, variable_validation, icon_color, is_favorite, use_count, created_at, updated_at, tags
             FROM templates
             ORDER BY is_favorite DESC, use_count DESC, updated_at DESC",
        )?;

        let templates = stmt.query_map([], row_to_template)?;
        templates.collect()
    }

    pub fn get_template(&self, id: &str) -> SqliteResult<Option<Template>> {
        let conn = self.conn.lock().unwrap();

        let mut stmt = conn.prepare(
            "SELECT id, name, description, schema_xml, variables, variable_validation, icon_color, is_favorite, use_count, created_at, updated_at, tags
             FROM templates
             WHERE id = ?",
        )?;

        let mut rows = stmt.query([id])?;
        match rows.next()? {
            Some(row) => Ok(Some(row_to_template(row)?)),
            None => Ok(None),
        }
    }

    /// Find a template by name (case-insensitive match).
    pub fn get_template_by_name(&self, name: &str) -> SqliteResult<Option<Template>> {
        let conn = self.conn.lock().unwrap();

        let mut stmt = conn.prepare(
            "SELECT id, name, description, schema_xml, variables, variable_validation, icon_color, is_favorite, use_count, created_at, updated_at, tags
             FROM templates
             WHERE LOWER(name) = LOWER(?)",
        )?;

        let mut rows = stmt.query([name])?;
        match rows.next()? {
            Some(row) => Ok(Some(row_to_template(row)?)),
            None => Ok(None),
        }
    }

    pub fn create_template(&self, input: CreateTemplateInput) -> SqliteResult<Template> {
        let conn = self.conn.lock().unwrap();

        // Validate and sanitize tags
        let validated_tags = validate_tags(&input.tags);

        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let variables_json = serde_json::to_string(&input.variables).unwrap_or_else(|_| "{}".to_string());
        let validation_json = serde_json::to_string(&input.variable_validation).unwrap_or_else(|_| "{}".to_string());
        let tags_json = serde_json::to_string(&validated_tags).unwrap_or_else(|_| "[]".to_string());
        let is_favorite_int = if input.is_favorite { 1 } else { 0 };

        conn.execute(
            "INSERT INTO templates (id, name, description, schema_xml, variables, variable_validation, icon_color, is_favorite, use_count, created_at, updated_at, tags)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)",
            rusqlite::params![
                &id,
                &input.name,
                &input.description.clone().unwrap_or_default(),
                &input.schema_xml,
                &variables_json,
                &validation_json,
                &input.icon_color.clone().unwrap_or_else(|| "#0a84ff".to_string()),
                is_favorite_int,
                &now,
                &now,
                &tags_json,
            ],
        )?;

        Ok(Template {
            id,
            name: input.name,
            description: input.description,
            schema_xml: input.schema_xml,
            variables: input.variables,
            variable_validation: input.variable_validation,
            icon_color: input.icon_color,
            is_favorite: input.is_favorite,
            use_count: 0,
            created_at: now.clone(),
            updated_at: now,
            tags: validated_tags,
        })
    }

    pub fn update_template(&self, id: &str, input: UpdateTemplateInput) -> SqliteResult<Option<Template>> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();

        // Build dynamic update query
        let mut updates = vec!["updated_at = ?"];
        let mut params: Vec<String> = vec![now.clone()];

        if let Some(name) = input.name {
            updates.push("name = ?");
            params.push(name);
        }
        if let Some(description) = input.description {
            updates.push("description = ?");
            params.push(description);
        }
        if let Some(icon_color) = input.icon_color {
            updates.push("icon_color = ?");
            params.push(icon_color);
        }

        params.push(id.to_string());

        let query = format!(
            "UPDATE templates SET {} WHERE id = ?",
            updates.join(", ")
        );

        let params_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|s| s as &dyn rusqlite::ToSql).collect();
        conn.execute(&query, params_refs.as_slice())?;

        drop(conn);
        self.get_template(id)
    }

    pub fn delete_template(&self, id: &str) -> SqliteResult<bool> {
        let conn = self.conn.lock().unwrap();

        let rows_affected = conn.execute(
            "DELETE FROM templates WHERE id = ?",
            [id],
        )?;

        Ok(rows_affected > 0)
    }

    pub fn toggle_favorite(&self, id: &str) -> SqliteResult<Option<Template>> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();

        conn.execute(
            "UPDATE templates SET is_favorite = NOT is_favorite, updated_at = ? WHERE id = ?",
            [&now, id],
        )?;

        drop(conn);
        self.get_template(id)
    }

    pub fn increment_use_count(&self, id: &str) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();

        conn.execute(
            "UPDATE templates SET use_count = use_count + 1, updated_at = ? WHERE id = ?",
            [&now, id],
        )?;

        Ok(())
    }

    // Settings methods
    pub fn get_all_settings(&self) -> SqliteResult<HashMap<String, String>> {
        let conn = self.conn.lock().unwrap();

        let mut stmt = conn.prepare("SELECT key, value FROM settings")?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;

        let mut settings = HashMap::new();
        for row in rows {
            let (key, value) = row?;
            settings.insert(key, value);
        }

        Ok(settings)
    }

    pub fn get_setting(&self, key: &str) -> SqliteResult<Option<String>> {
        let conn = self.conn.lock().unwrap();

        let mut stmt = conn.prepare("SELECT value FROM settings WHERE key = ?")?;
        let mut rows = stmt.query([key])?;

        if let Some(row) = rows.next()? {
            Ok(Some(row.get(0)?))
        } else {
            Ok(None)
        }
    }

    pub fn set_setting(&self, key: &str, value: &str) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();

        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?, ?)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [key, value],
        )?;

        Ok(())
    }

    pub fn delete_setting(&self, key: &str) -> SqliteResult<bool> {
        let conn = self.conn.lock().unwrap();

        let rows_affected = conn.execute("DELETE FROM settings WHERE key = ?", [key])?;

        Ok(rows_affected > 0)
    }

    /// Check if a template with the given name exists (case-insensitive)
    /// Uses COUNT query for efficiency instead of fetching the full row
    pub fn template_exists_by_name(&self, name: &str) -> SqliteResult<bool> {
        let conn = self.conn.lock().unwrap();
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM templates WHERE LOWER(name) = LOWER(?1)",
            rusqlite::params![name],
            |row| row.get(0),
        )?;
        Ok(count > 0)
    }

    /// Generate a unique name for a template by adding a suffix if needed.
    ///
    /// The database has a UNIQUE constraint on LOWER(name) which prevents duplicates.
    /// This function finds an available name; any remaining race conditions are
    /// caught by the constraint at insert time.
    pub fn generate_unique_template_name(&self, base_name: &str) -> Result<String, String> {
        if !self.template_exists_by_name(base_name).map_err(|e| e.to_string())? {
            return Ok(base_name.to_string());
        }

        for counter in 2..=100 {
            let new_name = format!("{} ({})", base_name, counter);
            if !self.template_exists_by_name(&new_name).map_err(|e| e.to_string())? {
                return Ok(new_name);
            }
        }

        Err("Could not generate unique template name after 100 attempts".to_string())
    }

    /// Delete a template by name (case-insensitive) and return the deleted template
    pub fn delete_template_by_name(&self, name: &str) -> SqliteResult<Option<Template>> {
        // First get the template to return it
        let template = self.get_template_by_name(name)?;
        if let Some(ref t) = template {
            self.delete_template(&t.id)?;
        }
        Ok(template)
    }

    /// Get all unique tags across all templates (for autocomplete)
    pub fn get_all_tags(&self) -> SqliteResult<Vec<String>> {
        let conn = self.conn.lock().unwrap();

        let mut stmt = conn.prepare("SELECT tags FROM templates WHERE tags IS NOT NULL AND tags != '[]'")?;
        let rows = stmt.query_map([], |row| {
            let tags_json: String = row.get(0)?;
            Ok(tags_json)
        })?;

        let mut all_tags: std::collections::HashSet<String> = std::collections::HashSet::new();
        for row_result in rows {
            if let Ok(tags_json) = row_result {
                if let Ok(tags) = serde_json::from_str::<Vec<String>>(&tags_json) {
                    for tag in tags {
                        all_tags.insert(tag);
                    }
                }
            }
        }

        let mut sorted_tags: Vec<String> = all_tags.into_iter().collect();
        sorted_tags.sort();
        Ok(sorted_tags)
    }

    /// Update tags for a template
    pub fn update_template_tags(&self, id: &str, tags: Vec<String>) -> SqliteResult<Option<Template>> {
        // Validate and sanitize tags
        let validated_tags = validate_tags(&tags);

        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        let tags_json = serde_json::to_string(&validated_tags).unwrap_or_else(|_| "[]".to_string());

        let rows_affected = conn.execute(
            "UPDATE templates SET tags = ?, updated_at = ? WHERE id = ?",
            rusqlite::params![&tags_json, &now, id],
        )?;

        if rows_affected == 0 {
            return Ok(None);
        }

        drop(conn);
        self.get_template(id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use tempfile::TempDir;

    fn create_test_db() -> (Database, TempDir) {
        let temp_dir = TempDir::new().unwrap();
        let db = Database::new(temp_dir.path().to_path_buf()).unwrap();
        (db, temp_dir)
    }

    fn create_test_template_input(name: &str) -> CreateTemplateInput {
        CreateTemplateInput {
            name: name.to_string(),
            description: Some("Test description".to_string()),
            schema_xml: "<folder name=\"test\"/>".to_string(),
            variables: HashMap::new(),
            variable_validation: HashMap::new(),
            icon_color: Some("#ff0000".to_string()),
            is_favorite: false,
            tags: Vec::new(),
        }
    }

    mod template_exists_by_name_tests {
        use super::*;

        #[test]
        fn returns_false_for_nonexistent_template() {
            let (db, _dir) = create_test_db();
            assert!(!db.template_exists_by_name("Nonexistent").unwrap());
        }

        #[test]
        fn returns_true_for_existing_template() {
            let (db, _dir) = create_test_db();
            db.create_template(create_test_template_input("My Template")).unwrap();
            assert!(db.template_exists_by_name("My Template").unwrap());
        }

        #[test]
        fn is_case_insensitive() {
            let (db, _dir) = create_test_db();
            db.create_template(create_test_template_input("My Template")).unwrap();
            assert!(db.template_exists_by_name("my template").unwrap());
            assert!(db.template_exists_by_name("MY TEMPLATE").unwrap());
            assert!(db.template_exists_by_name("My TEMPLATE").unwrap());
        }
    }

    mod generate_unique_template_name_tests {
        use super::*;

        #[test]
        fn returns_original_name_if_not_taken() {
            let (db, _dir) = create_test_db();
            let result = db.generate_unique_template_name("New Template").unwrap();
            assert_eq!(result, "New Template");
        }

        #[test]
        fn adds_suffix_if_name_taken() {
            let (db, _dir) = create_test_db();
            db.create_template(create_test_template_input("My Template")).unwrap();

            let result = db.generate_unique_template_name("My Template").unwrap();
            assert_eq!(result, "My Template (2)");
        }

        #[test]
        fn increments_suffix_for_multiple_duplicates() {
            let (db, _dir) = create_test_db();
            db.create_template(create_test_template_input("My Template")).unwrap();
            db.create_template(create_test_template_input("My Template (2)")).unwrap();
            db.create_template(create_test_template_input("My Template (3)")).unwrap();

            let result = db.generate_unique_template_name("My Template").unwrap();
            assert_eq!(result, "My Template (4)");
        }

        #[test]
        fn handles_gaps_in_suffixes() {
            let (db, _dir) = create_test_db();
            db.create_template(create_test_template_input("My Template")).unwrap();
            db.create_template(create_test_template_input("My Template (3)")).unwrap();
            // Note: (2) is not taken

            let result = db.generate_unique_template_name("My Template").unwrap();
            assert_eq!(result, "My Template (2)");
        }
    }

    mod delete_template_by_name_tests {
        use super::*;

        #[test]
        fn deletes_existing_template() {
            let (db, _dir) = create_test_db();
            db.create_template(create_test_template_input("To Delete")).unwrap();
            assert!(db.template_exists_by_name("To Delete").unwrap());

            let deleted = db.delete_template_by_name("To Delete").unwrap();
            assert!(deleted.is_some());
            assert_eq!(deleted.unwrap().name, "To Delete");
            assert!(!db.template_exists_by_name("To Delete").unwrap());
        }

        #[test]
        fn returns_none_for_nonexistent_template() {
            let (db, _dir) = create_test_db();
            let result = db.delete_template_by_name("Nonexistent").unwrap();
            assert!(result.is_none());
        }

        #[test]
        fn is_case_insensitive() {
            let (db, _dir) = create_test_db();
            db.create_template(create_test_template_input("My Template")).unwrap();

            let deleted = db.delete_template_by_name("my template").unwrap();
            assert!(deleted.is_some());
            assert!(!db.template_exists_by_name("My Template").unwrap());
        }
    }

    mod get_template_by_name_tests {
        use super::*;

        #[test]
        fn returns_template_when_found() {
            let (db, _dir) = create_test_db();
            db.create_template(create_test_template_input("Find Me")).unwrap();

            let result = db.get_template_by_name("Find Me").unwrap();
            assert!(result.is_some());
            assert_eq!(result.unwrap().name, "Find Me");
        }

        #[test]
        fn returns_none_when_not_found() {
            let (db, _dir) = create_test_db();
            let result = db.get_template_by_name("Not Found").unwrap();
            assert!(result.is_none());
        }

        #[test]
        fn is_case_insensitive() {
            let (db, _dir) = create_test_db();
            db.create_template(create_test_template_input("CamelCase")).unwrap();

            assert!(db.get_template_by_name("camelcase").unwrap().is_some());
            assert!(db.get_template_by_name("CAMELCASE").unwrap().is_some());
        }
    }

    mod validate_tags_tests {
        use super::*;

        #[test]
        fn returns_empty_for_empty_input() {
            let tags: Vec<String> = vec![];
            let result = validate_tags(&tags);
            assert!(result.is_empty());
        }

        #[test]
        fn accepts_valid_tags() {
            let tags = vec!["react".to_string(), "typescript".to_string(), "web-app".to_string()];
            let result = validate_tags(&tags);
            assert_eq!(result, vec!["react", "typescript", "web-app"]);
        }

        #[test]
        fn normalizes_to_lowercase() {
            let tags = vec!["React".to_string(), "TypeScript".to_string()];
            let result = validate_tags(&tags);
            assert_eq!(result, vec!["react", "typescript"]);
        }

        #[test]
        fn trims_whitespace() {
            let tags = vec!["  react  ".to_string(), "\ttypescript\n".to_string()];
            let result = validate_tags(&tags);
            assert_eq!(result, vec!["react", "typescript"]);
        }

        #[test]
        fn removes_empty_tags() {
            let tags = vec!["react".to_string(), "".to_string(), "  ".to_string(), "typescript".to_string()];
            let result = validate_tags(&tags);
            assert_eq!(result, vec!["react", "typescript"]);
        }

        #[test]
        fn deduplicates_tags() {
            let tags = vec!["react".to_string(), "React".to_string(), "REACT".to_string()];
            let result = validate_tags(&tags);
            assert_eq!(result, vec!["react"]);
        }

        #[test]
        fn truncates_too_many_tags() {
            let tags: Vec<String> = (0..25).map(|i| format!("tag{}", i)).collect();
            let result = validate_tags(&tags);
            // Should keep only the first MAX_TAGS_PER_TEMPLATE (20) tags
            assert_eq!(result.len(), MAX_TAGS_PER_TEMPLATE);
            assert_eq!(result[0], "tag0");
            assert_eq!(result[19], "tag19");
        }

        #[test]
        fn skips_tag_exceeding_max_length() {
            let long_tag = "a".repeat(51);
            let tags = vec!["valid".to_string(), long_tag, "also-valid".to_string()];
            let result = validate_tags(&tags);
            // Long tag is skipped, valid ones are kept
            assert_eq!(result, vec!["valid", "also-valid"]);
        }

        #[test]
        fn skips_invalid_characters() {
            let tags = vec!["valid".to_string(), "invalid@tag".to_string(), "also-valid".to_string()];
            let result = validate_tags(&tags);
            // Invalid tag is skipped, valid ones are kept
            assert_eq!(result, vec!["valid", "also-valid"]);
        }

        #[test]
        fn skips_tag_starting_with_hyphen() {
            let tags = vec!["valid".to_string(), "-invalid".to_string(), "also-valid".to_string()];
            let result = validate_tags(&tags);
            assert_eq!(result, vec!["valid", "also-valid"]);
        }

        #[test]
        fn accepts_tags_with_hyphens_and_underscores() {
            let tags = vec!["my-tag".to_string(), "my_tag".to_string(), "my-tag_2".to_string()];
            let result = validate_tags(&tags);
            assert_eq!(result, vec!["my-tag", "my_tag", "my-tag_2"]);
        }

        #[test]
        fn accepts_numeric_tags() {
            let tags = vec!["123".to_string(), "v2".to_string(), "2024".to_string()];
            let result = validate_tags(&tags);
            assert_eq!(result, vec!["123", "v2", "2024"]);
        }

        #[test]
        fn skips_unicode_safely() {
            // UTF-8 characters should be skipped by the regex, not panic
            let tags = vec!["valid".to_string(), "日本語".to_string(), "also-valid".to_string()];
            let result = validate_tags(&tags);
            assert_eq!(result, vec!["valid", "also-valid"]);
        }
    }
}
