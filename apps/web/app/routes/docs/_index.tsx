import { Link } from "react-router";
import type { Route } from "./+types/_index";

export function meta(_args: Route.MetaArgs) {
  return [
    { title: "Documentation - Structure Creator" },
    {
      name: "description",
      content: "Learn how to use Structure Creator to generate folder and file structures from XML schemas.",
    },
  ];
}

export default function DocsIndex() {
  return (
    <div>
      <h1>Documentation</h1>
      <p className="lead">
        Learn how to use Structure Creator to generate folder and file structures from XML schemas.
      </p>

      <div className="not-prose mt-8 grid gap-4 sm:grid-cols-2">
        <Link
          to="/docs/getting-started"
          className="group rounded-xl border border-border bg-surface p-6 transition-colors hover:border-accent/50"
        >
          <h3 className="text-lg font-semibold text-foreground group-hover:text-accent">
            Getting Started
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Download, install, and create your first structure in minutes.
          </p>
        </Link>

        <Link
          to="/docs/guides/xml-schema"
          className="group rounded-xl border border-border bg-surface p-6 transition-colors hover:border-accent/50"
        >
          <h3 className="text-lg font-semibold text-foreground group-hover:text-accent">
            XML Schema Guide
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Learn the XML syntax for defining folder and file structures.
          </p>
        </Link>

        <Link
          to="/docs/guides/variables"
          className="group rounded-xl border border-border bg-surface p-6 transition-colors hover:border-accent/50"
        >
          <h3 className="text-lg font-semibold text-foreground group-hover:text-accent">
            Variables & Transforms
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Use dynamic variables with powerful transformations.
          </p>
        </Link>

        <Link
          to="/docs/guides/templates"
          className="group rounded-xl border border-border bg-surface p-6 transition-colors hover:border-accent/50"
        >
          <h3 className="text-lg font-semibold text-foreground group-hover:text-accent">
            Templates
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Save, share, and reuse your schema definitions.
          </p>
        </Link>
      </div>
    </div>
  );
}
