import { useCallback, useEffect } from "react";
import { useAppStore } from "../store/appStore";
import { useUpdater } from "../hooks";
import { XIcon, CheckCircleIcon, DownloadIcon, RefreshIcon } from "./Icons";

interface UpdateModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const UpdateModal = ({ isOpen, onClose }: UpdateModalProps) => {
  const { updateState, resetUpdateState } = useAppStore();
  const { downloadAndInstall, installAndRelaunch } = useUpdater();

  const handleClose = useCallback(() => {
    // Only reset if not in middle of download
    if (updateState.status !== "downloading") {
      resetUpdateState();
    }
    onClose();
  }, [updateState.status, resetUpdateState, onClose]);

  // Handle escape key
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape" && updateState.status !== "downloading") {
        handleClose();
      }
    },
    [handleClose, updateState.status]
  );

  useEffect(() => {
    if (isOpen) {
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  const { status, info, progress, error } = updateState;

  const progressPercent =
    progress && progress.total > 0
      ? Math.round((progress.downloaded / progress.total) * 100)
      : 0;

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={status !== "downloading" ? handleClose : undefined}
      />

      {/* Modal */}
      <div className="relative bg-card-bg rounded-mac-lg shadow-mac-xl w-[420px] overflow-hidden border border-border-muted">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-muted">
          <h2 className="text-mac-lg font-semibold text-text-primary">
            Software Update
          </h2>
          {status !== "downloading" && (
            <button
              onClick={handleClose}
              className="w-7 h-7 flex items-center justify-center rounded-mac text-text-muted hover:bg-mac-bg-hover transition-colors"
            >
              <XIcon size={16} />
            </button>
          )}
        </div>

        {/* Content */}
        <div className="p-5">
          {status === "checking" && (
            <div className="flex flex-col items-center py-8">
              <div className="w-10 h-10 border-2 border-accent border-t-transparent rounded-full animate-spin mb-4" />
              <p className="text-text-secondary text-mac-sm">
                Checking for updates...
              </p>
            </div>
          )}

          {status === "up-to-date" && (
            <div className="flex flex-col items-center py-8">
              <div className="w-12 h-12 rounded-full bg-system-green/10 flex items-center justify-center mb-4">
                <CheckCircleIcon size={28} className="text-system-green" />
              </div>
              <p className="text-text-primary text-mac-base font-medium mb-1">
                You're up to date!
              </p>
              <p className="text-text-muted text-mac-sm">
                Structure Creator {info?.currentVersion || "1.0.0"} is the latest
                version.
              </p>
            </div>
          )}

          {status === "available" && info && (
            <div className="space-y-4">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-mac bg-accent/10 flex items-center justify-center flex-shrink-0">
                  <DownloadIcon size={24} className="text-accent" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-text-primary text-mac-base font-medium">
                    Version {info.version} is available
                  </p>
                  <p className="text-text-muted text-mac-sm">
                    You have version {info.currentVersion}
                  </p>
                </div>
              </div>

              {info.body && (
                <div className="bg-mac-bg rounded-mac p-3 max-h-32 overflow-y-auto">
                  <p className="text-mac-xs font-medium text-text-secondary mb-1">
                    What's new:
                  </p>
                  <p className="text-mac-sm text-text-primary whitespace-pre-wrap">
                    {info.body}
                  </p>
                </div>
              )}
            </div>
          )}

          {status === "downloading" && progress && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 border-2 border-accent border-t-transparent rounded-full animate-spin flex-shrink-0" />
                <div className="flex-1">
                  <p className="text-text-primary text-mac-sm font-medium">
                    Downloading update...
                  </p>
                  <p className="text-text-muted text-mac-xs">
                    {formatBytes(progress.downloaded)} of{" "}
                    {formatBytes(progress.total)}
                  </p>
                </div>
              </div>

              <div className="w-full bg-border-muted rounded-full h-2 overflow-hidden">
                <div
                  className="h-full bg-accent transition-all duration-300"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>
          )}

          {status === "ready" && (
            <div className="flex flex-col items-center py-6">
              <div className="w-12 h-12 rounded-full bg-system-green/10 flex items-center justify-center mb-4">
                <CheckCircleIcon size={28} className="text-system-green" />
              </div>
              <p className="text-text-primary text-mac-base font-medium mb-1">
                Update downloaded
              </p>
              <p className="text-text-muted text-mac-sm text-center">
                Restart the app to apply the update.
              </p>
            </div>
          )}

          {status === "error" && (
            <div className="flex flex-col items-center py-6">
              <div className="w-12 h-12 rounded-full bg-system-red/10 flex items-center justify-center mb-4">
                <XIcon size={28} className="text-system-red" />
              </div>
              <p className="text-text-primary text-mac-base font-medium mb-1">
                Update failed
              </p>
              <p className="text-text-muted text-mac-sm text-center max-w-xs">
                {error || "An unknown error occurred"}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-border-muted flex justify-end gap-2">
          {status === "checking" && (
            <button onClick={handleClose} className="mac-button-secondary px-4">
              Cancel
            </button>
          )}

          {status === "up-to-date" && (
            <button onClick={handleClose} className="mac-button-primary px-4">
              OK
            </button>
          )}

          {status === "available" && (
            <>
              <button
                onClick={handleClose}
                className="mac-button-secondary px-4"
              >
                Later
              </button>
              <button
                onClick={downloadAndInstall}
                className="mac-button-primary px-4 flex items-center gap-2"
              >
                <DownloadIcon size={14} />
                Download & Install
              </button>
            </>
          )}

          {status === "downloading" && (
            <p className="text-text-muted text-mac-xs">
              Please wait while the update downloads...
            </p>
          )}

          {status === "ready" && (
            <>
              <button
                onClick={handleClose}
                className="mac-button-secondary px-4"
              >
                Later
              </button>
              <button
                onClick={installAndRelaunch}
                className="mac-button-primary px-4 flex items-center gap-2"
              >
                <RefreshIcon size={14} />
                Restart Now
              </button>
            </>
          )}

          {status === "error" && (
            <button onClick={handleClose} className="mac-button-primary px-4">
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
