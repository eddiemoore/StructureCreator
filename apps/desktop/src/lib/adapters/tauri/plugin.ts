/**
 * Tauri Plugin Adapter
 * Implements PluginAdapter interface for the Tauri desktop app.
 */

import type { PluginAdapter } from "../types";
import type { Plugin, PluginManifest } from "../../../types/schema";

import { commands } from "../../generated/commands";

/** Throw on a Result-shaped error; return the data on ok. */
function _unwrap<T>(r: { status: "ok"; data: T } | { status: "error"; error: string }): T {
  if (r.status === "error") throw new Error(r.error);
  return r.data;
}


// Plugin types cross IPC in the wire shape directly (codegen, #116).

export class TauriPluginAdapter implements PluginAdapter {
  async listPlugins(): Promise<Plugin[]> {
    return _unwrap(await commands.cmdListPlugins()) as Plugin[];
  }

  async getPlugin(id: string): Promise<Plugin | null> {
    return _unwrap(await commands.cmdGetPlugin(id)) as Plugin | null;
  }

  async installPlugin(sourcePath: string): Promise<Plugin> {
    return _unwrap(await commands.cmdInstallPlugin(sourcePath)) as Plugin;
  }

  async uninstallPlugin(id: string): Promise<boolean> {
    return _unwrap(await commands.cmdUninstallPlugin(id)) as boolean;
  }

  async enablePlugin(id: string): Promise<Plugin | null> {
    return _unwrap(await commands.cmdEnablePlugin(id)) as Plugin | null;
  }

  async disablePlugin(id: string): Promise<Plugin | null> {
    return _unwrap(await commands.cmdDisablePlugin(id)) as Plugin | null;
  }

  async getPluginSettings(id: string): Promise<Record<string, unknown> | null> {
    return _unwrap(await commands.cmdGetPluginSettings(id)) as Record<string, unknown> | null;
  }

  async savePluginSettings(id: string, settings: Record<string, unknown>): Promise<Plugin | null> {
    return _unwrap(await commands.cmdSavePluginSettings(id, settings as never)) as Plugin | null;
  }

  async scanPlugins(): Promise<PluginManifest[]> {
    return _unwrap(await commands.cmdScanPlugins()) as PluginManifest[];
  }

  async syncPlugins(): Promise<Plugin[]> {
    return _unwrap(await commands.cmdSyncPlugins()) as Plugin[];
  }
}

export const createTauriPluginAdapter = (): PluginAdapter => {
  return new TauriPluginAdapter();
};
