// MDX utilities for loading documentation

export interface DocFrontmatter {
  title: string;
  description?: string;
}

export interface DocMeta {
  slug: string;
  title: string;
  description?: string;
}

// This file provides types and utilities for MDX processing
// The actual MDX loading is handled by Vite's import.meta.glob in the route files

export function getDocsNavigation() {
  return [
    {
      title: "Getting Started",
      items: [
        { slug: "getting-started", label: "Introduction" },
        { slug: "getting-started/installation", label: "Installation" },
        { slug: "getting-started/quick-start", label: "Quick Start" },
      ],
    },
    {
      title: "Guides",
      items: [
        { slug: "guides/xml-schema", label: "XML Schema" },
        { slug: "guides/variables", label: "Variables & Transforms" },
        { slug: "guides/templates", label: "Templates" },
        { slug: "guides/conditionals", label: "Conditionals & Loops" },
        { slug: "guides/wizard", label: "Template Wizard" },
      ],
    },
    {
      title: "Reference",
      items: [
        { slug: "api/schema", label: "Schema Reference" },
        { slug: "api/transforms", label: "Transforms Reference" },
      ],
    },
  ];
}

export function getDocBreadcrumbs(slug: string): Array<{ label: string; href: string }> {
  const parts = slug.split("/");
  const breadcrumbs: Array<{ label: string; href: string }> = [
    { label: "Docs", href: "/docs" },
  ];

  let currentPath = "/docs";
  for (const part of parts) {
    currentPath += `/${part}`;
    breadcrumbs.push({
      label: formatLabel(part),
      href: currentPath,
    });
  }

  return breadcrumbs;
}

function formatLabel(slug: string): string {
  return slug
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
