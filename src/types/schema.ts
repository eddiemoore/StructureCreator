export interface SchemaNode {
  type: "folder" | "file";
  name: string;
  url?: string;
  content?: string;
  children?: SchemaNode[];
  attributes?: Record<string, string>;
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
  description: string;
  schema: string;
  icon?: string;
}

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

  // Output settings
  outputPath: string | null;
  projectName: string;

  // Variables
  variables: Variable[];

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
  setProgress: (progress: Partial<CreationProgress>) => void;
  addLog: (log: Omit<LogEntry, "id" | "timestamp">) => void;
  clearLogs: () => void;
  setDryRun: (dryRun: boolean) => void;
  setOverwrite: (overwrite: boolean) => void;
  reset: () => void;
}
