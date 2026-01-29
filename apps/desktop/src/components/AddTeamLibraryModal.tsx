import { useState, useCallback, useRef } from "react";
import { useClickAwayEscape } from "../hooks";
import { api } from "../lib/api";
import { useAppStore } from "../store/appStore";
import { XIcon, FolderIcon } from "./Icons";

interface AddTeamLibraryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLibraryAdded: () => void;
}

export const AddTeamLibraryModal = ({
  isOpen,
  onClose,
  onLibraryAdded,
}: AddTeamLibraryModalProps) => {
  const { addLog } = useAppStore();
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const modalRef = useRef<HTMLDivElement>(null);

  // Close on click away or Escape
  useClickAwayEscape(modalRef, isOpen, onClose);

  const handleSelectFolder = useCallback(async () => {
    try {
      const selected = await api.fileSystem.openDirectoryPicker();
      if (selected) {
        setPath(selected);
        // Auto-fill name if empty
        if (!name) {
          const folderName = selected.split("/").pop() || selected.split("\\").pop() || "Library";
          setName(folderName);
        }
        setError(null);
      }
    } catch (e) {
      console.error("Failed to select folder:", e);
      setError(e instanceof Error ? e.message : "Failed to select folder");
    }
  }, [name]);

  const handleSubmit = useCallback(async () => {
    if (!name.trim() || !path.trim()) {
      setError("Please enter a name and select a folder");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await api.teamLibrary.addTeamLibrary(name.trim(), path.trim());
      addLog({
        type: "success",
        message: `Team library "${name.trim()}" added`,
      });
      // Reset form
      setName("");
      setPath("");
      onLibraryAdded();
    } catch (e) {
      console.error("Failed to add team library:", e);
      const errorMessage = e instanceof Error ? e.message : "Failed to add team library";
      setError(errorMessage);
      addLog({
        type: "error",
        message: "Failed to add team library",
        details: errorMessage,
      });
    } finally {
      setIsSubmitting(false);
    }
  }, [name, path, addLog, onLibraryAdded]);

  const handleClose = useCallback(() => {
    setName("");
    setPath("");
    setError(null);
    onClose();
  }, [onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div
        ref={modalRef}
        className="bg-mac-sidebar border border-border-default rounded-mac-lg shadow-xl w-full max-w-md mx-4"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border-muted">
          <h2 className="text-mac-base font-semibold text-text-primary">
            Add Team Library
          </h2>
          <button
            onClick={handleClose}
            className="w-6 h-6 flex items-center justify-center rounded-mac text-text-muted hover:text-text-primary hover:bg-border-muted transition-colors"
          >
            <XIcon size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          <p className="text-mac-sm text-text-secondary">
            Connect to a shared folder containing .sct template files. This can be a network share, Dropbox folder, OneDrive, or any synced directory.
          </p>

          {/* Name Input */}
          <div>
            <label className="block text-mac-xs font-medium text-text-secondary mb-1">
              Library Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
              placeholder="e.g., Company Templates"
              className="mac-input w-full text-mac-sm"
              autoFocus
            />
          </div>

          {/* Path Input */}
          <div>
            <label className="block text-mac-xs font-medium text-text-secondary mb-1">
              Folder Path
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={path}
                readOnly
                placeholder="Select a folder..."
                className="mac-input flex-1 font-mono text-mac-sm"
              />
              <button
                onClick={handleSelectFolder}
                className="mac-button-secondary px-3"
                title="Browse for folder"
              >
                <FolderIcon size={16} className="text-text-secondary" />
              </button>
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div className="p-2 bg-system-red/10 border border-system-red/20 rounded-mac">
              <p className="text-mac-xs text-system-red">{error}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 p-4 border-t border-border-muted">
          <button
            onClick={handleClose}
            className="px-4 py-2 text-mac-sm font-medium text-text-secondary hover:text-text-primary transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isSubmitting || !name.trim() || !path.trim()}
            className="mac-button-primary px-4 py-2 text-mac-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? "Adding..." : "Add Library"}
          </button>
        </div>
      </div>
    </div>
  );
};
