import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useKeyboardShortcuts } from "./useKeyboardShortcuts";
import { SHORTCUT_EVENTS } from "../constants/shortcuts";

describe("useKeyboardShortcuts", () => {
  const createMockRef = () => ({
    current: document.createElement("input"),
  });

  let dispatchedEvents: string[] = [];

  beforeEach(() => {
    dispatchedEvents = [];
    // Capture dispatched custom events
    const originalDispatch = window.dispatchEvent;
    vi.spyOn(window, "dispatchEvent").mockImplementation((event) => {
      if (event instanceof CustomEvent) {
        dispatchedEvents.push(event.type);
      }
      return originalDispatch.call(window, event);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const simulateKeyDown = (key: string, options: Partial<KeyboardEventInit> = {}) => {
    const event = new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      ...options,
    });
    window.dispatchEvent(event);
  };

  describe("Cmd/Ctrl + N (New Schema)", () => {
    it("dispatches NEW_SCHEMA event on Cmd+N (Mac)", () => {
      renderHook(() =>
        useKeyboardShortcuts({
          searchInputRef: createMockRef(),
          isModalOpen: false,
          hasSchema: false,
        })
      );

      simulateKeyDown("n", { metaKey: true });

      expect(dispatchedEvents).toContain(SHORTCUT_EVENTS.NEW_SCHEMA);
    });

    it("dispatches NEW_SCHEMA event on Ctrl+N (Windows/Linux)", () => {
      renderHook(() =>
        useKeyboardShortcuts({
          searchInputRef: createMockRef(),
          isModalOpen: false,
          hasSchema: false,
        })
      );

      simulateKeyDown("n", { ctrlKey: true });

      expect(dispatchedEvents).toContain(SHORTCUT_EVENTS.NEW_SCHEMA);
    });

    it("handles uppercase N (CapsLock)", () => {
      renderHook(() =>
        useKeyboardShortcuts({
          searchInputRef: createMockRef(),
          isModalOpen: false,
          hasSchema: false,
        })
      );

      simulateKeyDown("N", { metaKey: true });

      expect(dispatchedEvents).toContain(SHORTCUT_EVENTS.NEW_SCHEMA);
    });

    it("does not dispatch when modal is open", () => {
      renderHook(() =>
        useKeyboardShortcuts({
          searchInputRef: createMockRef(),
          isModalOpen: true,
          hasSchema: false,
        })
      );

      simulateKeyDown("n", { metaKey: true });

      expect(dispatchedEvents).not.toContain(SHORTCUT_EVENTS.NEW_SCHEMA);
    });

    it("does not dispatch without modifier key", () => {
      renderHook(() =>
        useKeyboardShortcuts({
          searchInputRef: createMockRef(),
          isModalOpen: false,
          hasSchema: false,
        })
      );

      simulateKeyDown("n");

      expect(dispatchedEvents).not.toContain(SHORTCUT_EVENTS.NEW_SCHEMA);
    });
  });

  describe("other shortcuts still work", () => {
    it("dispatches CREATE_STRUCTURE on Cmd+Enter", () => {
      renderHook(() =>
        useKeyboardShortcuts({
          searchInputRef: createMockRef(),
          isModalOpen: false,
          hasSchema: false,
        })
      );

      simulateKeyDown("Enter", { metaKey: true });

      expect(dispatchedEvents).toContain(SHORTCUT_EVENTS.CREATE_STRUCTURE);
    });

    it("dispatches OPEN_FILE on Cmd+O", () => {
      renderHook(() =>
        useKeyboardShortcuts({
          searchInputRef: createMockRef(),
          isModalOpen: false,
          hasSchema: false,
        })
      );

      simulateKeyDown("o", { metaKey: true });

      expect(dispatchedEvents).toContain(SHORTCUT_EVENTS.OPEN_FILE);
    });
  });
});
