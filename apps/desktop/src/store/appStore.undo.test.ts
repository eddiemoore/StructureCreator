import { describe, it, expect, beforeEach } from "vitest";
import { useAppStore } from "./appStore";
import type { CreatedItem } from "../types/schema";

describe("appStore undo state", () => {
  beforeEach(() => {
    // Reset the store before each test
    useAppStore.getState().reset();
  });

  describe("initial state", () => {
    it("has null lastCreation initially", () => {
      const state = useAppStore.getState();
      expect(state.lastCreation).toBeNull();
    });

    it("canUndoCreation returns false when no creation exists", () => {
      expect(useAppStore.getState().canUndoCreation()).toBe(false);
    });
  });

  describe("setLastCreation", () => {
    it("sets lastCreation state", () => {
      const items: CreatedItem[] = [
        { path: "/test/file.txt", item_type: "file", pre_existed: false },
        { path: "/test/folder", item_type: "folder", pre_existed: false },
      ];

      useAppStore.getState().setLastCreation(items);

      expect(useAppStore.getState().lastCreation).toEqual(items);
    });

    it("can clear lastCreation by setting null", () => {
      const items: CreatedItem[] = [
        { path: "/test/file.txt", item_type: "file", pre_existed: false },
      ];

      useAppStore.getState().setLastCreation(items);
      expect(useAppStore.getState().lastCreation).not.toBeNull();

      useAppStore.getState().setLastCreation(null);
      expect(useAppStore.getState().lastCreation).toBeNull();
    });
  });

  describe("canUndoCreation", () => {
    it("returns true when there are undoable items", () => {
      const items: CreatedItem[] = [
        { path: "/test/file.txt", item_type: "file", pre_existed: false },
      ];

      useAppStore.getState().setLastCreation(items);

      expect(useAppStore.getState().canUndoCreation()).toBe(true);
    });

    it("returns false when all items pre-existed", () => {
      const items: CreatedItem[] = [
        { path: "/test/file.txt", item_type: "file", pre_existed: true },
        { path: "/test/folder", item_type: "folder", pre_existed: true },
      ];

      useAppStore.getState().setLastCreation(items);

      expect(useAppStore.getState().canUndoCreation()).toBe(false);
    });

    it("returns true when at least one item can be undone", () => {
      const items: CreatedItem[] = [
        { path: "/test/old.txt", item_type: "file", pre_existed: true },
        { path: "/test/new.txt", item_type: "file", pre_existed: false },
      ];

      useAppStore.getState().setLastCreation(items);

      expect(useAppStore.getState().canUndoCreation()).toBe(true);
    });

    it("returns false for empty array", () => {
      useAppStore.getState().setLastCreation([]);

      expect(useAppStore.getState().canUndoCreation()).toBe(false);
    });
  });

  describe("reset", () => {
    it("clears lastCreation when reset is called", () => {
      const items: CreatedItem[] = [
        { path: "/test/file.txt", item_type: "file", pre_existed: false },
      ];

      useAppStore.getState().setLastCreation(items);
      expect(useAppStore.getState().lastCreation).not.toBeNull();

      useAppStore.getState().reset();
      expect(useAppStore.getState().lastCreation).toBeNull();
    });
  });
});
