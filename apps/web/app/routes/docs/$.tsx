import { useParams } from "react-router";
import type { Route } from "./+types/$";

// Import MDX content statically
// In a real app, you'd use a more sophisticated approach
const docs: Record<string, { default: React.ComponentType; frontmatter?: { title?: string; description?: string } }> = {};

// Lazy load MDX files
const mdxModules = import.meta.glob("../../../content/docs/**/*.mdx", { eager: true }) as Record<
  string,
  { default: React.ComponentType; frontmatter?: { title?: string; description?: string } }
>;

// Build the docs map
for (const [path, module] of Object.entries(mdxModules)) {
  // Convert path like "../../../content/docs/getting-started/index.mdx" to "getting-started"
  const docPath = path
    .replace("../../../content/docs/", "")
    .replace("/index.mdx", "")
    .replace(".mdx", "");
  docs[docPath] = module;
}

export function meta({ params }: Route.MetaArgs) {
  const slug = (params["*"] || "index").replace(/\/$/, "");
  const doc = docs[slug];
  const title = doc?.frontmatter?.title || "Documentation";
  const description = doc?.frontmatter?.description || "Structure Creator documentation";

  return [
    { title: `${title} - Structure Creator` },
    { name: "description", content: description },
  ];
}

export default function DocPage() {
  const params = useParams();
  const slug = (params["*"] || "index").replace(/\/$/, "");
  const doc = docs[slug];

  if (!doc) {
    return (
      <div>
        <h1>Page Not Found</h1>
        <p>The documentation page you're looking for doesn't exist.</p>
        <p className="text-sm text-muted-foreground">Requested: {slug}</p>
      </div>
    );
  }

  const Content = doc.default;

  return <Content />;
}
