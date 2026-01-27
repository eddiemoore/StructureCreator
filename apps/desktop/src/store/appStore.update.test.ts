import { describe, it, expect, beforeEach } from "vitest";
import { useAppStore } from "./appStore";

describe("appStore update state", () => {
  beforeEach(() => {
    // Reset the store before each test
    useAppStore.getState().resetUpdateState();
  });

  describe("initial state", () => {
    it("has correct initial update state", () => {
      const state = useAppStore.getState();
      expect(state.updateState).toEqual({
        status: "idle",
        info: null,
        progress: null,
        error: null,
      });
    });
  });

  describe("setUpdateStatus", () => {
    it("updates the status", () => {
      useAppStore.getState().setUpdateStatus("checking");
      expect(useAppStore.getState().updateState.status).toBe("checking");

      useAppStore.getState().setUpdateStatus("available");
      expect(useAppStore.getState().updateState.status).toBe("available");

      useAppStore.getState().setUpdateStatus("downloading");
      expect(useAppStore.getState().updateState.status).toBe("downloading");

      useAppStore.getState().setUpdateStatus("ready");
      expect(useAppStore.getState().updateState.status).toBe("ready");

      useAppStore.getState().setUpdateStatus("up-to-date");
      expect(useAppStore.getState().updateState.status).toBe("up-to-date");
    });

    it("preserves other state when updating status", () => {
      const info = { version: "2.0.0", currentVersion: "1.0.0" };
      useAppStore.getState().setUpdateInfo(info);
      useAppStore.getState().setUpdateStatus("available");

      const state = useAppStore.getState().updateState;
      expect(state.status).toBe("available");
      expect(state.info).toEqual(info);
    });
  });

  describe("setUpdateInfo", () => {
    it("sets update info", () => {
      const info = {
        version: "2.0.0",
        currentVersion: "1.0.0",
        body: "Release notes",
        date: "2026-01-27",
      };

      useAppStore.getState().setUpdateInfo(info);
      expect(useAppStore.getState().updateState.info).toEqual(info);
    });

    it("clears update info when set to null", () => {
      useAppStore.getState().setUpdateInfo({ version: "2.0.0", currentVersion: "1.0.0" });
      useAppStore.getState().setUpdateInfo(null);
      expect(useAppStore.getState().updateState.info).toBeNull();
    });
  });

  describe("setUpdateProgress", () => {
    it("sets download progress", () => {
      const progress = { downloaded: 5000000, total: 10000000 };
      useAppStore.getState().setUpdateProgress(progress);
      expect(useAppStore.getState().updateState.progress).toEqual(progress);
    });

    it("clears progress when set to null", () => {
      useAppStore.getState().setUpdateProgress({ downloaded: 100, total: 100 });
      useAppStore.getState().setUpdateProgress(null);
      expect(useAppStore.getState().updateState.progress).toBeNull();
    });
  });

  describe("setUpdateError", () => {
    it("sets error and changes status to error", () => {
      useAppStore.getState().setUpdateStatus("checking");
      useAppStore.getState().setUpdateError("Network error");

      const state = useAppStore.getState().updateState;
      expect(state.error).toBe("Network error");
      expect(state.status).toBe("error");
    });

    it("clears error without changing status when set to null", () => {
      useAppStore.getState().setUpdateStatus("available");
      useAppStore.getState().setUpdateError(null);

      const state = useAppStore.getState().updateState;
      expect(state.error).toBeNull();
      expect(state.status).toBe("available");
    });
  });

  describe("resetUpdateState", () => {
    it("resets all update state to initial values", () => {
      // Set various state
      useAppStore.getState().setUpdateStatus("downloading");
      useAppStore.getState().setUpdateInfo({ version: "2.0.0", currentVersion: "1.0.0" });
      useAppStore.getState().setUpdateProgress({ downloaded: 5000, total: 10000 });
      useAppStore.getState().setUpdateError("Some error");

      // Reset
      useAppStore.getState().resetUpdateState();

      // Verify reset
      const state = useAppStore.getState().updateState;
      expect(state).toEqual({
        status: "idle",
        info: null,
        progress: null,
        error: null,
      });
    });
  });

  describe("update flow simulation", () => {
    it("simulates a complete update check flow", () => {
      const store = useAppStore.getState();

      // Start checking
      store.setUpdateStatus("checking");
      expect(useAppStore.getState().updateState.status).toBe("checking");

      // Update available
      store.setUpdateInfo({
        version: "2.0.0",
        currentVersion: "1.0.0",
        body: "## New Features\n- Auto update",
      });
      store.setUpdateStatus("available");

      let state = useAppStore.getState().updateState;
      expect(state.status).toBe("available");
      expect(state.info?.version).toBe("2.0.0");

      // Start downloading
      store.setUpdateStatus("downloading");
      store.setUpdateProgress({ downloaded: 0, total: 10000000 });

      state = useAppStore.getState().updateState;
      expect(state.status).toBe("downloading");
      expect(state.progress?.total).toBe(10000000);

      // Progress update
      store.setUpdateProgress({ downloaded: 5000000, total: 10000000 });
      expect(useAppStore.getState().updateState.progress?.downloaded).toBe(5000000);

      // Download complete
      store.setUpdateProgress({ downloaded: 10000000, total: 10000000 });
      store.setUpdateStatus("ready");

      state = useAppStore.getState().updateState;
      expect(state.status).toBe("ready");
    });

    it("simulates an update check with no update available", () => {
      const store = useAppStore.getState();

      store.setUpdateStatus("checking");
      store.setUpdateStatus("up-to-date");

      expect(useAppStore.getState().updateState.status).toBe("up-to-date");
      expect(useAppStore.getState().updateState.info).toBeNull();
    });

    it("simulates an update check with error", () => {
      const store = useAppStore.getState();

      store.setUpdateStatus("checking");
      store.setUpdateError("Failed to connect to update server");

      const state = useAppStore.getState().updateState;
      expect(state.status).toBe("error");
      expect(state.error).toBe("Failed to connect to update server");
    });
  });
});
