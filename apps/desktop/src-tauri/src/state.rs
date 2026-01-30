//! Application state for the Tauri app.

#[cfg(feature = "tauri-app")]
use std::sync::mpsc;

#[cfg(feature = "tauri-app")]
use crate::database::Database;

/// Application state managed by Tauri
#[cfg(feature = "tauri-app")]
pub struct AppState {
    pub db: Database,
    /// Channel sender to stop the file watcher
    pub watch_stop_tx: Option<mpsc::Sender<()>>,
    /// Currently watched file path
    pub watch_path: Option<String>,
}
