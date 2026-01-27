import { useState, useCallback } from "react";
import { useAppStore } from "../store/appStore";
import { api } from "../lib/api";
import {
  ChevronRightIcon,
  TrashIcon,
  FolderIcon,
  ClockIcon,
  UploadIcon,
} from "./Icons";
import type { RecentProject } from "../types/schema";

/** Format relative time (e.g., "2 days ago", "just now") */
function formatRelativeTime(isoDate: string): string {
  const date = new Date(isoDate);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffWeeks = Math.floor(diffDays / 7);
  const diffMonths = Math.floor(diffDays / 30);

  if (diffSecs < 60) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${diffWeeks}w ago`;
  return `${diffMonths}mo ago`;
}

export const RecentProjectsSection = () => {
  const {
    recentProjects,
    recentProjectsLoading,
    setRecentProjects,
    setSchemaPath,
    setSchemaContent,
    setSchemaTree,
    setOutputPath,
    setProjectName,
    setVariables,
    addLog,
  } = useAppStore();

  const [isCollapsed, setIsCollapsed] = useState(true);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isClearing, setIsClearing] = useState(false);

  const handleLoad = useCallback(async (project: RecentProject) => {
    try {
      // Parse the schema first (this can fail)
      const tree = await api.schema.parseSchema(project.schemaXml);

      // Only set state after successful parse
      setSchemaPath(`recent:${project.projectName}`);
      setSchemaContent(project.schemaXml);
      setSchemaTree(tree);
      setOutputPath(project.outputPath);
      setProjectName(project.projectName);

      // Always set variables (clears previous if project has none)
      const loadedVariables = Object.entries(project.variables).map(([name, value]) => ({
        name,
        value,
        validation: project.variableValidation?.[name],
      }));
      setVariables(loadedVariables);

      addLog({
        type: "info",
        message: `Loaded recent project: ${project.projectName}`,
      });
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      addLog({
        type: "error",
        message: `Failed to load project "${project.projectName}"`,
        details: errorMessage,
      });
    }
  }, [setSchemaPath, setSchemaContent, setSchemaTree, setOutputPath, setProjectName, setVariables, addLog]);

  const handleDelete = useCallback(async (e: React.MouseEvent, projectId: string, projectName: string) => {
    e.stopPropagation();
    setDeletingId(projectId);
    try {
      await api.database.deleteRecentProject(projectId);
      // Get latest state to avoid stale closure issues with rapid deletes
      const currentProjects = useAppStore.getState().recentProjects;
      setRecentProjects(currentProjects.filter(p => p.id !== projectId));
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      addLog({
        type: "error",
        message: `Failed to delete "${projectName}"`,
        details: errorMessage,
      });
    } finally {
      setDeletingId(null);
    }
  }, [setRecentProjects, addLog]);

  const handleClearAll = useCallback(async () => {
    setIsClearing(true);
    try {
      await api.database.clearRecentProjects();
      setRecentProjects([]);
      setShowClearConfirm(false);
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      addLog({
        type: "error",
        message: "Failed to clear recent projects",
        details: errorMessage,
      });
      setShowClearConfirm(false);
    } finally {
      setIsClearing(false);
    }
  }, [setRecentProjects, addLog]);

  // Don't render if no recent projects and not loading
  if (!recentProjectsLoading && recentProjects.length === 0) {
    return null;
  }

  return (
    <div className="p-4 border-b border-border-muted">
      {/* Header with collapse toggle */}
      <button
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="w-full flex items-center justify-between mb-2 group"
      >
        <div className="flex items-center gap-1.5">
          <ChevronRightIcon
            size={12}
            className={`text-text-muted transition-transform ${isCollapsed ? "" : "rotate-90"}`}
          />
          <span className="text-mac-xs font-medium text-text-muted">Recent Projects</span>
          {recentProjects.length > 0 && (
            <span className="px-1.5 py-0.5 text-[10px] font-medium bg-border-muted text-text-muted rounded-full">
              {recentProjects.length}
            </span>
          )}
        </div>
        {!isCollapsed && recentProjects.length > 0 && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowClearConfirm(true);
            }}
            className="text-mac-xs text-text-muted hover:text-system-red transition-colors opacity-0 group-hover:opacity-100"
          >
            Clear all
          </button>
        )}
      </button>

      {/* Clear confirmation */}
      {showClearConfirm && (
        <div className="mb-3 p-2 bg-system-red/5 border border-system-red/20 rounded-mac">
          <p className="text-mac-xs text-text-secondary mb-2">
            Clear all {recentProjects.length} recent project{recentProjects.length !== 1 ? "s" : ""}?
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setShowClearConfirm(false)}
              disabled={isClearing}
              className="flex-1 px-2 py-1 text-mac-xs text-text-secondary hover:bg-border-muted rounded transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleClearAll}
              disabled={isClearing}
              className="flex-1 px-2 py-1 text-mac-xs font-medium text-system-red hover:bg-system-red/10 rounded transition-colors disabled:opacity-50"
            >
              {isClearing ? "Clearing..." : "Clear All"}
            </button>
          </div>
        </div>
      )}

      {/* Projects list */}
      {!isCollapsed && (
        <div className="space-y-2">
          {recentProjectsLoading ? (
            <div className="text-center text-text-muted text-mac-xs py-2">
              Loading...
            </div>
          ) : (
            recentProjects.map((project) => (
              <div
                key={project.id}
                className={`p-2.5 bg-card-bg border border-border-muted rounded-mac group hover:border-border-default transition-colors relative ${
                  deletingId === project.id ? "opacity-50" : ""
                }`}
              >
                {/* Action buttons - absolutely positioned, right side of title row */}
                <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity bg-card-bg">
                  <button
                    onClick={() => handleLoad(project)}
                    disabled={deletingId === project.id}
                    className="w-6 h-6 flex items-center justify-center rounded text-text-muted hover:text-accent hover:bg-accent/10 transition-colors disabled:opacity-50"
                    title="Load project settings"
                  >
                    <UploadIcon size={12} />
                  </button>
                  <button
                    onClick={(e) => handleDelete(e, project.id, project.projectName)}
                    disabled={deletingId === project.id}
                    className="w-6 h-6 flex items-center justify-center rounded text-text-muted hover:text-system-red hover:bg-system-red/10 transition-colors disabled:opacity-50"
                    title="Delete from history"
                  >
                    <TrashIcon size={12} />
                  </button>
                </div>

                {/* Card content */}
                <div className="flex items-start gap-2">
                  <div className="w-7 h-7 bg-system-blue/10 rounded flex items-center justify-center flex-shrink-0">
                    <FolderIcon size={14} className="text-system-blue" />
                  </div>
                  <div className="flex-1 min-w-0">
                    {/* pr-16 to avoid overlap with 2 action buttons */}
                    <div className="text-mac-sm font-medium text-text-primary truncate pr-16">
                      {project.projectName}
                    </div>
                    <div className="text-mac-xs text-text-muted truncate" title={project.outputPath}>
                      {project.outputPath}
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-between mt-1.5 text-mac-xs text-text-muted">
                  <div className="flex items-center gap-2">
                    {project.templateName && (
                      <span className="px-1.5 py-0.5 bg-accent/10 text-accent rounded text-[10px]">
                        {project.templateName}
                      </span>
                    )}
                    <span>{project.foldersCreated} dirs, {project.filesCreated} files</span>
                  </div>
                  <span className="flex items-center gap-0.5">
                    <ClockIcon size={10} />
                    {formatRelativeTime(project.createdAt)}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};
