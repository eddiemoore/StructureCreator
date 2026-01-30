import type { StateCreator } from "zustand";
import type { CreationProgress, LogEntry, DiffResult } from "../../types/schema";

const initialProgress: CreationProgress = {
  current: 0,
  total: 0,
  status: "idle",
  logs: [],
};

export interface ProgressSlice {
  progress: CreationProgress;
  dryRun: boolean;
  overwrite: boolean;
  diffResult: DiffResult | null;
  diffLoading: boolean;
  diffError: string | null;
  showDiffModal: boolean;
  setProgress: (progress: Partial<CreationProgress>) => void;
  addLog: (log: Omit<LogEntry, "id" | "timestamp">) => void;
  clearLogs: () => void;
  setDryRun: (dryRun: boolean) => void;
  setOverwrite: (overwrite: boolean) => void;
  setDiffResult: (result: DiffResult | null) => void;
  setDiffLoading: (loading: boolean) => void;
  setDiffError: (error: string | null) => void;
  setShowDiffModal: (show: boolean) => void;
}

export const initialProgressState = initialProgress;

export const createProgressSlice: StateCreator<ProgressSlice, [], [], ProgressSlice> = (set) => ({
  progress: initialProgress,
  dryRun: false,
  overwrite: false,
  diffResult: null,
  diffLoading: false,
  diffError: null,
  showDiffModal: false,

  setProgress: (progress) =>
    set((state) => ({
      progress: { ...state.progress, ...progress },
    })),

  addLog: (log) =>
    set((state) => ({
      progress: {
        ...state.progress,
        logs: [
          ...state.progress.logs,
          {
            ...log,
            id: crypto.randomUUID(),
            timestamp: Date.now(),
          },
        ],
      },
    })),

  clearLogs: () =>
    set((state) => ({
      progress: { ...state.progress, logs: [] },
    })),

  setDryRun: (dryRun) => set({ dryRun }),

  setOverwrite: (overwrite) => set({ overwrite }),

  setDiffResult: (diffResult) => set({ diffResult }),

  setDiffLoading: (diffLoading) => set({ diffLoading }),

  setDiffError: (diffError) => set({ diffError }),

  setShowDiffModal: (showDiffModal) => set({ showDiffModal }),
});
