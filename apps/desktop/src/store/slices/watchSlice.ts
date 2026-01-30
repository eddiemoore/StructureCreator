import type { StateCreator } from "zustand";

export interface WatchSlice {
  watchEnabled: boolean;
  watchAutoCreate: boolean;
  isWatching: boolean;
  setWatchEnabled: (enabled: boolean) => void;
  setWatchAutoCreate: (autoCreate: boolean) => void;
  setIsWatching: (watching: boolean) => void;
}

export const createWatchSlice: StateCreator<WatchSlice, [], [], WatchSlice> = (set) => ({
  watchEnabled: false,
  watchAutoCreate: true,
  isWatching: false,

  setWatchEnabled: (watchEnabled) => set({ watchEnabled }),
  setWatchAutoCreate: (watchAutoCreate) => set({ watchAutoCreate }),
  setIsWatching: (isWatching) => set({ isWatching }),
});
