import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { LeftPanel } from "./components/LeftPanel";
import { TreePreview } from "./components/TreePreview";
import { RightPanel } from "./components/RightPanel";
import { Footer } from "./components/Footer";
import { SettingsModal } from "./components/SettingsModal";
import { useAppStore } from "./store/appStore";
import type { Settings, ThemeMode, AccentColor } from "./types/schema";
import { DEFAULT_SETTINGS, ACCENT_COLORS } from "./types/schema";

function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { settings, setSettings, setOutputPath, setProjectName } = useAppStore();

  // Load settings on mount
  useEffect(() => {
    loadSettings();
  }, []);

  // Listen for menu event to open settings
  useEffect(() => {
    const unlisten = listen("open-settings", () => {
      setSettingsOpen(true);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Apply theme and accent color when settings change
  useEffect(() => {
    applyTheme(settings.theme);
    applyAccentColor(settings.accentColor);
  }, [settings.theme, settings.accentColor]);

  const loadSettings = async () => {
    try {
      const savedSettings = await invoke<Record<string, string>>("cmd_get_settings");

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

  return (
    <div className="bg-mac-bg min-h-screen flex flex-col">
      <div className="flex-1 grid grid-cols-[280px_1fr_300px] border-t border-border-muted">
        <LeftPanel />
        <TreePreview />
        <RightPanel />
      </div>
      <Footer />
      <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}

export default App;
