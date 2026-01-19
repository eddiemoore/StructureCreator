import { create } from "zustand";
import type { AppState, CreationProgress, LogEntry, Variable, SchemaTree } from "../types/schema";

const initialProgress: CreationProgress = {
  current: 0,
  total: 0,
  status: "idle",
  logs: [],
};

export const useAppStore = create<AppState>((set) => ({
  // Schema
  schemaPath: null,
  schemaContent: null,
  schemaTree: null,

  // Output settings
  outputPath: null,
  projectName: "my-project",

  // Variables
  variables: [
    { name: "%BASE%", value: "my-project" },
    { name: "%DATE%", value: new Date().toISOString().split("T")[0] },
  ],

  // Progress
  progress: initialProgress,

  // Options
  dryRun: false,
  overwrite: false,

  // Actions
  setSchemaPath: (path: string | null) => set({ schemaPath: path }),

  setSchemaContent: (content: string | null) => set({ schemaContent: content }),

  setSchemaTree: (tree: SchemaTree | null) => set({ schemaTree: tree }),

  setOutputPath: (path: string | null) => set({ outputPath: path }),

  setProjectName: (name: string) =>
    set((state) => ({
      projectName: name,
      variables: state.variables.map((v) =>
        v.name === "%BASE%" ? { ...v, value: name } : v
      ),
    })),

  setVariables: (variables: Variable[]) => set({ variables }),

  updateVariable: (name: string, value: string) =>
    set((state) => ({
      variables: state.variables.map((v) =>
        v.name === name ? { ...v, value } : v
      ),
    })),

  addVariable: (name: string, value: string) =>
    set((state) => {
      // Ensure name has % wrapping
      const varName = name.startsWith("%") ? name : `%${name}%`;
      // Check if variable already exists
      if (state.variables.some((v) => v.name === varName)) {
        return state;
      }
      return {
        variables: [...state.variables, { name: varName, value }],
      };
    }),

  removeVariable: (name: string) =>
    set((state) => ({
      variables: state.variables.filter((v) => v.name !== name),
    })),

  setProgress: (progress: Partial<CreationProgress>) =>
    set((state) => ({
      progress: { ...state.progress, ...progress },
    })),

  addLog: (log: Omit<LogEntry, "id" | "timestamp">) =>
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

  setDryRun: (dryRun: boolean) => set({ dryRun }),

  setOverwrite: (overwrite: boolean) => set({ overwrite }),

  reset: () =>
    set({
      schemaPath: null,
      schemaContent: null,
      schemaTree: null,
      progress: initialProgress,
    }),
}));
