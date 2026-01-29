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

/// Maximum number of recent projects to keep
const MAX_RECENT_PROJECTS: usize = 20;

/// A recent project entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecentProject {
    pub id: String,
    pub project_name: String,
    pub output_path: String,
    pub schema_xml: String,
    pub variables: HashMap<String, String>,
    #[serde(default)]
    pub variable_validation: HashMap<String, ValidationRule>,
    pub template_id: Option<String>,
    pub template_name: Option<String>,
    pub folders_created: i32,
    pub files_created: i32,
    pub created_at: String,
}

/// Input for creating a recent project entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateRecentProjectInput {
    pub project_name: String,
    pub output_path: String,
    pub schema_xml: String,
    pub variables: HashMap<String, String>,
    #[serde(default)]
    pub variable_validation: HashMap<String, ValidationRule>,
    pub template_id: Option<String>,
    pub template_name: Option<String>,
    pub folders_created: i32,
    pub files_created: i32,
}

/// Helper to parse JSON variables with logging on failure
fn parse_variables_json(json: &str, context: &str) -> HashMap<String, String> {
    serde_json::from_str(json).unwrap_or_else(|e| {
        eprintln!("Warning: Failed to parse variables JSON for {}: {}", context, e);
        HashMap::new()
    })
}

/// Helper to parse JSON validation rules with logging on failure
fn parse_validation_json(json: Option<String>, context: &str) -> HashMap<String, ValidationRule> {
    json.map(|j| {
        serde_json::from_str(&j).unwrap_or_else(|e| {
            eprintln!("Warning: Failed to parse validation JSON for {}: {}", context, e);
            HashMap::new()
        })
    }).unwrap_or_default()
}

/// Helper to map a database row to RecentProject
fn row_to_recent_project(row: &rusqlite::Row) -> rusqlite::Result<RecentProject> {
    let id: String = row.get(0)?;
    let variables_json: String = row.get(4)?;
    let validation_json: Option<String> = row.get(5)?;

    Ok(RecentProject {
        id: id.clone(),
        project_name: row.get(1)?,
        output_path: row.get(2)?,
        schema_xml: row.get(3)?,
        variables: parse_variables_json(&variables_json, &id),
        variable_validation: parse_validation_json(validation_json, &id),
        template_id: row.get(6)?,
        template_name: row.get(7)?,
        folders_created: row.get(8)?,
        files_created: row.get(9)?,
        created_at: row.get(10)?,
    })
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
    /// Wizard configuration for guided template setup (JSON)
    pub wizard_config: Option<serde_json::Value>,
}

/// Helper function to construct a Template from a database row.
/// Expects columns in order: id, name, description, schema_xml, variables, variable_validation, icon_color, is_favorite, use_count, created_at, updated_at, tags, wizard_config
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

    // wizard_config may be NULL for templates without wizards
    let wizard_config_json: Option<String> = row.get(12)?;
    let wizard_config: Option<serde_json::Value> = wizard_config_json
        .and_then(|json| {
            serde_json::from_str(&json).unwrap_or_else(|e| {
                eprintln!("Warning: Failed to parse wizard_config JSON, using null: {}", e);
                None
            })
        });

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
        wizard_config,
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
    /// Optional wizard configuration (JSON)
    pub wizard_config: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateTemplateInput {
    pub name: Option<String>,
    pub description: Option<String>,
    pub icon_color: Option<String>,
    /// Optional wizard configuration update (JSON)
    pub wizard_config: Option<serde_json::Value>,
}

// ============================================================================
// Team Library Types
// ============================================================================

/// A configured team library (shared folder containing .sct template files)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeamLibrary {
    pub id: String,
    pub name: String,
    pub path: String,
    pub sync_interval: i32,
    pub last_sync_at: Option<String>,
    pub is_enabled: bool,
    pub created_at: String,
    pub updated_at: String,
}

/// Input for creating a team library
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateTeamLibraryInput {
    pub name: String,
    pub path: String,
    #[serde(default = "default_sync_interval")]
    pub sync_interval: i32,
}

fn default_sync_interval() -> i32 {
    300 // 5 minutes default
}

