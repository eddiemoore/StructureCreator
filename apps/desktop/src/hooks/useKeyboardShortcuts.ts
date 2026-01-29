import { useEffect, RefObject } from "react";
import { SHORTCUT_EVENTS } from "../constants/shortcuts";

interface UseKeyboardShortcutsOptions {
  /** Ref to the search input for focus shortcut */
  searchInputRef: RefObject<HTMLInputElement>;
  /** Whether any modal is currently open */
  isModalOpen: boolean;
  /** Whether a schema is currently loaded (for save template shortcut) */
  hasSchema: boolean;
}

/**
 * Checks if the currently focused element is an input field
 * where keyboard shortcuts should be disabled.
 */
function isInputFocused(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  return (
    tag === "input" ||
    tag === "textarea" ||
    tag === "select" ||
    (el as HTMLElement).isContentEditable
  );
}

/**
 * Centralized hook for managing global keyboard shortcuts.
 *
 * Event flow:
 * - Cmd+Enter → SHORTCUT_EVENTS.CREATE_STRUCTURE → RightPanel.handleCreateRef
 * - Cmd+N     → SHORTCUT_EVENTS.NEW_SCHEMA       → App.createNewSchema
 * - Cmd+O     → SHORTCUT_EVENTS.OPEN_FILE        → LeftPanel.handleSelectSchemaRef
 * - Cmd+S     → SHORTCUT_EVENTS.SAVE_TEMPLATE    → LeftPanel.setIsSavingTemplate
 * - Cmd+F     → (direct) searchInputRef.focus()   (no event, hence no FOCUS_SEARCH in SHORTCUT_EVENTS)
 *
 * Key comparison notes:
 * - Letter keys use .toLowerCase() to handle CapsLock state
 * - Special keys (Enter) use direct comparison as they're consistent
 *
 * Note: Escape key is handled by individual modals (SettingsModal, DiffPreviewModal,
 * ImportExportModal) to avoid double-firing issues.
 *
 * Note: Arrow key navigation for templates is handled in LeftPanel
 * as it requires component-local state.
 */
export function useKeyboardShortcuts({
  searchInputRef,
  isModalOpen,
  hasSchema,
}: UseKeyboardShortcutsOptions): void {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isMod = event.metaKey || event.ctrlKey;

      // Skip all shortcuts when modal is open
      // Escape is handled by individual modals to avoid double-firing
      if (isModalOpen) {
        return;
      }

      // Skip shortcuts when in input fields (except Cmd+F for search)
      // Letter keys use .toLowerCase() to handle CapsLock
      if (isInputFocused() && !(isMod && event.key.toLowerCase() === "f")) {
        return;
      }

      // Cmd/Ctrl + Enter: Create structure
      // Special keys like Enter don't need toLowerCase()
      if (isMod && event.key === "Enter") {
        event.preventDefault();
        window.dispatchEvent(new CustomEvent(SHORTCUT_EVENTS.CREATE_STRUCTURE));
        return;
      }

      // Cmd/Ctrl + N: New schema
      if (isMod && event.key.toLowerCase() === "n") {
        event.preventDefault();
        window.dispatchEvent(new CustomEvent(SHORTCUT_EVENTS.NEW_SCHEMA));
        return;
      }

      // Cmd/Ctrl + O: Open file picker
      // Always available - allows replacing current schema with a new one
      if (isMod && event.key.toLowerCase() === "o") {
        event.preventDefault();
        window.dispatchEvent(new CustomEvent(SHORTCUT_EVENTS.OPEN_FILE));
        return;
      }

      // Cmd/Ctrl + S: Save as template (only when schema is loaded)
      if (isMod && event.key.toLowerCase() === "s") {
        // Only prevent default and handle if schema is loaded
        // Otherwise let browser handle normally (e.g., save page dialog)
        if (hasSchema) {
          event.preventDefault();
          window.dispatchEvent(new CustomEvent(SHORTCUT_EVENTS.SAVE_TEMPLATE));
        }
        // Always return to prevent falling through to other handlers,
        // even when !hasSchema (lets browser handle Cmd+S normally)
        return;
      }

      // Cmd/Ctrl + F: Focus search input
      if (isMod && event.key.toLowerCase() === "f") {
        event.preventDefault();
        searchInputRef.current?.focus();
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [searchInputRef, isModalOpen, hasSchema]);
}
