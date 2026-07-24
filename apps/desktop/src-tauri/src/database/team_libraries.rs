//! The team-libraries repository: configured shared template folders and
//! their sync-log audit trail (one aggregate — sync_log is FK-owned by
//! team_libraries and only written by team-library operations).

use rusqlite::{Connection, Result as SqliteResult};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;

/// A configured team library (shared folder containing .sct template files)
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
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
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
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

/// Create the team_libraries table and its sync_log child table.
pub(super) fn init(conn: &Connection) -> SqliteResult<()> {
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

/// The team-libraries repository (libraries + their sync log).
pub struct TeamLibraries<'a> {
    conn: &'a Mutex<Connection>,
}

impl<'a> TeamLibraries<'a> {
    pub(super) fn new(conn: &'a Mutex<Connection>) -> Self {
        TeamLibraries { conn }
    }

    /// List all team libraries
    pub fn list(&self) -> SqliteResult<Vec<TeamLibrary>> {
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
    pub fn get(&self, id: &str) -> SqliteResult<Option<TeamLibrary>> {
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
    pub fn create(&self, input: CreateTeamLibraryInput) -> SqliteResult<TeamLibrary> {
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
    pub fn update(&self, id: &str, input: UpdateTeamLibraryInput) -> SqliteResult<Option<TeamLibrary>> {
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
        self.get(id)
    }

    /// Update the last_sync_at timestamp for a library
    pub fn update_last_sync(&self, id: &str) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();

        conn.execute(
            "UPDATE team_libraries SET last_sync_at = ?, updated_at = ? WHERE id = ?",
            rusqlite::params![&now, &now, id],
        )?;

        Ok(())
    }

    /// Delete a team library (also deletes associated sync logs via CASCADE)
    pub fn delete(&self, id: &str) -> SqliteResult<bool> {
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
    pub fn sync_log(&self, library_id: Option<&str>, limit: i32) -> SqliteResult<Vec<SyncLogEntry>> {
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
