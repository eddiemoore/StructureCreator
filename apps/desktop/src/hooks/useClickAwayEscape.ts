import { useEffect, RefObject } from "react";

/**
 * Custom hook to handle click-away and Escape key for closing popovers/panels.
 * Consolidates the common pattern of closing UI elements when clicking outside
 * or pressing Escape.
 *
 * @param ref - React ref attached to the popover/panel element
 * @param isOpen - Whether the popover/panel is currently open
 * @param onClose - Callback to close the popover/panel
 */
export function useClickAwayEscape(
  ref: RefObject<HTMLElement>,
  isOpen: boolean,
  onClose: () => void
): void {
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      // Only handle Escape if focus is within the element or no specific element has focus
      // This prevents closing the popover when user presses Escape in unrelated inputs
      if (event.key === "Escape") {
        const activeElement = document.activeElement;
        const focusInRef = ref.current?.contains(activeElement);
        const focusOnBody = activeElement === document.body;
        if (focusInRef || focusOnBody) {
          onClose();
        }
      }
    };

    // Use mousedown to catch clicks before they bubble
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [ref, isOpen, onClose]);
}
