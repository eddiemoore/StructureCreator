import { useAppStore } from "../store/appStore";
import {
  CheckSquareIcon,
  FolderIcon,
  FileIcon,
  DownloadIcon,
} from "./Icons";
import type { SchemaNode } from "../types/schema";

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
        className="flex items-center gap-2 px-2 py-1 rounded hover:bg-bg-secondary cursor-pointer transition-colors"
        style={{ marginLeft: `${depth * 20}px` }}
      >
        {isFolder ? (
          <FolderIcon size={16} className="text-cyan-primary flex-shrink-0" />
        ) : (
          <FileIcon
            size={16}
            className={`flex-shrink-0 ${hasUrl ? "text-amber-400" : "text-text-muted"}`}
          />
        )}
        <span className={`font-mono text-sm ${isFolder ? "font-medium" : ""}`}>
          {displayName}
        </span>
        {hasUrl && (
          <span className="ml-auto text-[11px] text-text-muted truncate max-w-[200px]">
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
  const { schemaTree, projectName } = useAppStore();

  return (
    <main className="bg-bg-primary flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-border-muted flex items-center justify-between">
        <div className="flex items-center gap-2.5 text-sm font-semibold">
          <CheckSquareIcon size={18} />
          Structure Preview
        </div>
        {schemaTree && (
          <div className="flex gap-4">
            <div className="flex items-center gap-1.5 text-xs text-text-secondary">
              <FolderIcon size={14} className="opacity-60" />
              <span className="font-mono font-medium text-cyan-primary">
                {schemaTree.stats.folders}
              </span>{" "}
              folders
            </div>
            <div className="flex items-center gap-1.5 text-xs text-text-secondary">
              <FileIcon size={14} className="opacity-60" />
              <span className="font-mono font-medium text-cyan-primary">
                {schemaTree.stats.files}
              </span>{" "}
              files
            </div>
            <div className="flex items-center gap-1.5 text-xs text-text-secondary">
              <DownloadIcon size={14} className="opacity-60" />
              <span className="font-mono font-medium text-cyan-primary">
                {schemaTree.stats.downloads}
              </span>{" "}
              downloads
            </div>
          </div>
        )}
      </div>

      {/* Tree View */}
      <div className="flex-1 overflow-auto p-5">
        {schemaTree ? (
          <div className="font-mono text-sm leading-relaxed">
            <TreeItem node={schemaTree.root} depth={0} projectName={projectName} />
          </div>
        ) : (
          <div className="h-full flex items-center justify-center text-text-muted">
            <div className="text-center">
              <FolderIcon size={48} className="mx-auto mb-4 opacity-20" />
              <div className="text-sm">No schema loaded</div>
              <div className="text-xs mt-1">
                Select a schema file to preview the structure
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
};
