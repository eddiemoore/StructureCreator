import { useCallback, useState } from "react";
import { useAppStore } from "../store/appStore";
import { api } from "../lib/api";
import {
  XIcon,
  FolderIcon,
  TrashIcon,
  RefreshIcon,
  CheckIcon,
  AlertCircleIcon,
} from "./Icons";
import type { Plugin } from "../types/schema";

interface PluginManagerProps {
  isOpen: boolean;
  onClose: () => void;
}

export const PluginManager = ({ isOpen, onClose }: PluginManagerProps) => {
  const { plugins, setPlugins, setPluginsLoading, pluginsLoading } = useAppStore();
  const [installing, setInstalling] = useState(false);
  const [uninstalling, setUninstalling] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleInstallPlugin = async () => {
    try {
      setInstalling(true);
      setError(null);

      // Open folder picker to select plugin directory
      const selected = await api.fileSystem.openDirectoryPicker();
      if (!selected) {
        setInstalling(false);
        return;
      }

      // Install the plugin
      const plugin = await api.plugin.installPlugin(selected);

      // Update the plugins list
      setPlugins([...plugins, plugin]);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(`Failed to install plugin: ${message}`);
    } finally {
      setInstalling(false);
    }
  };

  const handleUninstallPlugin = async (plugin: Plugin) => {
    if (!confirm(`Are you sure you want to uninstall "${plugin.name}"? This cannot be undone.`)) {
      return;
    }

    try {
      setUninstalling(plugin.id);
      setError(null);

      await api.plugin.uninstallPlugin(plugin.id);

      // Update the plugins list
      setPlugins(plugins.filter((p) => p.id !== plugin.id));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(`Failed to uninstall plugin: ${message}`);
    } finally {
      setUninstalling(null);
    }
  };

  const handleTogglePlugin = async (plugin: Plugin) => {
    try {
      setError(null);

      const updated = plugin.isEnabled
        ? await api.plugin.disablePlugin(plugin.id)
        : await api.plugin.enablePlugin(plugin.id);

      if (updated) {
        setPlugins(plugins.map((p) => (p.id === plugin.id ? updated : p)));
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(`Failed to toggle plugin: ${message}`);
    }
  };

  const handleSyncPlugins = async () => {
    try {
      setPluginsLoading(true);
      setError(null);

      const syncedPlugins = await api.plugin.syncPlugins();
      setPlugins(syncedPlugins);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(`Failed to sync plugins: ${message}`);
    } finally {
      setPluginsLoading(false);
    }
  };

  // Handle escape key
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    },
    [onClose]
  );

  // Set up escape key listener
  useState(() => {
    if (isOpen) {
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }
  });

  if (!isOpen) return null;

  const enabledCount = plugins.filter((p) => p.isEnabled).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-card-bg rounded-mac-lg shadow-mac-xl w-[600px] max-h-[80vh] overflow-hidden border border-border-muted">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-muted">
          <div>
            <h2 className="text-mac-lg font-semibold text-text-primary">Plugins</h2>
            <p className="text-mac-xs text-text-muted mt-0.5">
              {plugins.length} installed, {enabledCount} enabled
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSyncPlugins}
              disabled={pluginsLoading}
              className="mac-button-secondary px-3 py-1.5"
              title="Sync plugins from disk"
            >
              <RefreshIcon
                size={14}
                className={pluginsLoading ? "animate-spin" : ""}
              />
            </button>
            <button
              onClick={onClose}
              className="w-7 h-7 flex items-center justify-center rounded-mac text-text-muted hover:bg-mac-bg-hover transition-colors"
            >
              <XIcon size={16} />
            </button>
          </div>
        </div>

        {/* Error message */}
        {error && (
          <div className="mx-5 mt-4 p-3 bg-red-500/10 border border-red-500/30 rounded-mac text-mac-sm text-red-400 flex items-start gap-2">
            <AlertCircleIcon size={16} className="flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Content */}
        <div className="p-5 space-y-4 overflow-y-auto max-h-[calc(80vh-180px)]">
          {plugins.length === 0 ? (
            <div className="text-center py-8 text-text-muted">
              <p className="text-mac-sm">No plugins installed</p>
              <p className="text-mac-xs mt-1">
                Click "Install Plugin" to add a plugin from a folder
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {plugins.map((plugin) => (
                <PluginCard
                  key={plugin.id}
                  plugin={plugin}
                  onToggle={handleTogglePlugin}
                  onUninstall={handleUninstallPlugin}
                  isUninstalling={uninstalling === plugin.id}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-border-muted flex justify-between items-center">
          <button
            onClick={handleInstallPlugin}
            disabled={installing}
            className="mac-button-secondary px-4 flex items-center gap-2"
          >
            <FolderIcon size={14} />
            {installing ? "Installing..." : "Install Plugin"}
          </button>
          <button onClick={onClose} className="mac-button-primary px-4">
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

interface PluginCardProps {
  plugin: Plugin;
  onToggle: (plugin: Plugin) => void;
  onUninstall: (plugin: Plugin) => void;
  isUninstalling: boolean;
}

const PluginCard = ({ plugin, onToggle, onUninstall, isUninstalling }: PluginCardProps) => {
  const capabilityLabels: Record<string, string> = {
    "file-processor": "File Processor",
    "variable-transformer": "Variable Transformer",
    "schema-validator": "Schema Validator",
    "post-create-hook": "Post-Create Hook",
  };

  return (
    <div
      className={`p-4 rounded-mac border ${
        plugin.isEnabled
          ? "bg-card-bg border-border-muted"
          : "bg-mac-bg-hover/50 border-border-muted/50"
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3
              className={`text-mac-sm font-medium truncate ${
                plugin.isEnabled ? "text-text-primary" : "text-text-muted"
              }`}
            >
              {plugin.name}
            </h3>
            <span className="text-mac-xs text-text-muted">v{plugin.version}</span>
          </div>

          {plugin.description && (
            <p className="text-mac-xs text-text-muted mt-1 line-clamp-2">
              {plugin.description}
            </p>
          )}

          <div className="flex flex-wrap gap-1.5 mt-2">
            {plugin.capabilities.map((cap) => (
              <span
                key={cap}
                className="px-2 py-0.5 text-mac-xs bg-accent/10 text-accent rounded-full"
              >
                {capabilityLabels[cap] || cap}
              </span>
            ))}
            {plugin.fileTypes.length > 0 && (
              <span className="px-2 py-0.5 text-mac-xs bg-text-muted/10 text-text-muted rounded-full">
                {plugin.fileTypes.join(", ")}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Toggle switch */}
          <button
            onClick={() => onToggle(plugin)}
            className={`relative w-11 h-6 rounded-full transition-colors ${
              plugin.isEnabled ? "bg-accent" : "bg-text-muted/30"
            }`}
            title={plugin.isEnabled ? "Disable plugin" : "Enable plugin"}
          >
            <span
              className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                plugin.isEnabled ? "left-6" : "left-1"
              }`}
            >
              {plugin.isEnabled && (
                <CheckIcon size={10} className="text-accent m-0.5" />
              )}
            </span>
          </button>

          {/* Uninstall button */}
          <button
            onClick={() => onUninstall(plugin)}
            disabled={isUninstalling}
            className="w-8 h-8 flex items-center justify-center rounded-mac text-text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors"
            title="Uninstall plugin"
          >
            <TrashIcon size={14} />
          </button>
        </div>
      </div>
    </div>
  );
};
