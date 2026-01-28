import { useState, useEffect, useRef } from "react";
import { LeftPanel } from "./components/LeftPanel";
import { TreePreview } from "./components/TreePreview";
import { RightPanel } from "./components/RightPanel";
import { Footer } from "./components/Footer";
import { SettingsModal } from "./components/SettingsModal";
import { UpdateModal } from "./components/UpdateModal";
import { TemplateWizard } from "./components/wizard";
import { useAppStore } from "./store/appStore";
import { useKeyboardShortcuts, useUpdater } from "./hooks";
import { api } from "./lib/api";
import type { Settings, ThemeMode, AccentColor } from "./types/schema";
import { DEFAULT_SETTINGS } from "./types/schema";
import { applyTheme, applyAccentColor } from "./utils/theme";

function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [updateModalOpen, setUpdateModalOpen] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [importExportModalOpen, setImportExportModalOpen] = useState(false);
  const { setSettings, setOutputPath, setProjectName, createNewSchema, showDiffModal, schemaContent, setWatchAutoCreate, wizardState } = useAppStore();
  const { checkForUpdates } = useUpdater();

  // Ref for search input (passed to LeftPanel)
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Check if any modal is open (used to disable shortcuts)
  const isModalOpen = settingsOpen || updateModalOpen || showDiffModal || importExportModalOpen || !!wizardState?.isOpen;

  // Initialize keyboard shortcuts
  // Note: Escape key is handled by individual modals, not here
  useKeyboardShortcuts({
    searchInputRef,
    isModalOpen,
    hasSchema: !!schemaContent,
  });

  // Initialize the API and load settings on mount
  useEffect(() => {
    const init = async () => {
      try {
        await api.initialize();
        setIsInitialized(true);
        await loadSettings();

        // Handle URL parameters for web mode
        if (!api.isTauri()) {
          const params = new URLSearchParams(window.location.search);
          if (params.get("action") === "new") {
            createNewSchema();
            // Clean up the URL without reloading
            window.history.replaceState({}, "", window.location.pathname);
          }
        }
      } catch (e) {
        const errorMessage = e instanceof Error ? e.message : String(e);
        console.error("Failed to initialize app:", e);
        setInitError(errorMessage);
      }
    };
    init();
  }, []);

  // Listen for menu events (Tauri only)
  useEffect(() => {
    if (!api.isTauri()) {
      return;
    }

    // Dynamically import Tauri event API only when in Tauri mode
    const setupListeners = async () => {
      const { listen } = await import("@tauri-apps/api/event");

      const unlistenSettings = await listen("open-settings", () => {
        setSettingsOpen(true);
      });

      const unlistenNewSchema = await listen("new-schema", () => {
        createNewSchema();
      });

      const unlistenCheckUpdates = await listen("check-for-updates", () => {
        setUpdateModalOpen(true);
        checkForUpdates();
      });

      return () => {
        unlistenSettings();
        unlistenNewSchema();
        unlistenCheckUpdates();
      };
    };

    let cleanup: (() => void) | undefined;
    setupListeners().then((fn) => {
      cleanup = fn;
    });

    return () => {
      cleanup?.();
    };
  }, [createNewSchema, checkForUpdates]);

  // Auto-check for updates on startup (silent mode)
  // Uses a ref to avoid re-running when checkForUpdates changes
  const hasCheckedForUpdates = useRef(false);
  useEffect(() => {
    if (!api.isTauri() || !isInitialized || hasCheckedForUpdates.current) {
      return;
    }

    // Check for updates 3 seconds after startup (silent - badge will show if available)
    const timer = setTimeout(() => {
      hasCheckedForUpdates.current = true;
      checkForUpdates(true);
    }, 3000);

    return () => clearTimeout(timer);
  }, [isInitialized, checkForUpdates]);

  const loadSettings = async () => {
    try {
      const savedSettings = await api.database.getAllSettings();

      const newSettings: Settings = {
        defaultOutputPath: savedSettings.defaultOutputPath || null,
        defaultProjectName: savedSettings.defaultProjectName || DEFAULT_SETTINGS.defaultProjectName,
        theme: (savedSettings.theme as ThemeMode) || DEFAULT_SETTINGS.theme,
        accentColor: (savedSettings.accentColor as AccentColor) || DEFAULT_SETTINGS.accentColor,
        watchAutoCreate: savedSettings.watchAutoCreate === "true" || savedSettings.watchAutoCreate === undefined,
      };

      setSettings(newSettings);

      // Apply theme and accent color
      applyTheme(newSettings.theme);
      applyAccentColor(newSettings.accentColor);

      // Apply watch auto-create setting
      setWatchAutoCreate(newSettings.watchAutoCreate);

      // Apply defaults to current session
      if (newSettings.defaultOutputPath) {
        setOutputPath(newSettings.defaultOutputPath);
      }
      if (newSettings.defaultProjectName) {
        setProjectName(newSettings.defaultProjectName);
      }
    } catch (e) {
      console.error("Failed to load settings:", e);
    }
  };

  // Show loading state while initializing
  if (!isInitialized) {
    return (
      <div className="bg-mac-bg min-h-screen flex items-center justify-center">
        <div className="text-center">
          {initError ? (
            <>
              <div className="text-system-red text-lg font-semibold mb-2">
                Failed to initialize
              </div>
              <div className="text-text-muted text-sm max-w-md">
                {initError}
              </div>
            </>
          ) : (
            <>
              <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto mb-4" />
              <div className="text-text-muted text-sm">
                Initializing...
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-mac-bg min-h-screen flex flex-col overscroll-none">
      <div className="flex-1 grid grid-cols-[280px_1fr_300px] border-t border-border-muted pb-8">
        <LeftPanel
          searchInputRef={searchInputRef}
          onImportExportModalChange={setImportExportModalOpen}
        />
        <TreePreview />
        <RightPanel />
      </div>
      <Footer
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenUpdateModal={() => {
          setUpdateModalOpen(true);
          checkForUpdates();
        }}
      />
      <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <UpdateModal isOpen={updateModalOpen} onClose={() => setUpdateModalOpen(false)} />
      <TemplateWizard />
    </div>
  );
}

export default App;
