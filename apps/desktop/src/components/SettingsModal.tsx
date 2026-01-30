import { useEffect, useCallback, useState } from "react";
import { useAppStore } from "../store/appStore";
import { api } from "../lib/api";
import { XIcon, FolderIcon, BoltIcon } from "./Icons";
import type { ThemeMode, AccentColor, Settings } from "../types/schema";
import { ACCENT_COLORS, DEFAULT_SETTINGS } from "../types/schema";
import { applyTheme, applyAccentColor } from "../utils/theme";
import { PluginManager } from "./PluginManager";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const THEME_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const ACCENT_OPTIONS: { value: AccentColor; label: string }[] = [
  { value: "blue", label: "Blue" },
  { value: "purple", label: "Purple" },
  { value: "green", label: "Green" },
  { value: "orange", label: "Orange" },
  { value: "pink", label: "Pink" },
];

export const SettingsModal = ({ isOpen, onClose }: SettingsModalProps) => {
  const { settings, updateSetting, plugins } = useAppStore();
  const [showPluginManager, setShowPluginManager] = useState(false);

  const enabledPluginCount = plugins.filter((p) => p.isEnabled).length;

  const saveSetting = async (key: keyof Settings, value: string | null) => {
    try {
      await api.database.setSetting(key, value === null ? "" : value);
      updateSetting(key, value as Settings[typeof key]);

      // Apply theme/accent immediately when changed
      if (key === "theme") {
        applyTheme(value as ThemeMode);
      } else if (key === "accentColor") {
        applyAccentColor(value as AccentColor);
      }
    } catch (e) {
      console.error("Failed to save setting:", e);
    }
  };

  const handleSelectOutputPath = async () => {
    try {
      const selected = await api.fileSystem.openDirectoryPicker();

      if (selected) {
        saveSetting("defaultOutputPath", selected);
      }
    } catch (e) {
      console.error("Failed to select folder:", e);
    }
  };

  const handleClearOutputPath = () => {
    saveSetting("defaultOutputPath", null);
  };

  // Handle escape key
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") {
      onClose();
    }
  }, [onClose]);

  useEffect(() => {
    if (isOpen) {
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-card-bg rounded-mac-lg shadow-mac-xl w-[480px] max-h-[80vh] overflow-hidden border border-border-muted">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-muted">
          <h2 className="text-mac-lg font-semibold text-text-primary">Settings</h2>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-mac text-text-muted hover:bg-mac-bg-hover transition-colors"
          >
            <XIcon size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-6 overflow-y-auto max-h-[calc(80vh-120px)]">
          {/* Defaults Section */}
          <section>
            <h3 className="text-mac-sm font-medium text-text-primary mb-3">Defaults</h3>

            {/* Default Output Path */}
            <div className="mb-4">
              <label className="block text-mac-xs font-medium text-text-secondary mb-1.5">
                Default Output Path
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={settings.defaultOutputPath || ""}
                  readOnly
                  placeholder="Not set"
                  className="mac-input flex-1 font-mono text-mac-sm"
                />
                <button
                  onClick={handleSelectOutputPath}
                  className="mac-button-secondary px-3"
                  title="Browse"
                >
                  <FolderIcon size={16} className="text-text-secondary" />
                </button>
                {settings.defaultOutputPath && (
                  <button
                    onClick={handleClearOutputPath}
                    className="mac-button-secondary px-3"
                    title="Clear"
                  >
                    <XIcon size={14} className="text-text-secondary" />
                  </button>
                )}
              </div>
              <p className="mt-1 text-mac-xs text-text-muted">
                Pre-fill the output folder when creating structures
              </p>
            </div>

            {/* Default Project Name */}
            <div>
              <label className="block text-mac-xs font-medium text-text-secondary mb-1.5">
                Default Project Name
              </label>
              <input
                type="text"
                value={settings.defaultProjectName}
                onChange={(e) => saveSetting("defaultProjectName", e.target.value || DEFAULT_SETTINGS.defaultProjectName)}
                placeholder="my-project"
                className="mac-input w-full font-mono text-mac-sm"
              />
              <p className="mt-1 text-mac-xs text-text-muted">
                Default name for new projects
              </p>
            </div>
          </section>

          {/* Appearance Section */}
          <section>
            <h3 className="text-mac-sm font-medium text-text-primary mb-3">Appearance</h3>

            {/* Theme */}
            <div className="mb-4">
              <label className="block text-mac-xs font-medium text-text-secondary mb-1.5">
                Theme
              </label>
              <div className="mac-segment">
                {THEME_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => saveSetting("theme", option.value)}
                    className={`mac-segment-button ${settings.theme === option.value ? "active" : ""}`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Accent Color */}
            <div>
              <label className="block text-mac-xs font-medium text-text-secondary mb-1.5">
                Accent Color
              </label>
              <div className="flex gap-2">
                {ACCENT_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => saveSetting("accentColor", option.value)}
                    className={`w-8 h-8 rounded-full transition-transform ${
                      settings.accentColor === option.value
                        ? "ring-2 ring-offset-2 ring-offset-card-bg scale-110"
                        : "hover:scale-105"
                    }`}
                    style={{
                      backgroundColor: ACCENT_COLORS[option.value],
                      // @ts-expect-error Tailwind CSS variable for ring color
                      "--tw-ring-color": ACCENT_COLORS[option.value],
                    }}
                    title={option.label}
                  />
                ))}
              </div>
            </div>
          </section>

          {/* Plugins Section */}
          <section>
            <h3 className="text-mac-sm font-medium text-text-primary mb-3">Plugins</h3>

            <div className="flex items-center justify-between">
              <div>
                <p className="text-mac-xs text-text-secondary">
                  Extend Structure Creator with custom plugins
                </p>
                <p className="text-mac-xs text-text-muted mt-0.5">
                  {plugins.length} installed, {enabledPluginCount} enabled
                </p>
              </div>
              <button
                onClick={() => setShowPluginManager(true)}
                className="mac-button-secondary px-4 flex items-center gap-2"
              >
                <BoltIcon size={14} />
                Manage Plugins
              </button>
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-border-muted flex justify-end">
          <button
            onClick={onClose}
            className="mac-button-primary px-4"
          >
            Done
          </button>
        </div>
      </div>

      {/* Plugin Manager Modal */}
      <PluginManager
        isOpen={showPluginManager}
        onClose={() => setShowPluginManager(false)}
      />
    </div>
  );
};