/// Input for updating a team library
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateTeamLibraryInput {
    pub name: Option<String>,
    pub path: Option<String>,
    pub sync_interval: Option<i32>,
    pub is_enabled: Option<bool>,
}

/// A sync log entry for audit trail
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncLogEntry {
    pub id: String,
    pub library_id: String,
    pub action: String, // "scan", "import", "error"
    pub template_name: Option<String>,
    pub details: Option<String>,
    pub created_at: String,
}

/// Helper to map a database row to TeamLibrary
fn row_to_team_library(row: &rusqlite::Row) -> rusqlite::Result<TeamLibrary> {
    Ok(TeamLibrary {
        id: row.get(0)?,
        name: row.get(1)?,
        path: row.get(2)?,
        sync_interval: row.get(3)?,
        last_sync_at: row.get(4)?,
        is_enabled: row.get::<_, i32>(5)? != 0,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
    })
}

/// Helper to map a database row to SyncLogEntry
fn row_to_sync_log_entry(row: &rusqlite::Row) -> rusqlite::Result<SyncLogEntry> {
    Ok(SyncLogEntry {
        id: row.get(0)?,
        library_id: row.get(1)?,
        action: row.get(2)?,
        template_name: row.get(3)?,
        details: row.get(4)?,
        created_at: row.get(5)?,
    })
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

        // Migration: Add wizard_config column (JSON object, nullable)
        if let Err(e) = conn.execute(
            "ALTER TABLE templates ADD COLUMN wizard_config TEXT DEFAULT NULL",
            [],
        ) {
            let err_msg = e.to_string();
            if !err_msg.contains("duplicate column") {
                eprintln!("Warning: Migration failed (wizard_config column): {}", err_msg);
            }
        }

        conn.execute(
            "CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )",
            [],
        )?;

        // Recent projects table
        conn.execute(
            "CREATE TABLE IF NOT EXISTS recent_projects (
                id TEXT PRIMARY KEY,
                project_name TEXT NOT NULL,
                output_path TEXT NOT NULL,
                schema_xml TEXT NOT NULL,
                variables TEXT DEFAULT '{}',
                variable_validation TEXT DEFAULT '{}',
                template_id TEXT,
                template_name TEXT,
                folders_created INTEGER DEFAULT 0,
                files_created INTEGER DEFAULT 0,
                created_at TEXT NOT NULL
            )",
            [],
        )?;

        // Team libraries table - stores configured shared template folders
        conn.execute(
            "CREATE TABLE IF NOT EXISTS team_libraries (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                path TEXT NOT NULL,
                sync_interval INTEGER DEFAULT 300,
                last_sync_at TEXT,
                is_enabled INTEGER DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )",
            [],
        )?;

        // Sync log table - audit trail for team library operations
        conn.execute(
            "CREATE TABLE IF NOT EXISTS sync_log (
                id TEXT PRIMARY KEY,
                library_id TEXT NOT NULL,
                action TEXT NOT NULL,
                template_name TEXT,
                details TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY (library_id) REFERENCES team_libraries(id) ON DELETE CASCADE
            )",
            [],
        )?;

        Ok(())
    }

    pub fn list_templates(&self) -> SqliteResult<Vec<Template>> {
        let conn = self.conn.lock().unwrap();

        let mut stmt = conn.prepare(
            "SELECT id, name, description, schema_xml, variables, variable_validation, icon_color, is_favorite, use_count, created_at, updated_at, tags, wizard_config
             FROM templates
             ORDER BY is_favorite DESC, use_count DESC, updated_at DESC",
        )?;

        let templates = stmt.query_map([], row_to_template)?;
        templates.collect()
    }

    pub fn get_template(&self, id: &str) -> SqliteResult<Option<Template>> {
        let conn = self.conn.lock().unwrap();

        let mut stmt = conn.prepare(
            "SELECT id, name, description, schema_xml, variables, variable_validation, icon_color, is_favorite, use_count, created_at, updated_at, tags, wizard_config
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
            "SELECT id, name, description, schema_xml, variables, variable_validation, icon_color, is_favorite, use_count, created_at, updated_at, tags, wizard_config
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
        let wizard_config_json: Option<String> = input.wizard_config.as_ref()
            .map(|v| serde_json::to_string(v).unwrap_or_else(|_| "null".to_string()));
        let is_favorite_int = if input.is_favorite { 1 } else { 0 };

        conn.execute(
            "INSERT INTO templates (id, name, description, schema_xml, variables, variable_validation, icon_color, is_favorite, use_count, created_at, updated_at, tags, wizard_config)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)",
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
                &wizard_config_json,
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
            wizard_config: input.wizard_config,
        })
    }

    pub fn update_template(&self, id: &str, input: UpdateTemplateInput) -> SqliteResult<Option<Template>> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();

        // Build dynamic update query
        let mut updates = vec!["updated_at = ?"];
        let mut string_params: Vec<String> = vec![now.clone()];
        let mut has_wizard_config = false;
        let mut wizard_config_json: Option<String> = None;

        if let Some(name) = input.name {
            updates.push("name = ?");
            string_params.push(name);
        }
        if let Some(description) = input.description {
            updates.push("description = ?");
            string_params.push(description);
        }
        if let Some(icon_color) = input.icon_color {
            updates.push("icon_color = ?");
            string_params.push(icon_color);
        }
        if let Some(ref wc) = input.wizard_config {
            updates.push("wizard_config = ?");
            wizard_config_json = Some(serde_json::to_string(wc).unwrap_or_else(|_| "null".to_string()));
            has_wizard_config = true;
        }

        string_params.push(id.to_string());

        let query = format!(
            "UPDATE templates SET {} WHERE id = ?",
            updates.join(", ")
        );

        // Build params list, inserting wizard_config in the right position
        let mut params_refs: Vec<&dyn rusqlite::ToSql> = string_params.iter().map(|s| s as &dyn rusqlite::ToSql).collect();

        // If we have wizard_config, insert it before the id param
        if has_wizard_config {
            if let Some(ref json) = wizard_config_json {
                // Insert wizard_config param at the right position (before id)
                params_refs.insert(params_refs.len() - 1, json as &dyn rusqlite::ToSql);
            }
        }

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

    // Recent Projects methods

    /// List all recent projects, sorted by created_at descending (newest first)
    pub fn list_recent_projects(&self) -> SqliteResult<Vec<RecentProject>> {
        let conn = self.conn.lock().unwrap();

        let mut stmt = conn.prepare(
            "SELECT id, project_name, output_path, schema_xml, variables, variable_validation,
                    template_id, template_name, folders_created, files_created, created_at
             FROM recent_projects
             ORDER BY created_at DESC",
        )?;

        let projects = stmt.query_map([], row_to_recent_project)?;
        projects.collect()
    }

    /// Get a specific recent project by ID
    pub fn get_recent_project(&self, id: &str) -> SqliteResult<Option<RecentProject>> {
        let conn = self.conn.lock().unwrap();

        let mut stmt = conn.prepare(
            "SELECT id, project_name, output_path, schema_xml, variables, variable_validation,
                    template_id, template_name, folders_created, files_created, created_at
             FROM recent_projects
             WHERE id = ?",
        )?;

        let mut rows = stmt.query([id])?;
        match rows.next()? {
            Some(row) => Ok(Some(row_to_recent_project(row)?)),
            None => Ok(None),
        }
    }

    /// Add a new recent project entry. Automatically cleans up oldest entries if over MAX_RECENT_PROJECTS.
    pub fn add_recent_project(&self, input: CreateRecentProjectInput) -> SqliteResult<RecentProject> {
        let conn = self.conn.lock().unwrap();

        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let variables_json = serde_json::to_string(&input.variables).unwrap_or_else(|_| "{}".to_string());
        let validation_json = serde_json::to_string(&input.variable_validation).unwrap_or_else(|_| "{}".to_string());

        conn.execute(
            "INSERT INTO recent_projects (id, project_name, output_path, schema_xml, variables, variable_validation,
                                          template_id, template_name, folders_created, files_created, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            rusqlite::params![
                &id,
                &input.project_name,
                &input.output_path,
                &input.schema_xml,
                &variables_json,
                &validation_json,
                &input.template_id,
                &input.template_name,
                input.folders_created,
                input.files_created,
                &now,
            ],
        )?;

        // Auto-cleanup: keep only the most recent MAX_RECENT_PROJECTS entries
        conn.execute(
            "DELETE FROM recent_projects WHERE id NOT IN (
                SELECT id FROM recent_projects ORDER BY created_at DESC LIMIT ?
            )",
            rusqlite::params![MAX_RECENT_PROJECTS],
        )?;

        Ok(RecentProject {
            id,
            project_name: input.project_name,
            output_path: input.output_path,
            schema_xml: input.schema_xml,
            variables: input.variables,
            variable_validation: input.variable_validation,
            template_id: input.template_id,
            template_name: input.template_name,
            folders_created: input.folders_created,
            files_created: input.files_created,
            created_at: now,
        })
    }

    /// Delete a specific recent project by ID
    pub fn delete_recent_project(&self, id: &str) -> SqliteResult<bool> {
        let conn = self.conn.lock().unwrap();

        let rows_affected = conn.execute(
            "DELETE FROM recent_projects WHERE id = ?",
            [id],
        )?;

        Ok(rows_affected > 0)
    }

    /// Clear all recent projects
    pub fn clear_recent_projects(&self) -> SqliteResult<usize> {
        let conn = self.conn.lock().unwrap();

        let rows_affected = conn.execute("DELETE FROM recent_projects", [])?;

        Ok(rows_affected)
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

    // ========================================================================
    // Team Library Methods
    // ========================================================================

    /// List all team libraries
    pub fn list_team_libraries(&self) -> SqliteResult<Vec<TeamLibrary>> {
        let conn = self.conn.lock().unwrap();

        let mut stmt = conn.prepare(
            "SELECT id, name, path, sync_interval, last_sync_at, is_enabled, created_at, updated_at
             FROM team_libraries
             ORDER BY name ASC",
        )?;

        let libraries = stmt.query_map([], row_to_team_library)?;
        libraries.collect()
    }

    /// Get a team library by ID
    pub fn get_team_library(&self, id: &str) -> SqliteResult<Option<TeamLibrary>> {
        let conn = self.conn.lock().unwrap();

        let mut stmt = conn.prepare(
            "SELECT id, name, path, sync_interval, last_sync_at, is_enabled, created_at, updated_at
             FROM team_libraries
             WHERE id = ?",
        )?;

        let mut rows = stmt.query([id])?;
        match rows.next()? {
            Some(row) => Ok(Some(row_to_team_library(row)?)),
            None => Ok(None),
        }
    }

    /// Create a new team library
    pub fn create_team_library(&self, input: CreateTeamLibraryInput) -> SqliteResult<TeamLibrary> {
        let conn = self.conn.lock().unwrap();

        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        conn.execute(
            "INSERT INTO team_libraries (id, name, path, sync_interval, is_enabled, created_at, updated_at)
             VALUES (?, ?, ?, ?, 1, ?, ?)",
            rusqlite::params![
                &id,
                &input.name,
                &input.path,
                input.sync_interval,
                &now,
                &now,
            ],
        )?;

        Ok(TeamLibrary {
            id,
            name: input.name,
            path: input.path,
            sync_interval: input.sync_interval,
            last_sync_at: None,
            is_enabled: true,
            created_at: now.clone(),
            updated_at: now,
        })
    }

    /// Update a team library
    pub fn update_team_library(&self, id: &str, input: UpdateTeamLibraryInput) -> SqliteResult<Option<TeamLibrary>> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();

        // Build dynamic update query
        let mut updates = vec!["updated_at = ?"];
        let mut params: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(now.clone())];

        if let Some(name) = input.name {
            updates.push("name = ?");
            params.push(Box::new(name));
        }
        if let Some(path) = input.path {
            updates.push("path = ?");
            params.push(Box::new(path));
        }
        if let Some(sync_interval) = input.sync_interval {
            updates.push("sync_interval = ?");
            params.push(Box::new(sync_interval));
        }
        if let Some(is_enabled) = input.is_enabled {
            updates.push("is_enabled = ?");
            params.push(Box::new(if is_enabled { 1 } else { 0 }));
        }

        params.push(Box::new(id.to_string()));

        let query = format!(
            "UPDATE team_libraries SET {} WHERE id = ?",
            updates.join(", ")
        );

        let params_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p.as_ref()).collect();
        let rows_affected = conn.execute(&query, params_refs.as_slice())?;

        if rows_affected == 0 {
            return Ok(None);
        }

        drop(conn);
        self.get_team_library(id)
    }

    /// Update the last_sync_at timestamp for a library
    pub fn update_team_library_last_sync(&self, id: &str) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();

        conn.execute(
            "UPDATE team_libraries SET last_sync_at = ?, updated_at = ? WHERE id = ?",
            rusqlite::params![&now, &now, id],
        )?;

        Ok(())
    }

    /// Delete a team library (also deletes associated sync logs via CASCADE)
    pub fn delete_team_library(&self, id: &str) -> SqliteResult<bool> {
        let conn = self.conn.lock().unwrap();

        // Delete sync logs first (SQLite CASCADE may not be enabled by default)
        conn.execute(
            "DELETE FROM sync_log WHERE library_id = ?",
            [id],
        )?;

        let rows_affected = conn.execute(
            "DELETE FROM team_libraries WHERE id = ?",
            [id],
        )?;

        Ok(rows_affected > 0)
    }

    // ========================================================================
    // Sync Log Methods
    // ========================================================================

    /// Add a sync log entry
    pub fn add_sync_log(&self, library_id: &str, action: &str, template_name: Option<&str>, details: Option<&str>) -> SqliteResult<SyncLogEntry> {
        let conn = self.conn.lock().unwrap();

        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        conn.execute(
            "INSERT INTO sync_log (id, library_id, action, template_name, details, created_at)
             VALUES (?, ?, ?, ?, ?, ?)",
            rusqlite::params![
                &id,
                library_id,
                action,
                template_name,
                details,
                &now,
            ],
        )?;

        Ok(SyncLogEntry {
            id,
            library_id: library_id.to_string(),
            action: action.to_string(),
            template_name: template_name.map(|s| s.to_string()),
            details: details.map(|s| s.to_string()),
            created_at: now,
        })
    }

    /// Get sync log entries, optionally filtered by library ID
    pub fn get_sync_log(&self, library_id: Option<&str>, limit: i32) -> SqliteResult<Vec<SyncLogEntry>> {
        let conn = self.conn.lock().unwrap();

        let (query, params): (String, Vec<Box<dyn rusqlite::ToSql>>) = if let Some(lib_id) = library_id {
            (
                "SELECT id, library_id, action, template_name, details, created_at
                 FROM sync_log
                 WHERE library_id = ?
                 ORDER BY created_at DESC
                 LIMIT ?".to_string(),
                vec![Box::new(lib_id.to_string()), Box::new(limit)],
            )
        } else {
            (
                "SELECT id, library_id, action, template_name, details, created_at
                 FROM sync_log
                 ORDER BY created_at DESC
                 LIMIT ?".to_string(),
                vec![Box::new(limit)],
            )
        };

        let params_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p.as_ref()).collect();
        let mut stmt = conn.prepare(&query)?;

        let entries = stmt.query_map(params_refs.as_slice(), row_to_sync_log_entry)?;
        entries.collect()
    }

    /// Clear old sync log entries (keep only the most recent N entries per library)
    pub fn cleanup_sync_log(&self, keep_per_library: i32) -> SqliteResult<usize> {
        let conn = self.conn.lock().unwrap();

        // Delete entries that are not in the top N per library
        let rows_affected = conn.execute(
            "DELETE FROM sync_log WHERE id NOT IN (
                SELECT id FROM (
                    SELECT id, ROW_NUMBER() OVER (PARTITION BY library_id ORDER BY created_at DESC) as rn
                    FROM sync_log
                ) WHERE rn <= ?
            )",
            rusqlite::params![keep_per_library],
        )?;

        Ok(rows_affected)
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
            wizard_config: None,
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
