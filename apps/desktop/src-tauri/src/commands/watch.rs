//! File watch mode commands.

use std::path::PathBuf;
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{Emitter, State};

use notify_debouncer_mini::{new_debouncer, notify::RecursiveMode};

use crate::state::AppState;
use crate::types::{SchemaFileChangedPayload, WatchErrorPayload};

/// Start watching a schema file for changes
#[tauri::command]
pub fn cmd_start_watch(
    app: tauri::AppHandle,
    state: State<Mutex<AppState>>,
    path: String,
) -> Result<(), String> {
    let mut state_guard = state.lock().map_err(|e| e.to_string())?;

    // Stop any existing watcher first
    if let Some(tx) = state_guard.watch_stop_tx.take() {
        let _ = tx.send(());
    }

    // Validate the path exists and is a file
    let watch_path = PathBuf::from(&path);
    if !watch_path.exists() {
        return Err(format!("File does not exist: {}", path));
    }
    if !watch_path.is_file() {
        return Err(format!("Path is not a file: {}", path));
    }

    // Create a channel to stop the watcher
    let (stop_tx, stop_rx) = mpsc::channel::<()>();

    // Store the watcher state
    state_guard.watch_stop_tx = Some(stop_tx);
    state_guard.watch_path = Some(path.clone());

    // Get the parent directory to watch (notify doesn't always work well watching single files)
    let watch_dir = watch_path
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| watch_path.clone());
    let file_name = watch_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();

    // Clone values for the watcher thread
    let app_handle = app.clone();
    let watched_path = path.clone();
    let watched_file_name = file_name;

    // Spawn a thread to run the file watcher
    std::thread::spawn(move || {
        // Create a debounced watcher with 500ms delay to avoid rapid-fire events
        let (tx, rx) = std::sync::mpsc::channel();

        let mut debouncer = match new_debouncer(Duration::from_millis(500), tx) {
            Ok(d) => d,
            Err(e) => {
                let _ = app_handle.emit(
                    "watch-error",
                    WatchErrorPayload {
                        error: format!("Failed to create file watcher: {}", e),
                    },
                );
                return;
            }
        };

        // Start watching the directory
        if let Err(e) = debouncer
            .watcher()
            .watch(&watch_dir, RecursiveMode::NonRecursive)
        {
            let _ = app_handle.emit(
                "watch-error",
                WatchErrorPayload {
                    error: format!("Failed to watch directory: {}", e),
                },
            );
            return;
        }

        loop {
            // Check if we should stop
            if stop_rx.try_recv().is_ok() {
                break;
            }

            // Check for file change events with a timeout
            match rx.recv_timeout(Duration::from_millis(100)) {
                Ok(result) => match result {
                    Ok(events) => {
                        // Check if any event is for our watched file
                        let relevant_event = events.iter().any(|event| {
                            event
                                .path
                                .file_name()
                                .map(|n| n.to_string_lossy() == watched_file_name)
                                .unwrap_or(false)
                        });

                        if relevant_event {
                            // Read the file content
                            match std::fs::read_to_string(&watched_path) {
                                Ok(content) => {
                                    let _ = app_handle.emit(
                                        "schema-file-changed",
                                        SchemaFileChangedPayload {
                                            path: watched_path.clone(),
                                            content,
                                        },
                                    );
                                }
                                Err(e) => {
                                    let _ = app_handle.emit(
                                        "watch-error",
                                        WatchErrorPayload {
                                            error: format!("Failed to read file: {}", e),
                                        },
                                    );
                                }
                            }
                        }
                    }
                    Err(e) => {
                        let _ = app_handle.emit(
                            "watch-error",
                            WatchErrorPayload {
                                error: format!("Watch error: {:?}", e),
                            },
                        );
                    }
                },
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                    // Continue the loop
                }
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                    // Watcher disconnected, exit the loop
                    break;
                }
            }
        }
    });

    Ok(())
}

/// Stop watching the schema file
#[tauri::command]
pub fn cmd_stop_watch(state: State<Mutex<AppState>>) -> Result<(), String> {
    let mut state_guard = state.lock().map_err(|e| e.to_string())?;

    // Send stop signal to the watcher thread
    if let Some(tx) = state_guard.watch_stop_tx.take() {
        let _ = tx.send(());
    }

    state_guard.watch_path = None;

    Ok(())
}

/// Get the currently watched path (if any)
#[tauri::command]
pub fn cmd_get_watch_status(state: State<Mutex<AppState>>) -> Result<Option<String>, String> {
    let state_guard = state.lock().map_err(|e| e.to_string())?;
    Ok(state_guard.watch_path.clone())
}
