/**
 * Tauri Plugin Adapter
 * Implements PluginAdapter interface for the Tauri desktop app.
 */

import { invoke } from "@tauri-apps/api/core";
import type { PluginAdapter } from "../types";
import type { Plugin, PluginManifest } from "../../../types/schema";

// Rust returns snake_case fields, this interface matches the Rust struct
interface RustPlugin {
  id: string;
  name: string;
  version: string;
  description: string | null;
  path: string;
  capabilities: string[];
  file_types: string[];
  user_settings: Record<string, unknown>;
  is_enabled: boolean;
  load_order: number;
  installed_at: string;
  updated_at: string;
}

/** Convert Rust snake_case Plugin to TypeScript camelCase */
function toPlugin(p: RustPlugin): Plugin {
  return {
    id: p.id,
    name: p.name,
    version: p.version,
    description: p.description,
    path: p.path,
    capabilities: p.capabilities as Plugin["capabilities"],
    fileTypes: p.file_types,
    userSettings: p.user_settings,
    isEnabled: p.is_enabled,
    loadOrder: p.load_order,
    installedAt: p.installed_at,
    updatedAt: p.updated_at,
  };
}

// Rust manifest format
interface RustPluginManifest {
  name: string;
  version: string;
  description: string | null;
  capabilities: string[];
  file_types: string[];
  main: string;
  author: string | null;
  license: string | null;
}

/** Convert Rust PluginManifest to TypeScript */
function toPluginManifest(m: RustPluginManifest): PluginManifest {
  return {
    name: m.name,
    version: m.version,
    description: m.description ?? undefined,
    capabilities: m.capabilities as PluginManifest["capabilities"],
    fileTypes: m.file_types,
    main: m.main,
    author: m.author ?? undefined,
    license: m.license ?? undefined,
  };
}

export class TauriPluginAdapter implements PluginAdapter {
  async listPlugins(): Promise<Plugin[]> {
    const plugins = await invoke<RustPlugin[]>("cmd_list_plugins");
    return plugins.map(toPlugin);
  }

  async getPlugin(id: string): Promise<Plugin | null> {
    const plugin = await invoke<RustPlugin | null>("cmd_get_plugin", { id });
    return plugin ? toPlugin(plugin) : null;
  }

  async installPlugin(sourcePath: string): Promise<Plugin> {
    const plugin = await invoke<RustPlugin>("cmd_install_plugin", { sourcePath });
    return toPlugin(plugin);
  }

  async uninstallPlugin(id: string): Promise<boolean> {
    return invoke<boolean>("cmd_uninstall_plugin", { id });
  }

  async enablePlugin(id: string): Promise<Plugin | null> {
    const plugin = await invoke<RustPlugin | null>("cmd_enable_plugin", { id });
    return plugin ? toPlugin(plugin) : null;
  }

  async disablePlugin(id: string): Promise<Plugin | null> {
    const plugin = await invoke<RustPlugin | null>("cmd_disable_plugin", { id });
    return plugin ? toPlugin(plugin) : null;
  }

  async getPluginSettings(id: string): Promise<Record<string, unknown> | null> {
    return invoke<Record<string, unknown> | null>("cmd_get_plugin_settings", { id });
  }

  async savePluginSettings(id: string, settings: Record<string, unknown>): Promise<Plugin | null> {
    const plugin = await invoke<RustPlugin | null>("cmd_save_plugin_settings", { id, settings });
    return plugin ? toPlugin(plugin) : null;
  }

  async scanPlugins(): Promise<PluginManifest[]> {
    const manifests = await invoke<RustPluginManifest[]>("cmd_scan_plugins");
    return manifests.map(toPluginManifest);
  }

  async syncPlugins(): Promise<Plugin[]> {
    const plugins = await invoke<RustPlugin[]>("cmd_sync_plugins");
    return plugins.map(toPlugin);
  }
}

export const createTauriPluginAdapter = (): PluginAdapter => {
  return new TauriPluginAdapter();
};
