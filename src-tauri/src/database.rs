use rusqlite::{Connection, Result as SqliteResult, Row};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

/// Validation rule for a variable
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ValidationRule {
    pub pattern: Option<String>,
    pub min_length: Option<usize>,
    pub max_length: Option<usize>,
    #[serde(default)]
    pub required: bool,
}

/// Maximum length for a single tag (in characters, not bytes).
/// NOTE: This constant is duplicated in src/components/TagInput.tsx for client-side validation.
/// If you change this value, update the TypeScript constant to match.
const MAX_TAG_LENGTH: usize = 50;
/// Maximum number of tags per template.
/// NOTE: This constant is duplicated in src/components/TagInput.tsx for client-side validation.
/// If you change this value, update the TypeScript constant to match.
const MAX_TAGS_COUNT: usize = 20;

/// Sanitize and normalize tags:
/// - Convert to lowercase
/// - Trim whitespace
/// - Strip non-printable/control characters
/// - Enforce length limit per tag
/// - Enforce total count limit
/// - Remove duplicates
/// - Remove empty tags
fn sanitize_tags(tags: Vec<String>) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    tags.into_iter()
        .map(|tag| {
            // Trim and lowercase
            let normalized = tag.trim().to_lowercase();
            // Strip non-printable characters (keep only printable ASCII and common unicode)
            normalized
                .chars()
                .filter(|c| !c.is_control() && *c != '\u{0}')
                .collect::<String>()
        })
        // Remove empty tags
        .filter(|tag| !tag.is_empty())
        // Enforce per-tag length limit (using char count for multi-byte UTF-8 safety)
        .map(|tag| {
            if tag.chars().count() > MAX_TAG_LENGTH {
                tag.chars().take(MAX_TAG_LENGTH).collect()
            } else {
                tag
            }
        })
        // Remove duplicates while preserving order
        .filter(|tag| seen.insert(tag.clone()))
        // Enforce total count limit
        .take(MAX_TAGS_COUNT)
        .collect()
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

        // Migration: Add tags column if it doesn't exist (for existing databases)
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

        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let variables_json = serde_json::to_string(&input.variables).unwrap_or_else(|_| "{}".to_string());
        let validation_json = serde_json::to_string(&input.variable_validation).unwrap_or_else(|_| "{}".to_string());
        // Sanitize tags before storing
        let sanitized_tags = sanitize_tags(input.tags);
        let tags_json = serde_json::to_string(&sanitized_tags).unwrap_or_else(|_| "[]".to_string());
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
            tags: sanitized_tags,
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

    /// Update tags for a template
    pub fn update_template_tags(&self, id: &str, tags: Vec<String>) -> SqliteResult<Option<Template>> {
        let conn = self.conn.lock().unwrap();
        // Sanitize tags before storing
        let sanitized_tags = sanitize_tags(tags);
        let tags_json = serde_json::to_string(&sanitized_tags).unwrap_or_else(|_| "[]".to_string());
        let now = chrono::Utc::now().to_rfc3339();

        conn.execute(
            "UPDATE templates SET tags = ?, updated_at = ? WHERE id = ?",
            [&tags_json, &now, id],
        )?;

        drop(conn);
        self.get_template(id)
    }

    /// Get all unique tags from all templates
    pub fn get_all_tags(&self) -> SqliteResult<Vec<String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT DISTINCT value FROM templates, json_each(templates.tags)
             WHERE tags IS NOT NULL AND tags != '[]' ORDER BY value"
        )?;
        let tags = stmt.query_map([], |row| row.get(0))?;
        tags.collect()
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

    fn create_test_template_with_tags(name: &str, tags: Vec<&str>) -> CreateTemplateInput {
        CreateTemplateInput {
            name: name.to_string(),
            description: Some("Test description".to_string()),
            schema_xml: "<folder name=\"test\"/>".to_string(),
            variables: HashMap::new(),
            variable_validation: HashMap::new(),
            icon_color: Some("#ff0000".to_string()),
            is_favorite: false,
            tags: tags.into_iter().map(String::from).collect(),
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

    mod template_tags_tests {
        use super::*;

        #[test]
        fn creates_template_with_tags() {
            let (db, _dir) = create_test_db();
            let template = db.create_template(create_test_template_with_tags(
                "Tagged Template",
                vec!["react", "typescript"],
            )).unwrap();

            assert_eq!(template.tags, vec!["react", "typescript"]);
        }

        #[test]
        fn creates_template_with_empty_tags() {
            let (db, _dir) = create_test_db();
            let template = db.create_template(create_test_template_input("No Tags")).unwrap();

            assert!(template.tags.is_empty());
        }

        #[test]
        fn retrieves_template_with_tags() {
            let (db, _dir) = create_test_db();
            let created = db.create_template(create_test_template_with_tags(
                "Tagged",
                vec!["python", "backend"],
            )).unwrap();

            let retrieved = db.get_template(&created.id).unwrap().unwrap();
            assert_eq!(retrieved.tags, vec!["python", "backend"]);
        }
    }

    mod update_template_tags_tests {
        use super::*;

        #[test]
        fn updates_tags_successfully() {
            let (db, _dir) = create_test_db();
            let template = db.create_template(create_test_template_input("Update Me")).unwrap();

            let updated = db.update_template_tags(&template.id, vec!["new".to_string(), "tags".to_string()]).unwrap().unwrap();

            assert_eq!(updated.tags, vec!["new", "tags"]);
        }

        #[test]
        fn clears_tags_with_empty_vector() {
            let (db, _dir) = create_test_db();
            let template = db.create_template(create_test_template_with_tags(
                "Has Tags",
                vec!["will", "be", "removed"],
            )).unwrap();

            let updated = db.update_template_tags(&template.id, vec![]).unwrap().unwrap();

            assert!(updated.tags.is_empty());
        }

        #[test]
        fn returns_none_for_nonexistent_template() {
            let (db, _dir) = create_test_db();
            let result = db.update_template_tags("nonexistent-id", vec!["tag".to_string()]).unwrap();

            assert!(result.is_none());
        }

        #[test]
        fn updates_updated_at_timestamp() {
            let (db, _dir) = create_test_db();
            let template = db.create_template(create_test_template_input("Timestamp Test")).unwrap();
            let original_updated_at = template.updated_at.clone();

            // Delay to ensure timestamp differs (longer for CI reliability)
            std::thread::sleep(std::time::Duration::from_millis(50));

            let updated = db.update_template_tags(&template.id, vec!["new".to_string()]).unwrap().unwrap();

            assert_ne!(updated.updated_at, original_updated_at);
        }
    }

    mod get_all_tags_tests {
        use super::*;

        #[test]
        fn returns_empty_when_no_templates() {
            let (db, _dir) = create_test_db();
            let tags = db.get_all_tags().unwrap();

            assert!(tags.is_empty());
        }

        #[test]
        fn returns_empty_when_templates_have_no_tags() {
            let (db, _dir) = create_test_db();
            db.create_template(create_test_template_input("No Tags 1")).unwrap();
            db.create_template(create_test_template_input("No Tags 2")).unwrap();

            let tags = db.get_all_tags().unwrap();

            assert!(tags.is_empty());
        }

        #[test]
        fn returns_unique_tags_from_all_templates() {
            let (db, _dir) = create_test_db();
            db.create_template(create_test_template_with_tags("T1", vec!["react", "frontend"])).unwrap();
            db.create_template(create_test_template_with_tags("T2", vec!["react", "backend"])).unwrap();
            db.create_template(create_test_template_with_tags("T3", vec!["python"])).unwrap();

            let tags = db.get_all_tags().unwrap();

            assert_eq!(tags.len(), 4);
            assert!(tags.contains(&"react".to_string()));
            assert!(tags.contains(&"frontend".to_string()));
            assert!(tags.contains(&"backend".to_string()));
            assert!(tags.contains(&"python".to_string()));
        }

        #[test]
        fn returns_tags_sorted_alphabetically() {
            let (db, _dir) = create_test_db();
            db.create_template(create_test_template_with_tags("T1", vec!["zebra", "apple", "mango"])).unwrap();

            let tags = db.get_all_tags().unwrap();

            assert_eq!(tags, vec!["apple", "mango", "zebra"]);
        }

        #[test]
        fn excludes_templates_with_empty_tags() {
            let (db, _dir) = create_test_db();
            db.create_template(create_test_template_input("No Tags")).unwrap();
            db.create_template(create_test_template_with_tags("Has Tags", vec!["only-this"])).unwrap();

            let tags = db.get_all_tags().unwrap();

            assert_eq!(tags, vec!["only-this"]);
        }
    }

    mod sanitize_tags_tests {
        use super::*;

        #[test]
        fn normalizes_to_lowercase() {
            let result = sanitize_tags(vec!["React".to_string(), "TypeScript".to_string()]);
            assert_eq!(result, vec!["react", "typescript"]);
        }

        #[test]
        fn trims_whitespace() {
            let result = sanitize_tags(vec!["  react  ".to_string(), " frontend ".to_string()]);
            assert_eq!(result, vec!["react", "frontend"]);
        }

        #[test]
        fn removes_empty_tags() {
            let result = sanitize_tags(vec!["react".to_string(), "".to_string(), "   ".to_string()]);
            assert_eq!(result, vec!["react"]);
        }

        #[test]
        fn removes_duplicates() {
            let result = sanitize_tags(vec!["react".to_string(), "React".to_string(), "REACT".to_string()]);
            assert_eq!(result, vec!["react"]);
        }

        #[test]
        fn enforces_max_tag_length() {
            let long_tag = "a".repeat(100);
            let result = sanitize_tags(vec![long_tag]);
            assert_eq!(result[0].chars().count(), MAX_TAG_LENGTH);
        }

        #[test]
        fn truncates_multibyte_characters_correctly() {
            // Each emoji is 1 character but 4 bytes
            // 60 emojis = 60 chars but 240 bytes
            let emoji_tag = "🎉".repeat(60);
            assert_eq!(emoji_tag.chars().count(), 60);
            assert!(emoji_tag.len() > MAX_TAG_LENGTH); // bytes > 50

            let result = sanitize_tags(vec![emoji_tag]);

            // Should truncate to 50 characters, not 50 bytes
            assert_eq!(result[0].chars().count(), MAX_TAG_LENGTH);
            // Result should be valid UTF-8 (50 emojis)
            assert_eq!(result[0], "🎉".repeat(50));
        }

        #[test]
        fn handles_mixed_ascii_and_multibyte() {
            // Mix of ASCII and multi-byte: "hello" (5) + 50 emojis (50) = 55 chars
            let mixed_tag = format!("hello{}", "🎉".repeat(50));
            assert_eq!(mixed_tag.chars().count(), 55);

            let result = sanitize_tags(vec![mixed_tag]);

            // Should truncate to 50 characters
            assert_eq!(result[0].chars().count(), MAX_TAG_LENGTH);
            // Should be "hello" + 45 emojis
            assert_eq!(result[0], format!("hello{}", "🎉".repeat(45)));
        }

        #[test]
        fn enforces_max_tags_count() {
            let tags: Vec<String> = (0..30).map(|i| format!("tag{}", i)).collect();
            let result = sanitize_tags(tags);
            assert_eq!(result.len(), MAX_TAGS_COUNT);
        }

        #[test]
        fn strips_control_characters() {
            let result = sanitize_tags(vec!["react\x00".to_string(), "front\x0Aend".to_string()]);
            assert_eq!(result, vec!["react", "frontend"]);
        }

        #[test]
        fn preserves_unicode() {
            let result = sanitize_tags(vec!["日本語".to_string(), "emoji🎉".to_string()]);
            assert_eq!(result, vec!["日本語", "emoji🎉"]);
        }

        #[test]
        fn handles_mixed_case_duplicates_after_normalization() {
            let result = sanitize_tags(vec![
                "Backend".to_string(),
                "frontend".to_string(),
                "BACKEND".to_string(),
                "FrontEnd".to_string(),
            ]);
            assert_eq!(result, vec!["backend", "frontend"]);
        }
    }

    mod tag_sanitization_integration_tests {
        use super::*;

        #[test]
        fn create_template_sanitizes_tags() {
            let (db, _dir) = create_test_db();
            let template = db.create_template(CreateTemplateInput {
                name: "Test".to_string(),
                description: None,
                schema_xml: "<folder name=\"test\"/>".to_string(),
                variables: HashMap::new(),
                variable_validation: HashMap::new(),
                icon_color: None,
                is_favorite: false,
                tags: vec!["  React  ".to_string(), "TYPESCRIPT".to_string(), "react".to_string()],
            }).unwrap();

            // Should be normalized: lowercase, trimmed, deduplicated
            assert_eq!(template.tags, vec!["react", "typescript"]);
        }

        #[test]
        fn update_template_tags_sanitizes_input() {
            let (db, _dir) = create_test_db();
            let template = db.create_template(create_test_template_input("Test")).unwrap();

            let updated = db.update_template_tags(
                &template.id,
                vec!["  NEW  ".to_string(), "Tags".to_string(), "new".to_string()]
            ).unwrap().unwrap();

            assert_eq!(updated.tags, vec!["new", "tags"]);
        }
    }
}
