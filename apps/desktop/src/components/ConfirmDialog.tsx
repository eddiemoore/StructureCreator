import { useCallback, useEffect } from "react";
import { XIcon, AlertCircleIcon } from "./Icons";

interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  /** Additional details to show (e.g., list of items) */
  details?: string[];
  /** Warning text to show at the bottom */
  warning?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Whether the confirm action is dangerous (shows red button) */
  isDangerous?: boolean;
  /** Whether to disable the confirm button */
  confirmDisabled?: boolean;
  /** Whether an operation is in progress */
  isLoading?: boolean;
}

export const ConfirmDialog = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  details,
  warning,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  isDangerous = false,
  confirmDisabled = false,
  isLoading = false,
}: ConfirmDialogProps) => {
  const handleClose = useCallback(() => {
    if (!isLoading) {
      onClose();
    }
  }, [isLoading, onClose]);

  // Handle escape key
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isLoading) {
        handleClose();
      }
    },
    [handleClose, isLoading]
  );

  useEffect(() => {
    if (!isOpen) return;
    const controller = new AbortController();
    document.addEventListener("keydown", handleKeyDown, { signal: controller.signal });
    return () => controller.abort();
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={!isLoading ? handleClose : undefined}
      />

      {/* Modal */}
      <div className="relative bg-card-bg rounded-mac-lg shadow-mac-xl w-[420px] overflow-hidden border border-border-muted">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-muted">
          <div className="flex items-center gap-3">
            {isDangerous && (
              <div className="w-8 h-8 rounded-full bg-system-red/10 flex items-center justify-center">
                <AlertCircleIcon size={18} className="text-system-red" />
              </div>
            )}
            <h2 className="text-mac-lg font-semibold text-text-primary">
              {title}
            </h2>
          </div>
          {!isLoading && (
            <button
              onClick={handleClose}
              className="w-7 h-7 flex items-center justify-center rounded-mac text-text-muted hover:bg-mac-bg-hover transition-colors"
            >
              <XIcon size={16} />
            </button>
          )}
        </div>

        {/* Content */}
        <div className="p-5 space-y-4">
          <p className="text-text-secondary text-mac-sm">{message}</p>

          {details && details.length > 0 && (
            <div className="bg-mac-bg rounded-mac p-3 max-h-32 overflow-y-auto">
              <ul className="text-mac-xs text-text-primary space-y-1 font-mono">
                {details.map((item, idx) => (
                  <li key={idx} className="truncate">
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {warning && (
            <div className="flex items-start gap-2 p-3 bg-system-orange/5 border border-system-orange/20 rounded-mac">
              <AlertCircleIcon
                size={16}
                className="text-system-orange flex-shrink-0 mt-0.5"
              />
              <p className="text-mac-xs text-system-orange">{warning}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-border-muted flex justify-end gap-2">
          <button
            onClick={handleClose}
            className="mac-button-secondary px-4"
            disabled={isLoading}
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={`px-4 flex items-center gap-2 ${
              isDangerous ? "mac-button-danger" : "mac-button-primary"
            }`}
            disabled={confirmDisabled || isLoading}
          >
            {isLoading && (
              <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
            )}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
