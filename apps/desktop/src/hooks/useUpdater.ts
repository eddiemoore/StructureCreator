import { useCallback } from "react";
import { useAppStore } from "../store/appStore";
import { api } from "../lib/api";

interface UseUpdaterReturn {
  checkForUpdates: (silent?: boolean) => Promise<void>;
  downloadAndInstall: () => Promise<void>;
  installAndRelaunch: () => Promise<void>;
}

export const useUpdater = (): UseUpdaterReturn => {
  const {
    setUpdateStatus,
    setUpdateInfo,
    setUpdateProgress,
    setUpdateError,
    resetUpdateState,
  } = useAppStore();

  const checkForUpdates = useCallback(
    async (silent = false) => {
      if (!api.isTauri()) {
        if (!silent) {
          setUpdateError("Updates are only available in the desktop app");
        }
        return;
      }

      try {
        setUpdateStatus("checking");
        setUpdateError(null);

        const { check } = await import("@tauri-apps/plugin-updater");
        const { getVersion } = await import("@tauri-apps/api/app");

        const currentVersion = await getVersion();
        const update = await check();

        if (update) {
          setUpdateInfo({
            version: update.version,
            currentVersion,
            body: update.body ?? undefined,
            date: update.date ?? undefined,
          });
          setUpdateStatus("available");
        } else {
          setUpdateStatus("up-to-date");
          if (!silent) {
            // Keep the status visible briefly for user feedback
            setTimeout(() => {
              resetUpdateState();
            }, 3000);
          } else {
            resetUpdateState();
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("Failed to check for updates:", error);
        if (!silent) {
          setUpdateError(message);
        } else {
          resetUpdateState();
        }
      }
    },
    [setUpdateStatus, setUpdateInfo, setUpdateError, resetUpdateState]
  );

  const downloadAndInstall = useCallback(async () => {
    if (!api.isTauri()) {
      setUpdateError("Updates are only available in the desktop app");
      return;
    }

    try {
      setUpdateStatus("downloading");
      setUpdateProgress({ downloaded: 0, total: 0 });

      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();

      if (!update) {
        setUpdateError("No update available");
        return;
      }

      let downloaded = 0;
      let total = 0;

      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            total = event.data.contentLength ?? 0;
            setUpdateProgress({ downloaded: 0, total });
            break;
          case "Progress":
            downloaded += event.data.chunkLength;
            setUpdateProgress({ downloaded, total });
            break;
          case "Finished":
            setUpdateProgress({ downloaded: total, total });
            break;
        }
      });

      setUpdateStatus("ready");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("Failed to download update:", error);
      setUpdateError(message);
    }
  }, [setUpdateStatus, setUpdateProgress, setUpdateError]);

  const installAndRelaunch = useCallback(async () => {
    if (!api.isTauri()) {
      return;
    }

    try {
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("Failed to relaunch:", error);
      setUpdateError(message);
    }
  }, [setUpdateError]);

  return {
    checkForUpdates,
    downloadAndInstall,
    installAndRelaunch,
  };
};
