import { create } from "zustand";
import type { AppState, CreationProgress, LogEntry, Variable, SchemaTree, Template, Settings } from "../types/schema";
import { DEFAULT_SETTINGS } from "../types/schema";

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
    { name: "%DATE%", value: new Date().toISOString().split("T")[0] },
  ],

  // Templates
  templates: [],
  templatesLoading: false,

  // Settings
  settings: DEFAULT_SETTINGS,
  settingsLoading: false,

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

  setProjectName: (name: string) => set({ projectName: name }),

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

  setTemplates: (templates: Template[]) => set({ templates }),

  setTemplatesLoading: (templatesLoading: boolean) => set({ templatesLoading }),

  setSettings: (settings: Settings) => set({ settings }),

  setSettingsLoading: (settingsLoading: boolean) => set({ settingsLoading }),

  updateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) =>
    set((state) => ({
      settings: { ...state.settings, [key]: value },
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
