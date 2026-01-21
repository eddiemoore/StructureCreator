export interface SchemaNode {
  id?: string; // Unique ID for tracking during editing
  type: "folder" | "file" | "if" | "else";
  name: string;
  url?: string;
  content?: string;
  children?: SchemaNode[];
  attributes?: Record<string, string>;
  condition_var?: string;
}

export interface SchemaTree {
  root: SchemaNode;
  stats: {
    folders: number;
    files: number;
    downloads: number;
  };
}

export interface Variable {
  name: string;
  value: string;
}

export interface Template {
  id: string;
  name: string;
  description: string | null;
  schema_xml: string;
  variables: Record<string, string>;
  icon_color: string | null;
  is_favorite: boolean;
  use_count: number;
  created_at: string;
  updated_at: string;
}

export type ThemeMode = "light" | "dark" | "system";

export type AccentColor = "blue" | "purple" | "green" | "orange" | "pink";

export interface Settings {
  defaultOutputPath: string | null;
  defaultProjectName: string;
  theme: ThemeMode;
  accentColor: AccentColor;
}

export const DEFAULT_SETTINGS: Settings = {
  defaultOutputPath: null,
  defaultProjectName: "my-project",
  theme: "system",
  accentColor: "blue",
};

export const ACCENT_COLORS: Record<AccentColor, string> = {
  blue: "#0a84ff",
  purple: "#bf5af2",
  green: "#30d158",
  orange: "#ff9f0a",
  pink: "#ff375f",
};

export interface LogEntry {
  id: string;
  type: "success" | "pending" | "error" | "info" | "warning";
  message: string;
  details?: string;
  timestamp: number;
}

export interface BackendLogEntry {
  log_type: string;
  message: string;
  details?: string;
}

export interface ResultSummary {
  folders_created: number;
  files_created: number;
  files_downloaded: number;
  errors: number;
  skipped: number;
}

export interface CreateResult {
  logs: BackendLogEntry[];
  summary: ResultSummary;
}

export interface CreationProgress {
  current: number;
  total: number;
  status: "idle" | "running" | "completed" | "error";
  logs: LogEntry[];
}

export interface AppState {
  // Schema
  schemaPath: string | null;
  schemaContent: string | null;
  schemaTree: SchemaTree | null;

  // Schema editing
  isEditMode: boolean;
  schemaDirty: boolean;
  schemaHistory: SchemaTree[];
  schemaHistoryIndex: number;

  // Output settings
  outputPath: string | null;
  projectName: string;

  // Variables
  variables: Variable[];

  // Templates
  templates: Template[];
  templatesLoading: boolean;

  // Settings
  settings: Settings;
  settingsLoading: boolean;

  // Progress
  progress: CreationProgress;

  // Options
  dryRun: boolean;
  overwrite: boolean;

  // Actions
  setSchemaPath: (path: string | null) => void;
  setSchemaContent: (content: string | null) => void;
  setSchemaTree: (tree: SchemaTree | null) => void;
  setOutputPath: (path: string | null) => void;
  setProjectName: (name: string) => void;
  setVariables: (variables: Variable[]) => void;
  updateVariable: (name: string, value: string) => void;
  addVariable: (name: string, value: string) => void;
  removeVariable: (name: string) => void;
  setTemplates: (templates: Template[]) => void;
  setTemplatesLoading: (loading: boolean) => void;
  setSettings: (settings: Settings) => void;
  setSettingsLoading: (loading: boolean) => void;
  updateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  setProgress: (progress: Partial<CreationProgress>) => void;
  addLog: (log: Omit<LogEntry, "id" | "timestamp">) => void;
  clearLogs: () => void;
  setDryRun: (dryRun: boolean) => void;
  setOverwrite: (overwrite: boolean) => void;
  reset: () => void;

  // Schema editing actions
  setEditMode: (enabled: boolean) => void;
  createNewSchema: () => void;
  updateSchemaNode: (nodeId: string, updates: Partial<SchemaNode>) => void;
  addSchemaNode: (parentId: string | null, node: Partial<SchemaNode>) => void;
  removeSchemaNode: (nodeId: string) => void;
  moveSchemaNode: (nodeId: string, targetParentId: string | null, index: number) => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
}
