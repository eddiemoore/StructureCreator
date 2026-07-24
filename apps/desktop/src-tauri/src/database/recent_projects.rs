//! The recent-projects repository: a capped history of created structures.

use super::ValidationRule;
use rusqlite::{Connection, Result as SqliteResult};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;

/// Maximum number of recent projects to keep
const MAX_RECENT_PROJECTS: usize = 20;

/// A recent project entry
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
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

/// Create the recent_projects table.
pub(super) fn init(conn: &Connection) -> SqliteResult<()> {
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

    Ok(())
}

/// The recent-projects repository.
pub struct RecentProjects<'a> {
    conn: &'a Mutex<Connection>,
}

impl<'a> RecentProjects<'a> {
    pub(super) fn new(conn: &'a Mutex<Connection>) -> Self {
        RecentProjects { conn }
    }

    /// List all recent projects, sorted by created_at descending (newest first)
    pub fn list(&self) -> SqliteResult<Vec<RecentProject>> {
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
    pub fn get(&self, id: &str) -> SqliteResult<Option<RecentProject>> {
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
    pub fn add(&self, input: CreateRecentProjectInput) -> SqliteResult<RecentProject> {
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
    pub fn delete(&self, id: &str) -> SqliteResult<bool> {
        let conn = self.conn.lock().unwrap();

        let rows_affected = conn.execute(
            "DELETE FROM recent_projects WHERE id = ?",
            [id],
        )?;

        Ok(rows_affected > 0)
    }

    /// Clear all recent projects
    pub fn clear(&self) -> SqliteResult<usize> {
        let conn = self.conn.lock().unwrap();

        let rows_affected = conn.execute("DELETE FROM recent_projects", [])?;

        Ok(rows_affected)
    }
}
