import { create } from "zustand";
import {
  createSchemaSlice,
  createVariablesSlice,
  createTemplatesSlice,
  createProjectSlice,
  createProgressSlice,
  createSettingsSlice,
  createTeamSlice,
  createPluginsSlice,
  createWatchSlice,
  createWizardSlice,
  createUpdateSlice,
  createUndoSlice,
  initialProgressState,
  type SchemaSlice,
  type VariablesSlice,
  type TemplatesSlice,
  type ProjectSlice,
  type ProgressSlice,
  type SettingsSlice,
  type TeamSlice,
  type PluginsSlice,
  type WatchSlice,
  type WizardSlice,
  type UpdateSlice,
  type UndoSlice,
} from "./slices";

// Combined store type
export type AppState = SchemaSlice &
  VariablesSlice &
  TemplatesSlice &
  ProjectSlice &
  ProgressSlice &
  SettingsSlice &
  TeamSlice &
  PluginsSlice &
  WatchSlice &
  WizardSlice &
  UpdateSlice &
  UndoSlice & {
    reset: () => void;
  };

export const useAppStore = create<AppState>()((...args) => {
  const [set] = args;

  return {
    // Combine all slices
    ...createSchemaSlice(...args),
    ...createVariablesSlice(...args),
    ...createTemplatesSlice(...args),
    ...createProjectSlice(...args),
    ...createProgressSlice(...args),
    ...createSettingsSlice(...args),
    ...createTeamSlice(...args),
    ...createPluginsSlice(...args),
    ...createWatchSlice(...args),
    ...createWizardSlice(...args),
    ...createUpdateSlice(...args),
    ...createUndoSlice(...args),

    // Reset transient state but preserve user preferences like watchAutoCreate
    // (which is persisted to the database and loaded on startup)
    reset: () =>
      set({
        schemaPath: null,
        schemaContent: null,
        schemaTree: null,
        progress: initialProgressState,
        isEditMode: false,
        editorMode: "preview",
        schemaDirty: false,
        schemaHistory: [],
        schemaHistoryIndex: -1,
        xmlEditorContent: null,
        xmlParseError: null,
        diffResult: null,
        diffLoading: false,
        diffError: null,
        showDiffModal: false,
        watchEnabled: false,
        isWatching: false,
        lastCreation: null,
      }),
  };
});
