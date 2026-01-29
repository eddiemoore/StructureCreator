import { useState, useCallback } from "react";
import { useAppStore } from "../store/appStore";
import { api } from "../lib/api";
import { FolderIcon, PlusIcon, XIcon, RefreshIcon } from "./Icons";
import { AddTeamLibraryModal } from "./AddTeamLibraryModal";
import { TeamTemplateList } from "./TeamTemplateList";
import type { TeamLibrary } from "../types/schema";

const ChevronRightIcon = ({ size = 24, className = "" }: { size?: number; className?: string }) => (
  <svg
    className={className}
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

const ChevronDownIcon = ({ size = 24, className = "" }: { size?: number; className?: string }) => (
  <svg
    className={className}
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

const RefreshIcon2 = ({ size = 24, className = "" }: { size?: number; className?: string }) => (
  <svg
    className={className}
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
    <path d="M21 3v5h-5" />
  </svg>
);

const TrashIcon = ({ size = 24, className = "" }: { size?: number; className?: string }) => (
  <svg
    className={className}
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);

interface TeamLibraryItemProps {
  library: TeamLibrary;
  isActive: boolean;
  isExpanded: boolean;
  onSelect: () => void;
  onToggleExpand: () => void;
  onRemove: () => void;
  onRefresh: () => void;
  templateCount: number;
  isScanning: boolean;
}

const TeamLibraryItem = ({
  library,
  isActive,
  isExpanded,
  onSelect,
  onToggleExpand,
  onRemove,
  onRefresh,
  templateCount,
  isScanning,
}: TeamLibraryItemProps) => {
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);

  const handleRemove = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (showConfirmDelete) {
      onRemove();
      setShowConfirmDelete(false);
    } else {
      setShowConfirmDelete(true);
    }
  };

  const handleRefresh = (e: React.MouseEvent) => {
    e.stopPropagation();
    onRefresh();
  };

  return (
    <div>
      <div
        onClick={onSelect}
        className={`flex items-center gap-2 p-2 rounded-mac cursor-pointer group transition-colors ${
          isActive
            ? "bg-accent/10 border border-accent"
            : "hover:bg-mac-bg-hover border border-transparent"
        }`}
      >
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleExpand();
          }}
          className="w-4 h-4 flex items-center justify-center text-text-muted"
        >
          {isExpanded ? (
            <ChevronDownIcon size={12} />
          ) : (
            <ChevronRightIcon size={12} />
          )}
        </button>
        <FolderIcon size={16} className="text-system-blue flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-mac-sm font-medium text-text-primary truncate">
            {library.name}
          </div>
          <div className="text-mac-xs text-text-muted truncate">
            {isScanning ? "Scanning..." : `${templateCount} templates`}
          </div>
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={handleRefresh}
            disabled={isScanning}
            className="w-5 h-5 flex items-center justify-center rounded text-text-muted hover:text-accent hover:bg-accent/10 transition-colors disabled:opacity-50"
            title="Refresh"
          >
            <RefreshIcon2 size={12} className={isScanning ? "animate-spin" : ""} />
          </button>
          {showConfirmDelete ? (
            <>
              <button
                onClick={handleRemove}
                className="px-1.5 py-0.5 text-[10px] font-medium bg-system-red text-white rounded hover:bg-system-red/90 transition-colors"
              >
                Remove
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowConfirmDelete(false);
                }}
                className="w-5 h-5 flex items-center justify-center rounded text-text-muted hover:text-text-primary transition-colors"
              >
                <XIcon size={12} />
              </button>
            </>
          ) : (
            <button
              onClick={handleRemove}
              className="w-5 h-5 flex items-center justify-center rounded text-text-muted hover:text-system-red hover:bg-system-red/10 transition-colors"
              title="Remove library"
            >
              <TrashIcon size={12} />
            </button>
          )}
        </div>
      </div>
      {isExpanded && isActive && <TeamTemplateList />}
    </div>
  );
};

