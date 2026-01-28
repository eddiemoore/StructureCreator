import { Form, useNavigation, useActionData } from "react-router";
import type { Route } from "./+types/submit";

export function meta(_args: Route.MetaArgs) {
  return [
    { title: "Submit Template - Structure Creator" },
    {
      name: "description",
      content: "Submit your template to the Structure Creator community.",
    },
  ];
}

interface ActionData {
  errors?: Record<string, string[]>;
}

function FieldError({ errors, field }: { errors?: Record<string, string[]>; field: string }) {
  const fieldErrors = errors?.[field];
  if (!fieldErrors?.length) return null;
  return <p className="mt-1 text-sm text-red-500">{fieldErrors[0]}</p>;
}

export default function SubmitTemplate() {
  const navigation = useNavigation();
  const actionData = useActionData<ActionData>();
  const isSubmitting = navigation.state === "submitting";
  const hasErrors = actionData?.errors && Object.keys(actionData.errors).length > 0;

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          Submit a Template
        </h1>
        <p className="mt-2 text-muted-foreground">
          Share your template with the Structure Creator community. All submissions are reviewed before being published.
        </p>
      </div>

      {hasErrors && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950">
          <p className="text-sm font-medium text-red-800 dark:text-red-200">
            Please fix the errors below and try again.
          </p>
        </div>
      )}

      <Form method="post" action="/api/templates/submit" className="space-y-8">
        {/* Template Info */}
        <div className="rounded-xl border border-border bg-surface p-6">
          <h2 className="mb-4 text-lg font-semibold text-foreground">Template Information</h2>

          <div className="space-y-4">
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-foreground">
                Template Name *
              </label>
              <input
                type="text"
                id="name"
                name="name"
                required
                className="input mt-1"
                placeholder="e.g., React Component"
              />
              <FieldError errors={actionData?.errors} field="name" />
            </div>

            <div>
              <label htmlFor="description" className="block text-sm font-medium text-foreground">
                Description *
              </label>
              <textarea
                id="description"
                name="description"
                required
                rows={3}
                className="input mt-1"
                placeholder="Describe what your template creates and when to use it..."
              />
              <FieldError errors={actionData?.errors} field="description" />
            </div>

            <div>
              <label htmlFor="tags" className="block text-sm font-medium text-foreground">
                Tags
              </label>
              <input
                type="text"
                id="tags"
                name="tags"
                className="input mt-1"
                placeholder="react, typescript, component (comma-separated)"
              />
              <p className="mt-1 text-sm text-muted-foreground">
                Separate tags with commas
              </p>
            </div>
          </div>
        </div>

        {/* Schema */}
        <div className="rounded-xl border border-border bg-surface p-6">
          <h2 className="mb-4 text-lg font-semibold text-foreground">Schema XML *</h2>

          <div>
            <textarea
              id="schema_xml"
              name="schema_xml"
              required
              rows={15}
              className="input mt-1 font-mono text-sm"
              placeholder={`<folder name="%PROJECT_NAME%">
  <file name="index.ts" />
</folder>`}
            />
            <FieldError errors={actionData?.errors} field="schema_xml" />
            <p className="mt-2 text-sm text-muted-foreground">
              Your XML schema that defines the folder/file structure.{" "}
              <a href="/docs/guides/xml-schema" className="text-accent hover:underline">
                Learn more about schema syntax
              </a>
            </p>
          </div>
        </div>

        {/* Variables */}
        <div className="rounded-xl border border-border bg-surface p-6">
          <h2 className="mb-4 text-lg font-semibold text-foreground">Default Variables</h2>
          <p className="mb-4 text-sm text-muted-foreground">
            Provide default values for the variables used in your schema (optional).
          </p>

          <div>
            <textarea
              id="variables"
              name="variables"
              rows={5}
              className="input mt-1 font-mono text-sm"
              placeholder={`{
  "PROJECT_NAME": "my-project",
  "AUTHOR": "Your Name"
}`}
            />
            <FieldError errors={actionData?.errors} field="variables" />
            <p className="mt-2 text-sm text-muted-foreground">
              JSON object with variable names and default values
            </p>
          </div>
        </div>

        {/* Author Info */}
        <div className="rounded-xl border border-border bg-surface p-6">
          <h2 className="mb-4 text-lg font-semibold text-foreground">Your Information</h2>

          <div className="space-y-4">
            <div>
              <label htmlFor="author_name" className="block text-sm font-medium text-foreground">
                Name *
              </label>
              <input
                type="text"
                id="author_name"
                name="author_name"
                required
                className="input mt-1"
                placeholder="Your name"
              />
              <FieldError errors={actionData?.errors} field="author_name" />
            </div>

            <div>
              <label htmlFor="author_email" className="block text-sm font-medium text-foreground">
                Email *
              </label>
              <input
                type="email"
                id="author_email"
                name="author_email"
                required
                className="input mt-1"
                placeholder="your@email.com"
              />
              <FieldError errors={actionData?.errors} field="author_email" />
              <p className="mt-1 text-sm text-muted-foreground">
                Not displayed publicly. Used for submission updates.
              </p>
            </div>

            <div>
              <label htmlFor="author_github" className="block text-sm font-medium text-foreground">
                GitHub Username
              </label>
              <input
                type="text"
                id="author_github"
                name="author_github"
                className="input mt-1"
                placeholder="username"
              />
            </div>
          </div>
        </div>

        {/* Submit */}
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            By submitting, you agree to have your template reviewed and shared under MIT license.
          </p>
          <button
            type="submit"
            disabled={isSubmitting}
            className="btn btn-primary"
          >
            {isSubmitting ? "Submitting..." : "Submit Template"}
          </button>
        </div>
      </Form>
    </div>
  );
}
