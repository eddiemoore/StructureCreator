import { useAppStore } from "../store/appStore";
import {
  FolderIcon,
  FileIcon,
  DownloadIcon,
  CodeIcon,
  GridIcon,
} from "./Icons";
import type { SchemaNode } from "../types/schema";
import { VisualSchemaEditor } from "./VisualSchemaEditor";

interface TreeItemProps {
  node: SchemaNode;
  depth: number;
  projectName: string;
}

const TreeItem = ({ node, depth, projectName }: TreeItemProps) => {
  const displayName =
    node.name === "%BASE%" ? projectName : node.name.replace(/%BASE%/g, projectName);

  const isFolder = node.type === "folder";
  const hasUrl = !!node.url;

  return (
    <>
      <div
        className="flex items-center gap-2 px-2 py-1 rounded-mac hover:bg-mac-bg-hover cursor-default transition-colors"
        style={{ marginLeft: `${depth * 20}px` }}
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
            {new URL(node.url!).hostname}/...
          </span>
        )}
      </div>
      {node.children?.map((child, index) => (
        <TreeItem
          key={`${child.name}-${index}`}
          node={child}
          depth={depth + 1}
          projectName={projectName}
        />
      ))}
    </>
  );
};

export const TreePreview = () => {
  const { schemaTree, projectName, isEditMode, setEditMode } = useAppStore();

  return (
    <main className="bg-mac-bg flex flex-col overflow-hidden border-r border-border-muted">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border-muted flex items-center justify-between bg-mac-bg-secondary">
        <div className="flex items-center gap-3">
          <div className="text-mac-base font-medium text-text-primary">
            {isEditMode ? "Schema Editor" : "Structure Preview"}
          </div>
          {schemaTree && (
            <button
              onClick={() => setEditMode(!isEditMode)}
              className="flex items-center gap-1.5 px-2 py-1 rounded-mac hover:bg-mac-bg-hover text-mac-xs text-text-secondary hover:text-text-primary transition-colors"
              title={isEditMode ? "Switch to Preview" : "Switch to Editor"}
            >
              {isEditMode ? (
                <>
                  <CodeIcon size={14} />
                  <span>Preview</span>
                </>
              ) : (
                <>
                  <GridIcon size={14} />
                  <span>Edit</span>
                </>
              )}
            </button>
          )}
        </div>
        {schemaTree && !isEditMode && (
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

      {/* Tree View / Editor */}
      {isEditMode ? (
        <VisualSchemaEditor />
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