export const TeamLibrariesSection = () => {
  const {
    teamLibraries,
    teamLibrariesLoading,
    activeTeamLibrary,
    teamTemplates,
    teamTemplatesLoading,
    setTeamLibraries,
    setTeamLibrariesLoading,
    setActiveTeamLibrary,
    setTeamTemplates,
    setTeamTemplatesLoading,
    addLog,
  } = useAppStore();

  const [isExpanded, setIsExpanded] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [expandedLibraries, setExpandedLibraries] = useState<Set<string>>(new Set());
  const [scanningLibraries, setScanningLibraries] = useState<Set<string>>(new Set());

  // Load team libraries
  const loadTeamLibraries = useCallback(async () => {
    setTeamLibrariesLoading(true);
    try {
      const libraries = await api.teamLibrary.listTeamLibraries();
      setTeamLibraries(libraries);
    } catch (e) {
      console.error("Failed to load team libraries:", e);
      addLog({
        type: "error",
        message: "Failed to load team libraries",
        details: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setTeamLibrariesLoading(false);
    }
  }, [setTeamLibraries, setTeamLibrariesLoading, addLog]);

  // Scan a library for templates
  const scanLibrary = useCallback(async (libraryId: string) => {
    setScanningLibraries((prev) => new Set(prev).add(libraryId));
    setTeamTemplatesLoading(true);
    try {
      const templates = await api.teamLibrary.scanTeamLibrary(libraryId);
      setTeamTemplates(templates);
      // Auto-expand the library when scanned
      setExpandedLibraries((prev) => new Set(prev).add(libraryId));
    } catch (e) {
      console.error("Failed to scan team library:", e);
      addLog({
        type: "error",
        message: "Failed to scan team library",
        details: e instanceof Error ? e.message : String(e),
      });
      setTeamTemplates([]);
    } finally {
      setScanningLibraries((prev) => {
        const next = new Set(prev);
        next.delete(libraryId);
        return next;
      });
      setTeamTemplatesLoading(false);
    }
  }, [setTeamTemplates, setTeamTemplatesLoading, addLog]);

  // Select a library
  const handleSelectLibrary = useCallback((libraryId: string) => {
    setActiveTeamLibrary(libraryId);
    // Scan if not already scanned
    scanLibrary(libraryId);
  }, [setActiveTeamLibrary, scanLibrary]);

  // Toggle library expansion
  const handleToggleExpand = useCallback((libraryId: string) => {
    setExpandedLibraries((prev) => {
      const next = new Set(prev);
      if (next.has(libraryId)) {
        next.delete(libraryId);
      } else {
        next.add(libraryId);
      }
      return next;
    });
  }, []);

  // Remove a library
  const handleRemoveLibrary = useCallback(async (libraryId: string) => {
    try {
      await api.teamLibrary.removeTeamLibrary(libraryId);
      // If this was the active library, clear it
      if (activeTeamLibrary === libraryId) {
        setActiveTeamLibrary(null);
        setTeamTemplates([]);
      }
      // Reload libraries
      await loadTeamLibraries();
      addLog({
        type: "success",
        message: "Team library removed",
      });
    } catch (e) {
      console.error("Failed to remove team library:", e);
      addLog({
        type: "error",
        message: "Failed to remove team library",
        details: e instanceof Error ? e.message : String(e),
      });
    }
  }, [activeTeamLibrary, setActiveTeamLibrary, setTeamTemplates, loadTeamLibraries, addLog]);

  // Add library callback
  const handleLibraryAdded = useCallback(async () => {
    await loadTeamLibraries();
    setShowAddModal(false);
  }, [loadTeamLibraries]);

  // Load libraries on first expand
  const handleToggleSection = useCallback(() => {
    const newExpanded = !isExpanded;
    setIsExpanded(newExpanded);
    if (newExpanded && teamLibraries.length === 0 && !teamLibrariesLoading) {
      loadTeamLibraries();
    }
  }, [isExpanded, teamLibraries.length, teamLibrariesLoading, loadTeamLibraries]);

  return (
    <div className="p-4 border-b border-border-muted">
      <div className="flex items-center justify-between mb-2">
        <button
          onClick={handleToggleSection}
          className="flex items-center gap-1.5 text-mac-xs font-medium text-text-muted hover:text-text-primary transition-colors"
        >
          {isExpanded ? (
            <ChevronDownIcon size={12} />
          ) : (
            <ChevronRightIcon size={12} />
          )}
          TEAM LIBRARIES
        </button>
        <button
          onClick={() => setShowAddModal(true)}
          className="w-5 h-5 flex items-center justify-center rounded text-text-muted hover:text-accent hover:bg-accent/10 transition-colors"
          title="Add team library"
        >
          <PlusIcon size={14} />
        </button>
      </div>

      {isExpanded && (
        <div className="space-y-1.5">
          {teamLibrariesLoading && teamLibraries.length === 0 ? (
            <div className="text-center text-text-muted text-mac-xs py-2">
              Loading...
            </div>
          ) : teamLibraries.length === 0 ? (
            <div className="text-center text-text-muted text-mac-xs py-3">
              <FolderIcon size={20} className="mx-auto mb-1 opacity-30" />
              <div>No team libraries</div>
              <button
                onClick={() => setShowAddModal(true)}
                className="text-accent hover:underline mt-1"
              >
                Add a shared folder
              </button>
            </div>
          ) : (
            teamLibraries.map((library) => (
              <TeamLibraryItem
                key={library.id}
                library={library}
                isActive={activeTeamLibrary === library.id}
                isExpanded={expandedLibraries.has(library.id)}
                onSelect={() => handleSelectLibrary(library.id)}
                onToggleExpand={() => handleToggleExpand(library.id)}
                onRemove={() => handleRemoveLibrary(library.id)}
                onRefresh={() => scanLibrary(library.id)}
                templateCount={
                  activeTeamLibrary === library.id ? teamTemplates.length : 0
                }
                isScanning={scanningLibraries.has(library.id)}
              />
            ))
          )}
        </div>
      )}

      <AddTeamLibraryModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onLibraryAdded={handleLibraryAdded}
      />
    </div>
  );
};
