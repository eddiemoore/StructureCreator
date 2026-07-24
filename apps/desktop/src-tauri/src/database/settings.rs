//! The settings repository: a simple key/value store.

use rusqlite::{Connection, Result as SqliteResult};
use std::collections::HashMap;
use std::sync::Mutex;

/// Create the settings table.
pub(super) fn init(conn: &Connection) -> SqliteResult<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )",
        [],
    )?;

    Ok(())
}

/// The settings repository.
pub struct Settings<'a> {
    conn: &'a Mutex<Connection>,
}

impl<'a> Settings<'a> {
    pub(super) fn new(conn: &'a Mutex<Connection>) -> Self {
        Settings { conn }
    }

    pub fn all(&self) -> SqliteResult<HashMap<String, String>> {
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

    pub fn get(&self, key: &str) -> SqliteResult<Option<String>> {
        let conn = self.conn.lock().unwrap();

        let mut stmt = conn.prepare("SELECT value FROM settings WHERE key = ?")?;
        let mut rows = stmt.query([key])?;

        if let Some(row) = rows.next()? {
            Ok(Some(row.get(0)?))
        } else {
            Ok(None)
        }
    }

    pub fn set(&self, key: &str, value: &str) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();

        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?, ?)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [key, value],
        )?;

        Ok(())
    }

    pub fn delete(&self, key: &str) -> SqliteResult<bool> {
        let conn = self.conn.lock().unwrap();

        let rows_affected = conn.execute("DELETE FROM settings WHERE key = ?", [key])?;

        Ok(rows_affected > 0)
    }
}
