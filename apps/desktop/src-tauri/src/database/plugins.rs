//! The plugins repository: registered plugins, their capabilities, and
//! per-plugin user settings.

use rusqlite::{Connection, Result as SqliteResult};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;

/// Plugin capability types
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, specta::Type)]
#[serde(rename_all = "kebab-case")]
pub enum PluginCapability {
    FileProcessor,
    VariableTransformer,
    SchemaValidator,
    PostCreateHook,
}

/// A registered plugin
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct Plugin {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: Option<String>,
    pub path: String,
    pub capabilities: Vec<PluginCapability>,
    pub file_types: Vec<String>,
    pub user_settings: serde_json::Value,
    pub is_enabled: bool,
    pub load_order: i32,
    pub installed_at: String,
    pub updated_at: String,
}

/// Input for creating a plugin entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreatePluginInput {
    pub name: String,
    pub version: String,
    pub description: Option<String>,
    pub path: String,
    pub capabilities: Vec<PluginCapability>,
    pub file_types: Vec<String>,
}

/// Input for updating a plugin
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdatePluginInput {
    pub version: Option<String>,
    pub description: Option<String>,
    pub capabilities: Option<Vec<PluginCapability>>,
    pub file_types: Option<Vec<String>>,
    pub user_settings: Option<serde_json::Value>,
    pub is_enabled: Option<bool>,
    pub load_order: Option<i32>,
}

/// Helper to map a database row to Plugin
fn row_to_plugin(row: &rusqlite::Row) -> rusqlite::Result<Plugin> {
    let capabilities_json: String = row.get(5)?;
    let capabilities: Vec<PluginCapability> = serde_json::from_str(&capabilities_json)
        .unwrap_or_default();

    let file_types_json: String = row.get(6)?;
    let file_types: Vec<String> = serde_json::from_str(&file_types_json)
        .unwrap_or_default();

    let user_settings_json: String = row.get(7)?;
    let user_settings: serde_json::Value = serde_json::from_str(&user_settings_json)
        .unwrap_or(serde_json::json!({}));

    Ok(Plugin {
        id: row.get(0)?,
        name: row.get(1)?,
        version: row.get(2)?,
        description: row.get(3)?,
        path: row.get(4)?,
        capabilities,
        file_types,
        user_settings,
        is_enabled: row.get::<_, i32>(8)? != 0,
        load_order: row.get(9)?,
        installed_at: row.get(10)?,
        updated_at: row.get(11)?,
    })
}

/// Create the plugins table.
pub(super) fn init(conn: &Connection) -> SqliteResult<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS plugins (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            version TEXT NOT NULL,
            description TEXT,
            path TEXT NOT NULL,
            capabilities TEXT DEFAULT '[]',
            file_types TEXT DEFAULT '[]',
            user_settings TEXT DEFAULT '{}',
            is_enabled INTEGER DEFAULT 1,
            load_order INTEGER DEFAULT 100,
            installed_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )",
        [],
    )?;

    Ok(())
}

/// The plugins repository.
pub struct Plugins<'a> {
    conn: &'a Mutex<Connection>,
}

impl<'a> Plugins<'a> {
    pub(super) fn new(conn: &'a Mutex<Connection>) -> Self {
        Plugins { conn }
    }

    /// List all plugins, ordered by load_order then name
    pub fn list(&self) -> SqliteResult<Vec<Plugin>> {
        let conn = self.conn.lock().unwrap();

        let mut stmt = conn.prepare(
            "SELECT id, name, version, description, path, capabilities, file_types, user_settings, is_enabled, load_order, installed_at, updated_at
             FROM plugins
             ORDER BY load_order ASC, name ASC",
        )?;

        let plugins = stmt.query_map([], row_to_plugin)?;
        plugins.collect()
    }

    /// Get a plugin by ID
    pub fn get(&self, id: &str) -> SqliteResult<Option<Plugin>> {
        let conn = self.conn.lock().unwrap();

        let mut stmt = conn.prepare(
            "SELECT id, name, version, description, path, capabilities, file_types, user_settings, is_enabled, load_order, installed_at, updated_at
             FROM plugins
             WHERE id = ?",
        )?;

        let mut rows = stmt.query([id])?;
        match rows.next()? {
            Some(row) => Ok(Some(row_to_plugin(row)?)),
            None => Ok(None),
        }
    }

    /// Get a plugin by name (case-insensitive)
    pub fn get_by_name(&self, name: &str) -> SqliteResult<Option<Plugin>> {
        let conn = self.conn.lock().unwrap();

        let mut stmt = conn.prepare(
            "SELECT id, name, version, description, path, capabilities, file_types, user_settings, is_enabled, load_order, installed_at, updated_at
             FROM plugins
             WHERE LOWER(name) = LOWER(?)",
        )?;

        let mut rows = stmt.query([name])?;
        match rows.next()? {
            Some(row) => Ok(Some(row_to_plugin(row)?)),
            None => Ok(None),
        }
    }

