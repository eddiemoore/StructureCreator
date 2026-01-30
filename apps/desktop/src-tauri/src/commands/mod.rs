//! Tauri command handlers organized by domain.

pub mod import_export;
pub mod plugins;
pub mod recent_projects;
pub mod schema;
pub mod settings;
pub mod structure;
pub mod team_library;
pub mod templates;
pub mod validation;
pub mod watch;

// Re-export all commands for use in generate_handler!
pub use import_export::*;
pub use plugins::*;
pub use recent_projects::*;
pub use schema::*;
pub use settings::*;
pub use structure::*;
pub use team_library::*;
pub use templates::*;
pub use validation::*;
pub use watch::*;
