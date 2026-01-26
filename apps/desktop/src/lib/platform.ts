/**
 * Platform detection utilities.
 * Determines whether the app is running in Tauri (desktop) or as a web app.
 */

/**
 * Check if running in a Tauri environment.
 * Tauri injects __TAURI_INTERNALS__ into the window object.
 */
export const isTauri = (): boolean => {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
};

/**
 * Check if running as a web app (not in Tauri).
 */
export const isWeb = (): boolean => {
  return !isTauri();
};

/**
 * Check if the File System Access API is available.
 * This is required for web mode file operations.
 */
export const hasFileSystemAccess = (): boolean => {
  return (
    typeof window !== "undefined" &&
    "showOpenFilePicker" in window &&
    "showDirectoryPicker" in window &&
    "showSaveFilePicker" in window
  );
};

/**
 * Check if IndexedDB is available.
 * This is required for web mode storage.
 */
export const hasIndexedDB = (): boolean => {
  return typeof window !== "undefined" && "indexedDB" in window;
};

/**
 * Get the current platform identifier.
 */
export type Platform = "tauri" | "web";

export const getPlatform = (): Platform => {
  return isTauri() ? "tauri" : "web";
};

/**
 * Platform capabilities object.
 */
export interface PlatformCapabilities {
  platform: Platform;
  hasFileSystemAccess: boolean;
  hasIndexedDB: boolean;
  canExecuteHooks: boolean;
  canDownloadFiles: boolean;
  canProcessBinaryFiles: boolean;
}

export const getCapabilities = (): PlatformCapabilities => {
  const platform = getPlatform();

  return {
    platform,
    hasFileSystemAccess: platform === "tauri" || hasFileSystemAccess(),
    hasIndexedDB: hasIndexedDB(),
    // Hooks (shell commands) only work in Tauri
    canExecuteHooks: platform === "tauri",
    // File downloads work in both, but with different capabilities
    canDownloadFiles: true,
    // Binary file processing (DOCX, images with metadata, etc.) only in Tauri
    canProcessBinaryFiles: platform === "tauri",
  };
};
