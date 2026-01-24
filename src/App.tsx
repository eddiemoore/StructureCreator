import { useState, useEffect } from "react";
import { LeftPanel } from "./components/LeftPanel";
import { TreePreview } from "./components/TreePreview";
import { RightPanel } from "./components/RightPanel";
import { Footer } from "./components/Footer";
import { SettingsModal } from "./components/SettingsModal";
import { useAppStore } from "./store/appStore";
import { api } from "./lib/api";
import type { Settings, ThemeMode, AccentColor } from "./types/schema";
import { DEFAULT_SETTINGS, ACCENT_COLORS } from "./types/schema";

function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const { settings, setSettings, setOutputPath, setProjectName, createNewSchema } = useAppStore();

  // Initialize the API and load settings on mount
  useEffect(() => {
    const init = async () => {
      try {
        await api.initialize();
        setIsInitialized(true);
        await loadSettings();
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

      return () => {
        unlistenSettings();
        unlistenNewSchema();
      };
    };

    let cleanup: (() => void) | undefined;
    setupListeners().then((fn) => {
      cleanup = fn;
    });

    return () => {
      cleanup?.();
    };
  }, [createNewSchema]);

  // Apply theme and accent color when settings change
  useEffect(() => {
    applyTheme(settings.theme);
    applyAccentColor(settings.accentColor);
  }, [settings.theme, settings.accentColor]);

  const loadSettings = async () => {
    try {
      const savedSettings = await api.database.getAllSettings();

      const newSettings: Settings = {
        defaultOutputPath: savedSettings.defaultOutputPath || null,
        defaultProjectName: savedSettings.defaultProjectName || DEFAULT_SETTINGS.defaultProjectName,
        theme: (savedSettings.theme as ThemeMode) || DEFAULT_SETTINGS.theme,
        accentColor: (savedSettings.accentColor as AccentColor) || DEFAULT_SETTINGS.accentColor,
      };

      setSettings(newSettings);

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

  const applyTheme = (theme: ThemeMode) => {
    const root = document.documentElement;
    root.classList.remove("theme-light", "theme-dark");

    if (theme === "light") {
      root.classList.add("theme-light");
    } else if (theme === "dark") {
      root.classList.add("theme-dark");
    }
    // "system" = no class, uses media query
  };

  const applyAccentColor = (accentColor: AccentColor) => {
    const color = ACCENT_COLORS[accentColor];
    document.documentElement.style.setProperty("--color-accent", color);
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
    <div className="bg-mac-bg min-h-screen flex flex-col">
      <div className="flex-1 grid grid-cols-[280px_1fr_300px] border-t border-border-muted">
        <LeftPanel />
        <TreePreview />
        <RightPanel />
      </div>
      <Footer onOpenSettings={() => setSettingsOpen(true)} />
      <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}

export default App;
