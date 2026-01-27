import { Link } from "react-router";
import type { Route } from "./+types/$id";

export function meta(_args: Route.MetaArgs) {
  return [
    { title: `Template - Structure Creator` },
    {
      name: "description",
      content: "View template details and download for Structure Creator.",
    },
  ];
}

// Placeholder - will be loaded from D1 database
const placeholderTemplate = {
  id: "react-component",
  name: "React Component",
  description: "A basic React component with TypeScript, CSS modules, and tests. Perfect for adding new components to your React project with a consistent structure.",
  schema_xml: `<folder name="%COMPONENT_NAME%">
  <file name="%COMPONENT_NAME%.tsx">
import styles from './%COMPONENT_NAME%.module.css';

interface %COMPONENT_NAME%Props {
  // Add props here
}

export function %COMPONENT_NAME%({ }: %COMPONENT_NAME%Props) {
  return (
    <div className={styles.root}>
      %COMPONENT_NAME% component
    </div>
  );
}
  </file>
  <file name="%COMPONENT_NAME%.module.css">
.root {
  /* Add styles here */
}
  </file>
  <file name="%COMPONENT_NAME%.test.tsx">
import { render, screen } from '@testing-library/react';
import { %COMPONENT_NAME% } from './%COMPONENT_NAME%';

describe('%COMPONENT_NAME%', () => {
  it('renders correctly', () => {
    render(<%COMPONENT_NAME% />);
    expect(screen.getByText('%COMPONENT_NAME% component')).toBeInTheDocument();
  });
});
  </file>
  <file name="index.ts">
export { %COMPONENT_NAME% } from './%COMPONENT_NAME%';
  </file>
</folder>`,
  variables: {
    COMPONENT_NAME: "MyComponent",
  },
  tags: ["react", "typescript", "component"],
  author_name: "Community",
  author_github: "eddiemoore",
  download_count: 0,
  submitted_at: "2024-01-15",
};

export default function TemplateDetail(_props: Route.ComponentProps) {
  const template = placeholderTemplate;

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
              <button className="btn btn-ghost text-sm">Copy</button>
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
            <button className="btn btn-primary mb-4 w-full">
              Download Template
            </button>
            <button className="btn btn-secondary w-full">
              Copy to Clipboard
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
                <dd className="mt-1 text-foreground">{template.download_count}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Submitted</dt>
                <dd className="mt-1 text-foreground">{template.submitted_at}</dd>
              </div>
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}
