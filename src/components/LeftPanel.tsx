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
} from "./Icons";
import type { SchemaTree } from "../types/schema";
import type { ReactNode } from "react";

type SchemaSourceType = "xml" | "folder";

const SectionTitle = ({ children }: { children: ReactNode }) => (
  <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-3">
    {children}
    <div className="flex-1 h-px bg-border-muted" />
  </div>
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
  } = useAppStore();

  const [sourceType, setSourceType] = useState<SchemaSourceType>("xml");
  const [isExporting, setIsExporting] = useState(false);

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

        // Parse schema via Tauri command
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
        setSchemaContent(null); // No XML content for folder source

        // Scan folder via Tauri command
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
        // Also update the content in state
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
    // Clear current schema when switching types
    handleRemoveSchema();
  };

  const fileName = schemaPath?.split("/").pop() || "";
  const lineCount = schemaContent?.split("\n").length || 0;
  const isFolderSource = sourceType === "folder";

  return (
    <aside className="bg-bg-primary flex flex-col overflow-hidden">
      {/* Schema Source Section */}
      <div className="p-4 border-b border-border-muted">
        <SectionTitle>Schema Source</SectionTitle>

        {/* Source Type Toggle */}
        <div className="flex gap-1 p-1 bg-bg-deep rounded-lg mb-3">
          <button
            onClick={() => handleSourceTypeChange("xml")}
            className={`flex-1 py-2 px-3 text-[11px] font-medium rounded-md transition-all flex items-center justify-center gap-1.5 ${
              sourceType === "xml"
                ? "bg-cyan-primary/15 text-cyan-primary border border-cyan-muted/50"
                : "text-text-muted hover:text-text-secondary"
            }`}
          >
            <FileIcon size={14} />
            XML File
          </button>
          <button
            onClick={() => handleSourceTypeChange("folder")}
            className={`flex-1 py-2 px-3 text-[11px] font-medium rounded-md transition-all flex items-center justify-center gap-1.5 ${
              sourceType === "folder"
                ? "bg-cyan-primary/15 text-cyan-primary border border-cyan-muted/50"
                : "text-text-muted hover:text-text-secondary"
            }`}
          >
            <FolderIcon size={14} />
            Folder
          </button>
        </div>

        {schemaPath ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2.5 p-3 bg-bg-secondary rounded-lg border border-green-900/50">
              <div className="w-8 h-8 bg-green-900/30 rounded-md flex items-center justify-center text-green-400">
                {isFolderSource ? <FolderIcon size={16} /> : <CheckIcon size={16} />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-mono text-xs font-medium truncate">
                  {fileName}
                </div>
                <div className="text-[11px] text-text-muted">
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
                className="w-6 h-6 flex items-center justify-center rounded text-text-muted hover:bg-red-900/30 hover:text-red-400 transition-colors"
              >
                <XIcon size={14} />
              </button>
            </div>

            {/* Export to XML button for folder sources */}
            {isFolderSource && schemaTree && (
              <button
                onClick={handleExportSchema}
                disabled={isExporting}
                className="w-full py-2 px-3 text-[11px] font-medium rounded-md border border-border-default bg-bg-secondary text-text-secondary hover:border-cyan-muted hover:text-cyan-primary transition-all flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                <DownloadIcon size={14} />
                {isExporting ? "Exporting..." : "Export as XML Schema"}
              </button>
            )}
          </div>
        ) : (
          <button
            onClick={isFolderSource ? handleSelectFolder : handleSelectSchema}
            className="w-full border-2 border-dashed border-border-default rounded-lg p-6 text-center hover:border-cyan-muted hover:bg-cyan-primary/5 transition-all cursor-pointer"
          >
            {isFolderSource ? (
              <>
                <FolderIcon size={32} className="mx-auto mb-3 text-cyan-primary opacity-60" />
                <div className="text-sm text-text-secondary mb-1">
                  Select a folder to use as template
                </div>
                <div className="text-[11px] text-text-muted">
                  Folder structure will be scanned
                </div>
              </>
            ) : (
              <>
                <UploadIcon size={32} className="mx-auto mb-3 text-cyan-primary opacity-60" />
                <div className="text-sm text-text-secondary mb-1">
                  Drop schema file or click to browse
                </div>
                <div className="text-[11px] text-text-muted">
                  Supports .xml files
                </div>
              </>
            )}
          </button>
        )}
      </div>

      {/* Output Settings Section */}
      <div className="p-4 border-b border-border-muted">
        <SectionTitle>Output Settings</SectionTitle>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">
              Output Folder
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={outputPath || ""}
                readOnly
                placeholder="Select output folder..."
                className="flex-1 px-3 py-2.5 font-mono text-sm bg-bg-secondary border border-border-default rounded-md focus:outline-none focus:border-cyan-muted focus:ring-2 focus:ring-cyan-primary/15"
              />
              <button
                onClick={handleSelectOutput}
                className="px-3 py-2.5 bg-bg-secondary border border-border-default rounded-md hover:bg-bg-tertiary hover:border-cyan-muted transition-all"
              >
                <FolderIcon size={16} className="text-cyan-primary" />
              </button>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">
              Project Name
            </label>
            <input
              type="text"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="my-project"
              className="w-full px-3 py-2.5 font-mono text-sm bg-bg-secondary border border-border-default rounded-md focus:outline-none focus:border-cyan-muted focus:ring-2 focus:ring-cyan-primary/15"
            />
          </div>
        </div>
      </div>

      {/* Variables Section */}
      <div className="p-4 border-b border-border-muted">
        <SectionTitle>Variables</SectionTitle>
        <div className="space-y-2">
          {variables.map((variable) => (
            <div
              key={variable.name}
              className="flex items-center gap-2 p-2 bg-bg-secondary rounded-md border border-border-muted"
            >
              <span className="font-mono text-[11px] font-medium text-amber-300 bg-amber-900/30 px-1.5 py-0.5 rounded">
                {variable.name}
              </span>
              <span className="text-text-muted text-xs">→</span>
              <span className="flex-1 font-mono text-xs truncate">
                {variable.value}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Templates Section */}
      <div className="p-4 flex-1 overflow-auto">
        <SectionTitle>Templates</SectionTitle>
        <div className="space-y-3">
          <div className="p-4 bg-bg-secondary border border-border-default rounded-lg cursor-pointer hover:border-cyan-muted hover:bg-bg-tertiary transition-all">
            <div className="w-8 h-8 bg-cyan-dim rounded-md flex items-center justify-center text-cyan-bright mb-3">
              <LayersIcon size={16} />
            </div>
            <div className="text-sm font-semibold mb-1">Flash Project</div>
            <div className="text-[11px] text-text-muted">
              Classic ActionScript setup
            </div>
          </div>
          <div className="p-4 bg-bg-secondary border border-border-default rounded-lg cursor-pointer hover:border-cyan-muted hover:bg-bg-tertiary transition-all">
            <div className="w-8 h-8 bg-cyan-dim rounded-md flex items-center justify-center text-cyan-bright mb-3">
              <CodeIcon size={16} />
            </div>
            <div className="text-sm font-semibold mb-1">React App</div>
            <div className="text-[11px] text-text-muted">Modern React setup</div>
          </div>
        </div>
      </div>
    </aside>
  );
};
