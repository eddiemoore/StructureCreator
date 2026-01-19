import { useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../store/appStore";
import {
  CheckIcon,
  XIcon,
  FolderIcon,
  UploadIcon,
  LayersIcon,
  CodeIcon,
  PlusIcon,
} from "./Icons";
import type { SchemaTree } from "../types/schema";
import type { ReactNode } from "react";

type SchemaSourceType = "xml" | "folder";

const SectionTitle = ({ children }: { children: ReactNode }) => (
  <div className="text-mac-xs font-medium text-text-muted mb-2">{children}</div>
);

const FileIcon = ({ size = 24, className = "" }: { size?: number; className?: string }) => (
  <svg
    className={className}
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
    <polyline points="10 9 9 9 8 9" />
  </svg>
);

const DownloadIcon = ({ size = 24, className = "" }: { size?: number; className?: string }) => (
  <svg
    className={className}
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

export const LeftPanel = () => {
  const {
    schemaPath,
    schemaContent,
    schemaTree,
    outputPath,
    projectName,
    variables,
    setSchemaPath,
    setSchemaContent,
    setSchemaTree,
    setOutputPath,
    setProjectName,
    updateVariable,
    addVariable,
    removeVariable,
  } = useAppStore();

  const [sourceType, setSourceType] = useState<SchemaSourceType>("xml");
  const [isExporting, setIsExporting] = useState(false);
  const [isAddingVariable, setIsAddingVariable] = useState(false);
  const [newVarName, setNewVarName] = useState("");
  const [newVarValue, setNewVarValue] = useState("");

  const handleSelectSchema = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "XML", extensions: ["xml"] }],
      });

      if (selected) {
        const path = selected as string;
        setSchemaPath(path);
        const content = await readTextFile(path);
        setSchemaContent(content);

        try {
          const tree = await invoke<SchemaTree>("cmd_parse_schema", { content });
          setSchemaTree(tree);
        } catch (e) {
          console.error("Failed to parse schema:", e);
        }
      }
    } catch (e) {
      console.error("Failed to select schema:", e);
    }
  };

  const handleSelectFolder = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
      });

      if (selected) {
        const path = selected as string;
        setSchemaPath(path);
        setSchemaContent(null);

        try {
          const tree = await invoke<SchemaTree>("cmd_scan_folder", { folderPath: path });
          setSchemaTree(tree);
        } catch (e) {
          console.error("Failed to scan folder:", e);
        }
      }
    } catch (e) {
      console.error("Failed to select folder:", e);
    }
  };

  const handleExportSchema = async () => {
    if (!schemaTree) return;

    setIsExporting(true);
    try {
      const xml = await invoke<string>("cmd_export_schema_xml", { tree: schemaTree });

      const savePath = await save({
        filters: [{ name: "XML", extensions: ["xml"] }],
        defaultPath: `${schemaTree.root.name}-schema.xml`,
      });

      if (savePath) {
        await writeTextFile(savePath, xml);
        setSchemaContent(xml);
      }
    } catch (e) {
      console.error("Failed to export schema:", e);
    } finally {
      setIsExporting(false);
    }
  };

  const handleSelectOutput = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
      });

      if (selected) {
        setOutputPath(selected as string);
      }
    } catch (e) {
      console.error("Failed to select output folder:", e);
    }
  };

  const handleRemoveSchema = () => {
    setSchemaPath(null);
    setSchemaContent(null);
    setSchemaTree(null);
  };

  const handleSourceTypeChange = (type: SchemaSourceType) => {
    setSourceType(type);
    handleRemoveSchema();
  };

  const fileName = schemaPath?.split("/").pop() || "";
  const lineCount = schemaContent?.split("\n").length || 0;
  const isFolderSource = sourceType === "folder";

  return (
    <aside className="bg-mac-sidebar border-r border-border-muted flex flex-col overflow-hidden">
      {/* Schema Source Section */}
      <div className="p-4 border-b border-border-muted">
        <SectionTitle>Schema Source</SectionTitle>

        {/* Source Type Toggle - macOS Segmented Control */}
        <div className="mac-segment mb-3">
          <button
            onClick={() => handleSourceTypeChange("xml")}
            className={`mac-segment-button flex items-center justify-center gap-1.5 ${
              sourceType === "xml" ? "active" : ""
            }`}
          >
            <FileIcon size={14} />
            XML File
          </button>
          <button
            onClick={() => handleSourceTypeChange("folder")}
            className={`mac-segment-button flex items-center justify-center gap-1.5 ${
              sourceType === "folder" ? "active" : ""
            }`}
          >
            <FolderIcon size={14} />
            Folder
          </button>
        </div>

        {schemaPath ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2.5 p-3 bg-card-bg rounded-mac border border-border-default">
              <div className="w-8 h-8 bg-system-green/10 rounded-mac flex items-center justify-center text-system-green">
                {isFolderSource ? <FolderIcon size={16} /> : <CheckIcon size={16} />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-mono text-mac-sm font-medium text-text-primary truncate">
                  {fileName}
                </div>
                <div className="text-mac-xs text-text-muted">
                  {isFolderSource ? (
                    schemaTree ? (
                      `${schemaTree.stats.folders} folders, ${schemaTree.stats.files} files`
                    ) : (
                      "Scanning..."
                    )
                  ) : (
                    `${lineCount} lines`
                  )}
                </div>
              </div>
              <button
                onClick={handleRemoveSchema}
                className="w-6 h-6 flex items-center justify-center rounded-mac text-text-muted hover:bg-system-red/10 hover:text-system-red transition-colors"
              >
                <XIcon size={14} />
              </button>
            </div>

            {isFolderSource && schemaTree && (
              <button
                onClick={handleExportSchema}
                disabled={isExporting}
                className="w-full py-2 px-3 text-mac-sm font-medium rounded-mac border border-border-default bg-card-bg text-text-secondary hover:bg-mac-bg-hover transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                <DownloadIcon size={14} />
                {isExporting ? "Exporting..." : "Export as XML"}
              </button>
            )}
          </div>
        ) : (
          <button
            onClick={isFolderSource ? handleSelectFolder : handleSelectSchema}
            className="w-full border-2 border-dashed border-border-default rounded-mac-lg p-6 text-center hover:border-system-blue hover:bg-system-blue/5 transition-all cursor-pointer"
          >
            {isFolderSource ? (
              <>
                <FolderIcon size={28} className="mx-auto mb-2 text-system-blue opacity-60" />
                <div className="text-mac-base text-text-secondary mb-0.5">
                  Select a folder
                </div>
                <div className="text-mac-xs text-text-muted">
                  Use existing folder as template
                </div>
              </>
            ) : (
              <>
                <UploadIcon size={28} className="mx-auto mb-2 text-system-blue opacity-60" />
                <div className="text-mac-base text-text-secondary mb-0.5">
                  Select XML schema
                </div>
                <div className="text-mac-xs text-text-muted">
                  Click to browse
                </div>
              </>
            )}
          </button>
        )}
      </div>

      {/* Output Settings Section */}
      <div className="p-4 border-b border-border-muted">
        <SectionTitle>Output Settings</SectionTitle>
        <div className="space-y-3">
          <div>
            <label className="block text-mac-xs font-medium text-text-secondary mb-1">
              Output Folder
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={outputPath || ""}
                readOnly
                placeholder="Select folder..."
                className="mac-input flex-1 font-mono text-mac-sm"
              />
              <button
                onClick={handleSelectOutput}
                className="mac-button-secondary px-3"
              >
                <FolderIcon size={16} className="text-text-secondary" />
              </button>
            </div>
          </div>
          <div>
            <label className="block text-mac-xs font-medium text-text-secondary mb-1">
              Project Name
            </label>
            <input
              type="text"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="my-project"
              className="mac-input w-full font-mono text-mac-sm"
            />
          </div>
        </div>
      </div>

      {/* Variables Section */}
      <div className="p-4 border-b border-border-muted">
        <div className="flex items-center justify-between mb-2">
          <SectionTitle>Variables</SectionTitle>
          <button
            onClick={() => setIsAddingVariable(true)}
            className="w-5 h-5 flex items-center justify-center rounded text-text-muted hover:text-system-blue hover:bg-system-blue/10 transition-colors"
            title="Add variable"
          >
            <PlusIcon size={14} />
          </button>
        </div>
        <div className="space-y-1.5">
          {variables.map((variable) => (
            <div
              key={variable.name}
              className="flex items-center gap-2 p-2 bg-card-bg rounded-mac border border-border-muted group"
            >
              <span className="font-mono text-mac-xs font-medium text-system-orange bg-system-orange/10 px-1.5 py-0.5 rounded flex-shrink-0">
                {variable.name}
              </span>
              <span className="text-text-muted text-mac-xs">=</span>
              <input
                type="text"
                value={variable.value}
                onChange={(e) => updateVariable(variable.name, e.target.value)}
                className="flex-1 min-w-0 bg-transparent font-mono text-mac-xs text-text-primary outline-none border-b border-transparent focus:border-system-blue transition-colors"
                placeholder="Enter value..."
              />
              {variable.name !== "%BASE%" && variable.name !== "%DATE%" && (
                <button
                  onClick={() => removeVariable(variable.name)}
                  className="w-5 h-5 flex items-center justify-center rounded text-text-muted opacity-0 group-hover:opacity-100 hover:text-system-red hover:bg-system-red/10 transition-all"
                  title="Remove variable"
                >
                  <XIcon size={12} />
                </button>
              )}
            </div>
          ))}

          {/* Add Variable Form */}
          {isAddingVariable && (
            <div className="p-2 bg-card-bg rounded-mac border border-system-blue">
              <div className="flex items-center gap-2 mb-2">
                <input
                  type="text"
                  value={newVarName}
                  onChange={(e) => setNewVarName(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ""))}
                  placeholder="VARIABLE_NAME"
                  className="flex-1 bg-transparent font-mono text-mac-xs text-text-primary outline-none border-b border-border-default focus:border-system-blue"
                  autoFocus
                />
              </div>
              <div className="flex items-center gap-2 mb-2">
                <input
                  type="text"
                  value={newVarValue}
                  onChange={(e) => setNewVarValue(e.target.value)}
                  placeholder="Value"
                  className="flex-1 bg-transparent font-mono text-mac-xs text-text-primary outline-none border-b border-border-default focus:border-system-blue"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => {
                    setIsAddingVariable(false);
                    setNewVarName("");
                    setNewVarValue("");
                  }}
                  className="px-2 py-1 text-mac-xs text-text-secondary hover:text-text-primary transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    if (newVarName.trim()) {
                      addVariable(newVarName, newVarValue);
                      setIsAddingVariable(false);
                      setNewVarName("");
                      setNewVarValue("");
                    }
                  }}
                  disabled={!newVarName.trim()}
                  className="px-2 py-1 text-mac-xs font-medium text-system-blue hover:bg-system-blue/10 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Add
                </button>
              </div>
            </div>
          )}
        </div>
        <p className="mt-2 text-mac-xs text-text-muted">
          Use %VARIABLE% in file names or content
        </p>
      </div>

      {/* Templates Section */}
      <div className="p-4 flex-1 overflow-auto mac-scroll">
        <SectionTitle>Templates</SectionTitle>
        <div className="space-y-2">
          <div className="mac-sidebar-item p-3 bg-card-bg border border-border-muted rounded-mac">
            <div className="w-8 h-8 bg-system-blue/10 rounded-mac flex items-center justify-center text-system-blue">
              <LayersIcon size={16} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-mac-sm font-medium text-text-primary">Flash Project</div>
              <div className="text-mac-xs text-text-muted">ActionScript setup</div>
            </div>
          </div>
          <div className="mac-sidebar-item p-3 bg-card-bg border border-border-muted rounded-mac">
            <div className="w-8 h-8 bg-system-green/10 rounded-mac flex items-center justify-center text-system-green">
              <CodeIcon size={16} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-mac-sm font-medium text-text-primary">React App</div>
              <div className="text-mac-xs text-text-muted">Modern React setup</div>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
};
