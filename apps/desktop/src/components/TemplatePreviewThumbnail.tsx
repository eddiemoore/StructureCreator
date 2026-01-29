import type { SchemaTree, SchemaNode } from "../types/schema";

interface TemplatePreviewThumbnailProps {
  /** The template's icon color */
  iconColor?: string | null;
  /** Parsed schema tree (if available) */
  schemaTree?: SchemaTree | null;
  /** Whether the tree is still loading */
  isLoading?: boolean;
  /** Click handler */
  onClick?: () => void;
}

/** Simple mini folder icon that supports inline styles */
const MiniFolderIcon = ({ size, color }: { size: number; color: string }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill={color}
    stroke="none"
    aria-hidden="true"
  >
    <path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z" />
  </svg>
);

/** Simple mini file icon */
const MiniFileIcon = ({ size }: { size: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className="text-text-muted"
  >
    <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
    <polyline points="13 2 13 9 20 9" />
  </svg>
);

/**
 * Get the first few items from a schema tree for the mini preview.
 * Returns up to 3 items (folders or files) for display.
 */
function getMiniPreviewItems(
  root: SchemaNode
): Array<{ name: string; type: "folder" | "file" }> {
  const items: Array<{ name: string; type: "folder" | "file" }> = [];
  const children = root.children || [];

  for (const child of children) {
    if (items.length >= 3) break;
    // Only include folders and files (skip if/else/repeat control nodes)
    if (child.type === "folder" || child.type === "file") {
      items.push({
        name: child.name,
        type: child.type,
      });
    }
  }

  return items;
}

/**
 * Mini tree visualization for template cards.
 * Shows a 32x32 container with small folder/file icons and a stats badge.
 */
export function TemplatePreviewThumbnail({
  iconColor,
  schemaTree,
  isLoading,
  onClick,
}: TemplatePreviewThumbnailProps) {
  const color = iconColor || "#0a84ff";
  const hasTree = schemaTree && schemaTree.root;
  const items = hasTree ? getMiniPreviewItems(schemaTree.root) : [];

  return (
    <div
      className="w-8 h-8 rounded-mac flex-shrink-0 relative overflow-hidden cursor-pointer transition-transform hover:scale-105"
      style={{
        backgroundColor: `${color}15`,
      }}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      title="Click to preview template"
    >
      {/* Mini tree visualization */}
      {hasTree && !isLoading ? (
        <div className="absolute inset-0 flex flex-col justify-center pl-1 gap-px">
          {items.length > 0 ? (
            items.map((item, index) => (
              <div
                key={`${item.name}-${index}`}
                className="flex items-center gap-0.5"
              >
                {item.type === "folder" ? (
                  <MiniFolderIcon size={7} color={color} />
                ) : (
                  <MiniFileIcon size={7} />
                )}
                <span
                  className="text-[5px] text-text-secondary truncate max-w-[18px]"
                  style={{ lineHeight: 1.2 }}
                >
                  {item.name}
                </span>
              </div>
            ))
          ) : (
            // Fallback for empty tree
            <div className="flex items-center justify-center h-full">
              <MiniFolderIcon size={12} color={color} />
            </div>
          )}
        </div>
      ) : (
        // Loading or no tree - show placeholder
        <div className="absolute inset-0 flex items-center justify-center">
          {isLoading ? (
            <div
              className="w-3 h-3 border border-t-transparent rounded-full animate-spin"
              style={{ borderColor: `${color}40`, borderTopColor: "transparent" }}
            />
          ) : (
            <MiniFolderIcon size={12} color={color} />
          )}
        </div>
      )}

      {/* Stats badge */}
      {hasTree && !isLoading && (
        <div
          className="absolute -bottom-px -right-px px-1 py-px text-[6px] font-medium rounded-tl-sm"
          style={{
            backgroundColor: color,
            color: "white",
          }}
        >
          {schemaTree.stats.folders}/{schemaTree.stats.files}
        </div>
      )}
    </div>
  );
}
