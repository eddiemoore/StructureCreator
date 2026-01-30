import type { StateCreator } from "zustand";
import type { Settings } from "../../types/schema";
import { DEFAULT_SETTINGS } from "../../types/schema";

export interface SettingsSlice {
  settings: Settings;
  settingsLoading: boolean;
  setSettings: (settings: Settings) => void;
  setSettingsLoading: (loading: boolean) => void;
  updateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
}

export const createSettingsSlice: StateCreator<SettingsSlice, [], [], SettingsSlice> = (set) => ({
  settings: DEFAULT_SETTINGS,
  settingsLoading: false,

  setSettings: (settings) => set({ settings }),

  setSettingsLoading: (settingsLoading) => set({ settingsLoading }),

  updateSetting: (key, value) =>
    set((state) => ({
      settings: { ...state.settings, [key]: value },
    })),
});
