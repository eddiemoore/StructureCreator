import { useState } from "react";
import { Link, useLoaderData, useFetcher, data } from "react-router";
import type { Route } from "./+types/$id";
import { getTemplateById, incrementDownloadCount, type ParsedTemplate } from "~/lib/db.server";
import { getDb } from "~/lib/env.server";

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function meta({ data }: Route.MetaArgs) {
  const template = data as ParsedTemplate | null;
  return [
    { title: template ? `${template.name} - Structure Creator` : "Template Not Found - Structure Creator" },
    {
      name: "description",
      content: template?.description || "View template details and download for Structure Creator.",
    },
  ];
}

export async function loader({ params, context }: Route.LoaderArgs) {
  const db = getDb(context);
  const template = await getTemplateById(db, params.id);

  if (!template) {
    throw data({ message: "Template not found" }, { status: 404 });
  }

  return { template };
}

export async function action({ params, context }: Route.ActionArgs) {
  const db = getDb(context);
  await incrementDownloadCount(db, params.id);
  return { success: true };
}

export default function TemplateDetail() {
  const { template } = useLoaderData<typeof loader>();
  const [copied, setCopied] = useState(false);
  const fetcher = useFetcher();

  const handleCopy = async () => {
    await navigator.clipboard.writeText(template.schema_xml);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    // Track download on server
    fetcher.submit(null, { method: "post" });

    // Trigger client-side download
    const blob = new Blob([template.schema_xml], { type: "application/xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${template.id}.xml`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      {/* Breadcrumb */}
      <nav className="mb-8">
        <ol className="flex items-center gap-2 text-sm text-muted-foreground">
          <li>
            <Link to="/templates" className="hover:text-foreground">
              Templates
            </Link>
          </li>
          <li>/</li>
          <li className="text-foreground">{template.name}</li>
        </ol>
      </nav>

      <div className="grid gap-8 lg:grid-cols-3">
        {/* Main Content */}
        <div className="lg:col-span-2">
          <div className="mb-6">
            <h1 className="text-3xl font-bold tracking-tight text-foreground">
              {template.name}
            </h1>
            <p className="mt-4 text-lg text-muted-foreground">{template.description}</p>
          </div>

          {/* Tags */}
          <div className="mb-8 flex flex-wrap gap-2">
            {template.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-surface px-3 py-1 text-sm text-muted-foreground"
              >
                {tag}
              </span>
            ))}
          </div>

          {/* Schema Preview */}
          <div className="rounded-xl border border-border bg-surface">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <span className="text-sm font-medium text-foreground">Schema</span>
              <button onClick={handleCopy} className="btn btn-ghost text-sm">
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
            <pre className="overflow-x-auto p-4 text-sm">
              <code className="text-muted-foreground">{template.schema_xml}</code>
            </pre>
          </div>

          {/* Variables */}
          {Object.keys(template.variables).length > 0 && (
            <div className="mt-8">
              <h2 className="mb-4 text-xl font-semibold text-foreground">Variables</h2>
              <div className="rounded-xl border border-border bg-surface">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="px-4 py-3 text-left font-medium text-foreground">Name</th>
                      <th className="px-4 py-3 text-left font-medium text-foreground">Default Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(template.variables).map(([name, value]) => (
                      <tr key={name} className="border-b border-border last:border-0">
                        <td className="px-4 py-3">
                          <code className="rounded bg-surface-secondary px-2 py-1 text-xs">
                            %{name}%
                          </code>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="lg:col-span-1">
          <div className="sticky top-24 rounded-xl border border-border bg-surface p-6">
            <button onClick={handleDownload} className="btn btn-primary mb-4 w-full">
              Download Template
            </button>
            <button onClick={handleCopy} className="btn btn-secondary w-full">
              {copied ? "Copied!" : "Copy to Clipboard"}
            </button>

            <hr className="my-6 border-border" />

            <dl className="space-y-4 text-sm">
              <div>
                <dt className="text-muted-foreground">Author</dt>
                <dd className="mt-1 text-foreground">
                  {template.author_github ? (
                    <a
                      href={`https://github.com/${template.author_github}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent hover:underline"
                    >
                      @{template.author_github}
                    </a>
                  ) : (
                    template.author_name
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Downloads</dt>
                <dd className="mt-1 text-foreground">{template.download_count.toLocaleString()}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Submitted</dt>
                <dd className="mt-1 text-foreground">
                  {formatDate(template.submitted_at)}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}
