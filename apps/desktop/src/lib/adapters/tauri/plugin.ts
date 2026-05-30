/**
 * Tauri Plugin Adapter
 * Implements PluginAdapter interface for the Tauri desktop app.
 */

import { invoke } from "@tauri-apps/api/core";
import type { PluginAdapter } from "../types";
import type { Plugin, PluginManifest } from "../../../types/schema";

// Plugin types cross IPC in the wire shape directly (codegen, #116).

export class TauriPluginAdapter implements PluginAdapter {
  async listPlugins(): Promise<Plugin[]> {
    return invoke<Plugin[]>("cmd_list_plugins");
  }

  async getPlugin(id: string): Promise<Plugin | null> {
    return invoke<Plugin | null>("cmd_get_plugin", { id });
  }

  async installPlugin(sourcePath: string): Promise<Plugin> {
    return invoke<Plugin>("cmd_install_plugin", { sourcePath });
  }

  async uninstallPlugin(id: string): Promise<boolean> {
    return invoke<boolean>("cmd_uninstall_plugin", { id });
  }

  async enablePlugin(id: string): Promise<Plugin | null> {
    return invoke<Plugin | null>("cmd_enable_plugin", { id });
  }

  async disablePlugin(id: string): Promise<Plugin | null> {
    return invoke<Plugin | null>("cmd_disable_plugin", { id });
  }

  async getPluginSettings(id: string): Promise<Record<string, unknown> | null> {
    return invoke<Record<string, unknown> | null>("cmd_get_plugin_settings", { id });
  }

  async savePluginSettings(id: string, settings: Record<string, unknown>): Promise<Plugin | null> {
    return invoke<Plugin | null>("cmd_save_plugin_settings", { id, settings });
  }

  async scanPlugins(): Promise<PluginManifest[]> {
    return invoke<PluginManifest[]>("cmd_scan_plugins");
  }

  async syncPlugins(): Promise<Plugin[]> {
    return invoke<Plugin[]>("cmd_sync_plugins");
  }
}

export const createTauriPluginAdapter = (): PluginAdapter => {
  return new TauriPluginAdapter();
};
