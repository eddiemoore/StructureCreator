import { useAppStore } from "../store/appStore";
import {
  FolderIcon,
  FileIcon,
  DownloadIcon,
  BranchIcon,
  GitMergeIcon,
  RepeatIcon,
  EyeIcon,
  GridIcon,
  XmlIcon,
} from "./Icons";
import type { SchemaNode, EditorMode } from "../types/schema";
import { VisualSchemaEditor } from "./VisualSchemaEditor";
import { XmlSchemaEditor } from "./XmlSchemaEditor";
import { INDENT_PX } from "../utils/schemaTree";

/** Safely extract hostname from URL, returning null if URL is malformed */
const getUrlHostname = (url: string): string | null => {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
};

interface TreeItemProps {
  node: SchemaNode;
  depth: number;
  projectName: string;
}

const TreeItem = ({ node, depth, projectName }: TreeItemProps) => {
  const displayName =
    node.name === "%PROJECT_NAME%" ? projectName : node.name.replace(/%PROJECT_NAME%/g, projectName);

  const isFolder = node.type === "folder";
  const isIf = node.type === "if";
  const isElse = node.type === "else";
  const isRepeat = node.type === "repeat";
  const isConditional = isIf || isElse;
  const hasUrl = !!node.url;

  // For conditional nodes, show the condition info
  const conditionalLabel = isIf
    ? `if %${node.condition_var || "?"}%`
    : isElse
    ? "else"
    : null;

  // For repeat nodes, show the count and iteration variable
  const repeatLabel = isRepeat
    ? `repeat ${node.repeat_count || "1"} as %${node.repeat_as || "i"}%`
    : null;

  // Render children (shared between conditional and non-conditional nodes)
  const childrenElements = node.children?.map((child, index) => (
    <TreeItem
      key={child.id ?? `${child.name}-${index}`}
      node={child}
      depth={depth + 1}
      projectName={projectName}
    />
  ));

  // Render repeat block
  if (isRepeat) {
    return (
      <>
        <div
          className="flex items-center gap-2 px-2 py-1 rounded-mac cursor-default"
          style={{ marginLeft: `${depth * INDENT_PX}px` }}
        >
          <RepeatIcon size={16} className="text-system-green flex-shrink-0" />
          <span className="font-mono text-mac-sm font-medium text-system-green">
            {repeatLabel}
          </span>
        </div>
        {childrenElements}
      </>
    );
  }

  return (
    <>
      {isConditional ? (
        <>
          <div
            className="flex items-center gap-2 px-2 py-1 rounded-mac cursor-default"
            style={{ marginLeft: `${depth * INDENT_PX}px` }}
          >
            {isIf ? (
              <BranchIcon size={16} className="text-system-orange flex-shrink-0" />
            ) : (
              <GitMergeIcon size={16} className="text-system-purple flex-shrink-0" />
            )}
            <span className={`font-mono text-mac-sm font-medium ${isIf ? "text-system-orange" : "text-system-purple"}`}>
              {conditionalLabel}
            </span>
          </div>
          {childrenElements}
        </>
      ) : (
        <>
          <div
            className="flex items-center gap-2 px-2 py-1 rounded-mac hover:bg-mac-bg-hover cursor-default transition-colors"
            style={{ marginLeft: `${depth * INDENT_PX}px` }}
          >
            {isFolder ? (
              <FolderIcon size={16} className="text-system-blue flex-shrink-0" />
            ) : (
              <FileIcon
                size={16}
                className={`flex-shrink-0 ${hasUrl ? "text-system-orange" : "text-text-muted"}`}
              />
            )}
            <span className={`font-mono text-mac-sm ${isFolder ? "font-medium text-text-primary" : "text-text-secondary"}`}>
              {displayName}
            </span>
            {hasUrl && (
              <span className="ml-auto text-mac-xs text-text-muted truncate max-w-[200px]">
                {getUrlHostname(node.url!) ?? `${node.url!.slice(0, 30)}${node.url!.length > 30 ? "..." : ""}`}
              </span>
            )}
          </div>
          {childrenElements}
        </>
      )}
    </>
  );
};

