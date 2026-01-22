/**
 * Sanitize a string for use as a filename.
 * Handles Windows forbidden characters, control characters, leading dots, and whitespace.
 */
export const sanitizeFilename = (name: string): string => {
  return name
    .replace(/[<>:"/\\|?*]/g, "_") // Windows forbidden chars
    .replace(/[\x00-\x1f]/g, "")   // Control characters
    .replace(/\s+/g, " ")          // Collapse whitespace
    .trim()                        // Trim whitespace
    .replace(/^\.+/, "")           // Remove leading dots (after trim so " .hidden" -> "hidden")
    || "template";                 // Fallback if empty
};