    /// Create a new plugin entry
    pub fn create(&self, input: CreatePluginInput) -> SqliteResult<Plugin> {
        let conn = self.conn.lock().unwrap();

        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let capabilities_json = serde_json::to_string(&input.capabilities).unwrap_or_else(|_| "[]".to_string());
        let file_types_json = serde_json::to_string(&input.file_types).unwrap_or_else(|_| "[]".to_string());

        conn.execute(
            "INSERT INTO plugins (id, name, version, description, path, capabilities, file_types, user_settings, is_enabled, load_order, installed_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, '{}', 1, 100, ?, ?)",
            rusqlite::params![
                &id,
                &input.name,
                &input.version,
                &input.description,
                &input.path,
                &capabilities_json,
                &file_types_json,
                &now,
                &now,
            ],
        )?;

        Ok(Plugin {
            id,
            name: input.name,
            version: input.version,
            description: input.description,
            path: input.path,
            capabilities: input.capabilities,
            file_types: input.file_types,
            user_settings: serde_json::json!({}),
            is_enabled: true,
            load_order: 100,
            installed_at: now.clone(),
            updated_at: now,
        })
    }

    /// Update an existing plugin
    pub fn update(&self, id: &str, input: UpdatePluginInput) -> SqliteResult<Option<Plugin>> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();

        let mut updates = vec!["updated_at = ?"];
        let mut params: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(now.clone())];

        if let Some(version) = input.version {
            updates.push("version = ?");
            params.push(Box::new(version));
        }
        if let Some(description) = input.description {
            updates.push("description = ?");
            params.push(Box::new(description));
        }
        if let Some(capabilities) = input.capabilities {
            updates.push("capabilities = ?");
            params.push(Box::new(serde_json::to_string(&capabilities).unwrap_or_else(|_| "[]".to_string())));
        }
        if let Some(file_types) = input.file_types {
            updates.push("file_types = ?");
            params.push(Box::new(serde_json::to_string(&file_types).unwrap_or_else(|_| "[]".to_string())));
        }
        if let Some(user_settings) = input.user_settings {
            updates.push("user_settings = ?");
            params.push(Box::new(serde_json::to_string(&user_settings).unwrap_or_else(|_| "{}".to_string())));
        }
        if let Some(is_enabled) = input.is_enabled {
            updates.push("is_enabled = ?");
            params.push(Box::new(if is_enabled { 1 } else { 0 }));
        }
        if let Some(load_order) = input.load_order {
            updates.push("load_order = ?");
            params.push(Box::new(load_order));
        }

        params.push(Box::new(id.to_string()));

        let query = format!(
            "UPDATE plugins SET {} WHERE id = ?",
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

    /// Delete a plugin
    pub fn delete(&self, id: &str) -> SqliteResult<bool> {
        let conn = self.conn.lock().unwrap();

        let rows_affected = conn.execute(
            "DELETE FROM plugins WHERE id = ?",
            [id],
        )?;

        Ok(rows_affected > 0)
    }

    /// Enable a plugin
    pub fn enable(&self, id: &str) -> SqliteResult<Option<Plugin>> {
        self.update(id, UpdatePluginInput {
            version: None,
            description: None,
            capabilities: None,
            file_types: None,
            user_settings: None,
            is_enabled: Some(true),
            load_order: None,
        })
    }

    /// Disable a plugin
    pub fn disable(&self, id: &str) -> SqliteResult<Option<Plugin>> {
        self.update(id, UpdatePluginInput {
            version: None,
            description: None,
            capabilities: None,
            file_types: None,
            user_settings: None,
            is_enabled: Some(false),
            load_order: None,
        })
    }

    /// Get plugin user settings
    pub fn settings(&self, id: &str) -> SqliteResult<Option<serde_json::Value>> {
        let plugin = self.get(id)?;
        Ok(plugin.map(|p| p.user_settings))
    }

    /// Save plugin user settings
    pub fn save_settings(&self, id: &str, settings: serde_json::Value) -> SqliteResult<Option<Plugin>> {
        self.update(id, UpdatePluginInput {
            version: None,
            description: None,
            capabilities: None,
            file_types: None,
            user_settings: Some(settings),
            is_enabled: None,
            load_order: None,
        })
    }

    /// List enabled plugins with a specific capability
    pub fn with_capability(&self, capability: PluginCapability) -> SqliteResult<Vec<Plugin>> {
        let all_plugins = self.list()?;
        Ok(all_plugins
            .into_iter()
            .filter(|p| p.is_enabled && p.capabilities.contains(&capability))
            .collect())
    }
}
