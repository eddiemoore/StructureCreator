import type { StateCreator } from "zustand";
import type { CreatedItem } from "../../types/schema";

export interface UndoSlice {
  lastCreation: CreatedItem[] | null;
  setLastCreation: (items: CreatedItem[] | null) => void;
  canUndoCreation: () => boolean;
}

export const createUndoSlice: StateCreator<UndoSlice, [], [], UndoSlice> = (set, get) => ({
  lastCreation: null,

  setLastCreation: (items) =>
    set({ lastCreation: items }),

  canUndoCreation: () => {
    const state = get();
    if (!state.lastCreation || state.lastCreation.length === 0) {
      return false;
    }
    // Check if there are any items that can be undone (not pre-existing)
    return state.lastCreation.some((item) => !item.pre_existed);
  },
});
