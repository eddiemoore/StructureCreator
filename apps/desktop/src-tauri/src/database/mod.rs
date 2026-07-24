//! SQLite persistence, one repository per aggregate.
//!
//! `Database` owns the connection and hands out repositories:
//! `db.templates()`, `db.settings()`, `db.recent_projects()`,
//! `db.team_libraries()`, `db.plugins()`. Each repository module owns its
//! table's DDL, migrations, row mapping, queries, and tests.

pub mod plugins;
pub mod recent_projects;
pub mod settings;
pub mod team_libraries;
pub mod templates;

use rusqlite::{Connection, Result as SqliteResult};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;

pub use plugins::{CreatePluginInput, Plugin, PluginCapability, Plugins, UpdatePluginInput};
pub use recent_projects::{CreateRecentProjectInput, RecentProject, RecentProjects};
pub use settings::Settings;
pub use team_libraries::{
    CreateTeamLibraryInput, SyncLogEntry, TeamLibraries, TeamLibrary, UpdateTeamLibraryInput,
};
pub use templates::{CreateTemplateInput, Template, Templates, UpdateTemplateInput};

/// Validation rule for a variable
#[derive(Debug, Clone, Serialize, Deserialize, Default, specta::Type)]
#[specta(rename = "DbValidationRule")]
pub struct ValidationRule {
    pub pattern: Option<String>,
    pub min_length: Option<usize>,
    pub max_length: Option<usize>,
    #[serde(default)]
    pub required: bool,
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

        // Each repository initializes its own table(s) and migrations.
        // team_libraries also creates sync_log (FK child) in the right order.
        templates::init(&conn)?;
        settings::init(&conn)?;
        recent_projects::init(&conn)?;
        team_libraries::init(&conn)?;
        plugins::init(&conn)?;

        Ok(Database {
            conn: Mutex::new(conn),
        })
    }

    pub fn templates(&self) -> Templates<'_> {
        Templates::new(&self.conn)
    }

    pub fn settings(&self) -> Settings<'_> {
        Settings::new(&self.conn)
    }

    pub fn recent_projects(&self) -> RecentProjects<'_> {
        RecentProjects::new(&self.conn)
    }

    pub fn team_libraries(&self) -> TeamLibraries<'_> {
        TeamLibraries::new(&self.conn)
    }

    pub fn plugins(&self) -> Plugins<'_> {
        Plugins::new(&self.conn)
    }
}

#[cfg(test)]
pub(crate) mod testutil {
    use super::Database;
    use tempfile::TempDir;

    pub fn create_test_db() -> (Database, TempDir) {
        let temp_dir = TempDir::new().unwrap();
        let db = Database::new(temp_dir.path().to_path_buf()).unwrap();
        (db, temp_dir)
    }
}
