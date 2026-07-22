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
 * Get the current platform identifier.
 */
export type Platform = "tauri" | "web";

export const getPlatform = (): Platform => {
  return isTauri() ? "tauri" : "web";
};
