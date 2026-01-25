/**
 * Keyboard shortcut event names used for cross-component communication.
 * Centralized here to prevent typos and enable easy refactoring.
 *
 * Event ownership (which component listens):
 * - CREATE_STRUCTURE: RightPanel
 * - OPEN_FILE: LeftPanel
 * - SAVE_TEMPLATE: LeftPanel
 *
 * Note: Escape key is handled by individual modals (SettingsModal, DiffPreviewModal,
 * ImportExportModal) rather than centrally, to avoid double-firing issues.
 */
export const SHORTCUT_EVENTS = {
  CREATE_STRUCTURE: "shortcut:create-structure",
  OPEN_FILE: "shortcut:open-file",
  SAVE_TEMPLATE: "shortcut:save-template",
  UNDO: "shortcut:undo",
  REDO: "shortcut:redo",
} as const;

/**
 * Type for Navigator with userAgentData (not yet in all TS libs)
 */
interface NavigatorUAData {
  platform?: string;
}

type NavigatorWithUAData = Navigator & {
  userAgentData?: NavigatorUAData;
};

/**
 * Detect if the current platform is macOS.
 * Uses modern userAgentData API with fallback to userAgent string matching.
 * Computed once at module load since platform doesn't change during session.
 */
function detectMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;

  // Modern API (Chromium-based browsers)
  const nav = navigator as NavigatorWithUAData;
  if (nav.userAgentData?.platform) {
    return nav.userAgentData.platform === "macOS";
  }

  // Fallback to userAgent string matching
  return /Mac|iPod|iPhone|iPad/.test(navigator.userAgent);
}

/** Cached platform detection result - computed once at module load */
const IS_MAC = detectMacPlatform();

/**
 * Keyboard shortcut display labels for tooltips and help text.
 * Mac format uses symbols, Windows/Linux uses text.
 */
const SHORTCUT_LABELS_MAC = {
  CREATE_STRUCTURE: "\u2318\u21A9", // ⌘↩
  OPEN_FILE: "\u2318O", // ⌘O
  SAVE_TEMPLATE: "\u2318S", // ⌘S
  FOCUS_SEARCH: "\u2318F", // ⌘F
  UNDO: "\u2318Z", // ⌘Z
  REDO: "\u21E7\u2318Z", // ⇧⌘Z
} as const;

const SHORTCUT_LABELS_OTHER = {
  CREATE_STRUCTURE: "Ctrl+Enter",
  OPEN_FILE: "Ctrl+O",
  SAVE_TEMPLATE: "Ctrl+S",
  FOCUS_SEARCH: "Ctrl+F",
  UNDO: "Ctrl+Z",
  REDO: "Ctrl+Y",
} as const;

export type ShortcutKey = keyof typeof SHORTCUT_LABELS_MAC;

/**
 * Get platform-appropriate shortcut label for tooltips.
 * Uses cached platform detection for performance.
 */
export function getShortcutLabel(shortcut: ShortcutKey): string {
  return IS_MAC ? SHORTCUT_LABELS_MAC[shortcut] : SHORTCUT_LABELS_OTHER[shortcut];
}
