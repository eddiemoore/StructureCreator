import type { StateCreator } from "zustand";
import type { Plugin } from "../../types/schema";

export interface PluginsSlice {
  plugins: Plugin[];
  pluginsLoading: boolean;
  setPlugins: (plugins: Plugin[]) => void;
  setPluginsLoading: (loading: boolean) => void;
  getEnabledPlugins: () => Plugin[];
}

export const createPluginsSlice: StateCreator<PluginsSlice, [], [], PluginsSlice> = (set, get) => ({
  plugins: [],
  pluginsLoading: false,

  setPlugins: (plugins) => set({ plugins }),

  setPluginsLoading: (pluginsLoading) => set({ pluginsLoading }),

  getEnabledPlugins: () => {
    const state = get();
    return state.plugins.filter((p) => p.isEnabled);
  },
});
