import { useAppStore } from "../store/appStore";
import { api } from "../lib/api";
import { UpdateBadge } from "./UpdateBadge";

interface FooterProps {
  onOpenSettings?: () => void;
  onOpenUpdateModal?: () => void;
}

export const Footer = ({ onOpenSettings, onOpenUpdateModal }: FooterProps) => {
  const { progress } = useAppStore();

  const statusColor =
    progress.status === "running"
      ? "bg-system-orange"
      : progress.status === "error"
      ? "bg-system-red"
      : "bg-system-green";

  const statusText =
    progress.status === "running"
      ? "Creating..."
      : progress.status === "error"
      ? "Error"
      : "Ready";

  const platformLabel = api.isTauri() ? "Tauri 2.0" : "Web";

  return (
    <footer className="bg-mac-bg-secondary px-4 py-2 flex items-center justify-between text-mac-xs text-text-muted border-t border-border-muted">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full ${statusColor}`} />
          {statusText}
        </div>
        <span className="text-text-placeholder">v1.0.0</span>
        {onOpenSettings && !api.isTauri() && (
          <button
            onClick={onOpenSettings}
            className="text-text-muted hover:text-accent transition-colors"
          >
            Settings
          </button>
        )}
        {onOpenUpdateModal && api.isTauri() && (
          <UpdateBadge onClick={onOpenUpdateModal} />
        )}
      </div>
      <span className="text-text-placeholder">{platformLabel}</span>
    </footer>
  );
};