interface EditorModeToggleProps {
  mode: EditorMode;
  onChange: (mode: EditorMode) => void;
  disabled?: boolean;
}

const EditorModeToggle = ({ mode, onChange, disabled }: EditorModeToggleProps) => {
  const modes: { value: EditorMode; label: string; icon: React.ReactNode }[] = [
    { value: "preview", label: "Preview", icon: <EyeIcon size={14} /> },
    { value: "visual", label: "Visual", icon: <GridIcon size={14} /> },
    { value: "xml", label: "XML", icon: <XmlIcon size={14} /> },
  ];

  return (
    <div className="flex items-center bg-mac-bg rounded-mac p-0.5 border border-border-muted">
      {modes.map(({ value, label, icon }) => (
        <button
          key={value}
          onClick={() => onChange(value)}
          disabled={disabled}
          className={`flex items-center gap-1.5 px-2 py-1 rounded-mac text-mac-xs transition-colors ${
            mode === value
              ? "bg-mac-bg-secondary text-text-primary shadow-sm"
              : "text-text-secondary hover:text-text-primary"
          } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
        >
          {icon}
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
};

export const TreePreview = () => {
  const { schemaTree, projectName, editorMode, setEditorMode, xmlParseError } = useAppStore();

  const handleModeChange = async (newMode: EditorMode) => {
    await setEditorMode(newMode);
  };

  const getModeTitle = () => {
    switch (editorMode) {
      case "preview":
        return "Structure Preview";
      case "visual":
        return "Visual Editor";
      case "xml":
        return "XML Editor";
    }
  };

  return (
    <main className="bg-mac-bg flex flex-col overflow-hidden border-r border-border-muted h-[calc(100vh-2rem)]">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border-muted flex items-center justify-between bg-mac-bg-secondary">
        <div className="flex items-center gap-3">
          <div className="text-mac-base font-medium text-text-primary">
            {getModeTitle()}
          </div>
          {schemaTree && (
            <EditorModeToggle
              mode={editorMode}
              onChange={handleModeChange}
              disabled={editorMode === "xml" && !!xmlParseError}
            />
          )}
        </div>
        {schemaTree && editorMode === "preview" && (
          <div className="flex gap-4">
            <div className="flex items-center gap-1.5 text-mac-xs text-text-secondary">
              <FolderIcon size={14} className="text-system-blue" />
              <span className="font-mono font-medium">
                {schemaTree.stats.folders}
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-mac-xs text-text-secondary">
              <FileIcon size={14} className="text-text-muted" />
              <span className="font-mono font-medium">
                {schemaTree.stats.files}
              </span>
            </div>
            {schemaTree.stats.downloads > 0 && (
              <div className="flex items-center gap-1.5 text-mac-xs text-text-secondary">
                <DownloadIcon size={14} className="text-system-orange" />
                <span className="font-mono font-medium">
                  {schemaTree.stats.downloads}
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Content based on mode */}
      {editorMode === "visual" ? (
        <VisualSchemaEditor />
      ) : editorMode === "xml" ? (
        <XmlSchemaEditor />
      ) : (
        <div className="flex-1 overflow-auto p-4 mac-scroll">
          {schemaTree ? (
            <div className="leading-relaxed">
              <TreeItem node={schemaTree.root} depth={0} projectName={projectName} />
            </div>
          ) : (
            <div className="h-full flex items-center justify-center text-text-muted">
              <div className="text-center">
                <FolderIcon size={48} className="mx-auto mb-4 opacity-20" />
                <div className="text-mac-base">No schema loaded</div>
                <div className="text-mac-xs mt-1">
                  Select a schema file to preview
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </main>
  );
};
