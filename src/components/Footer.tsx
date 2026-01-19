import { useAppStore } from "../store/appStore";

export const Footer = () => {
  const { progress } = useAppStore();

  const statusColor =
    progress.status === "running"
      ? "bg-amber-400"
      : progress.status === "error"
      ? "bg-red-400"
      : "bg-green-400";

  const statusText =
    progress.status === "running"
      ? "Creating..."
      : progress.status === "error"
      ? "Error"
      : "Ready";

  return (
    <footer className="col-span-full bg-bg-secondary px-6 py-2.5 flex items-center justify-between text-[11px] text-text-muted border-t border-border-default">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full ${statusColor}`} />
          {statusText}
        </div>
        <span>Tauri 2.0 • v1.0.0</span>
      </div>
      <span>Made with Rust + React</span>
    </footer>
  );
};
