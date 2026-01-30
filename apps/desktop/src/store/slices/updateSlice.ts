import type { StateCreator } from "zustand";
import type { UpdateState, UpdateStatus, UpdateInfo, UpdateProgress } from "../../types/schema";

const initialUpdateState: UpdateState = {
  status: "idle",
  info: null,
  progress: null,
  error: null,
};

export interface UpdateSlice {
  updateState: UpdateState;
  setUpdateStatus: (status: UpdateStatus) => void;
  setUpdateInfo: (info: UpdateInfo | null) => void;
  setUpdateProgress: (progress: UpdateProgress | null) => void;
  setUpdateError: (error: string | null) => void;
  resetUpdateState: () => void;
}

export const createUpdateSlice: StateCreator<UpdateSlice, [], [], UpdateSlice> = (set) => ({
  updateState: initialUpdateState,

  setUpdateStatus: (status) =>
    set((state) => ({
      updateState: { ...state.updateState, status },
    })),

  setUpdateInfo: (info) =>
    set((state) => ({
      updateState: { ...state.updateState, info },
    })),

  setUpdateProgress: (progress) =>
    set((state) => ({
      updateState: { ...state.updateState, progress },
    })),

  setUpdateError: (error) =>
    set((state) => ({
      updateState: { ...state.updateState, error, status: error ? "error" : state.updateState.status },
    })),

  resetUpdateState: () =>
    set({ updateState: initialUpdateState }),
});
