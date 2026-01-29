import { describe, it, expect } from "vitest";
import { SHORTCUT_EVENTS, getShortcutLabel } from "./shortcuts";

describe("shortcuts constants", () => {
  describe("SHORTCUT_EVENTS", () => {
    it("includes NEW_SCHEMA event", () => {
      expect(SHORTCUT_EVENTS.NEW_SCHEMA).toBe("shortcut:new-schema");
    });

    it("includes all expected events", () => {
      expect(SHORTCUT_EVENTS).toEqual({
        CREATE_STRUCTURE: "shortcut:create-structure",
        OPEN_FILE: "shortcut:open-file",
        SAVE_TEMPLATE: "shortcut:save-template",
        NEW_SCHEMA: "shortcut:new-schema",
      });
    });
  });

  describe("getShortcutLabel", () => {
    it("returns a label for NEW_SCHEMA", () => {
      const label = getShortcutLabel("NEW_SCHEMA");
      // Should be either ⌘N (Mac) or Ctrl+N (other)
      expect(["⌘N", "Ctrl+N"]).toContain(label);
    });

    it("returns labels for all shortcuts", () => {
      const shortcuts = [
        "CREATE_STRUCTURE",
        "OPEN_FILE",
        "SAVE_TEMPLATE",
        "FOCUS_SEARCH",
        "NEW_SCHEMA",
      ] as const;

      for (const shortcut of shortcuts) {
        const label = getShortcutLabel(shortcut);
        expect(label).toBeTruthy();
        expect(typeof label).toBe("string");
      }
    });
  });
});
