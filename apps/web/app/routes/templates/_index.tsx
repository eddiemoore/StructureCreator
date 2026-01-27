import { Link } from "react-router";
import type { Route } from "./+types/_index";
import type { Template } from "@structure-creator/shared";

export function meta(_args: Route.MetaArgs) {
  return [
    { title: "Templates - Structure Creator" },
    {
      name: "description",
      content: "Browse community-contributed templates for Structure Creator. Find pre-built schemas for React, Next.js, Node.js, and more.",
    },
  ];
}

type TemplatePlaceholder = Template & {
  author: string;
  downloads: number;
}

// Placeholder templates - will be loaded from D1 database
const placeholderTemplates: TemplatePlaceholder[] = [];

export default function TemplatesIndex() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="mb-12 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Templates</h1>
          <p className="mt-2 text-muted-foreground">
            Browse community-contributed templates for Structure Creator.
          </p>
        </div>
        <Link to="/templates/submit" className="btn btn-primary">
          Submit Template
        </Link>
      </div>

      {/* Templates Grid */}
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {placeholderTemplates.map((template) => (
          <Link
            key={template.id}
            to={`/templates/${template.id}`}
            className="group rounded-xl border border-border bg-surface p-6 transition-colors hover:border-accent/50"
          >
            <div className="mb-3 flex items-start justify-between">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10 text-accent">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
              </div>
            </div>

            <h3 className="text-lg font-semibold text-foreground group-hover:text-accent">
              {template.name}
            </h3>
            <p className="mt-2 text-sm text-muted-foreground line-clamp-2">
              {template.description}
            </p>

            <div className="mt-4 flex flex-wrap gap-2">
              {template.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-surface-secondary px-2 py-1 text-xs text-muted-foreground"
                >
                  {tag}
                </span>
              ))}
            </div>

            <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
              <span>by {template.author}</span>
              <span>{template.downloads} downloads</span>
            </div>
          </Link>
        ))}
      </div>

      {/* Empty State */}
      {placeholderTemplates.length === 0 && (
        <div className="py-12 text-center">
          <svg
            className="mx-auto h-12 w-12 text-muted"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
            />
          </svg>
          <h3 className="mt-4 text-lg font-medium text-foreground">No templates yet</h3>
          <p className="mt-2 text-muted-foreground">
            Be the first to contribute a template to the community!
          </p>
          <Link to="/templates/submit" className="btn btn-primary mt-6">
            Submit Template
          </Link>
        </div>
      )}
    </div>
  );
}
