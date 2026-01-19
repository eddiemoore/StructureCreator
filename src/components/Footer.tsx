import { useAppStore } from "../store/appStore";

export const Footer = () => {
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

  return (
    <footer className="bg-mac-bg-secondary px-4 py-2 flex items-center justify-between text-mac-xs text-text-muted border-t border-border-muted">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full ${statusColor}`} />
          {statusText}
        </div>
        <span className="text-text-placeholder">v1.0.0</span>
      </div>
      <span className="text-text-placeholder">Tauri 2.0</span>
    </footer>
  );
};
