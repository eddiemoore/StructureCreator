import { useAppStore } from "../store/appStore";
import { ArrowUpCircleIcon } from "./Icons";

interface UpdateBadgeProps {
  onClick: () => void;
}

export const UpdateBadge = ({ onClick }: UpdateBadgeProps) => {
  const { updateState } = useAppStore();

  // Only show when update is available or ready
  if (updateState.status !== "available" && updateState.status !== "ready") {
    return null;
  }

  const isReady = updateState.status === "ready";

  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 px-2 py-0.5 rounded-mac bg-accent/10 text-accent hover:bg-accent/20 transition-colors"
      title={isReady ? "Restart to apply update" : "Update available"}
    >
      <ArrowUpCircleIcon size={14} />
      <span className="text-mac-xs font-medium">
        {isReady ? "Restart to update" : `v${updateState.info?.version}`}
      </span>
    </button>
  );
};
